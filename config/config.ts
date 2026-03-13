/**
 * SmugMug Thalia website config.
 * Security (users, sessions, audits) + albums/images + SmugMug API helpers.
 * UploadThing: client uploads to UT (tagged temporary), then we fetch and send to SmugMug.
 */
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { RawWebsiteConfig } from 'thalia/types'
import { CrudFactory, SmugMugUploader, parseForm } from 'thalia/controllers'
import { ThaliaSecurity, type RoleRouteRule } from 'thalia/security'
import { recursiveObjectMerge } from 'thalia/website'

const ALL_PERMISSIONS = ['create', 'read', 'update', 'delete'] as const
import { eq, isNull, asc, or, and, inArray } from 'drizzle-orm'
import { albums, images, image_notes, events, bingo_cards, users } from '../models/master-schema.js'
import {
  listAlbums,
  getAlbumImages,
  getAlbum,
  patchAlbum,
  createAlbum,
  get,
  uploadToAlbum,
  getImageSizeDetails,
  type SmugMugUploadResponse,
} from './lib-smugmug.js'
import { topUpAlbumsFromApi, topUpAlbumAndImagesFromApi } from './smugmug-topup.js'
import { ServerResponse, IncomingMessage } from 'http'
import { Website } from 'thalia/website'
import { RequestInfo } from 'thalia/server'
import { createRouteHandler } from 'uploadthing/server'
import { uploadthingRouter } from './uploadthing.js'
import { addTempFile, runCleanupIfNeeded } from './uploadthing-cleanup.js'
import { loadMistralApiKey, describeImage, describeImageWithRetry, scoreAndCheckSafety } from './lib-mistral.js'

const mailAuthPath = path.join(import.meta.dirname, 'mailAuth.js')
const security = new ThaliaSecurity({ mailAuthPath })

const AlbumMachine = new CrudFactory(albums as any)
const ImageMachine = new CrudFactory(images as any)
const smugMugUploader = new SmugMugUploader()

/** Resolve URL slug (urlName or albumKey) to albumKey. Prefers urlName match so human-readable URLs win. */
async function resolveSlugToAlbumKey(db: any, slug: string): Promise<string | null> {
  if (!slug) return null
  const decoded = decodeURIComponent(slug)
  const rows = await db
    .select()
    .from(albums)
    .where(or(eq(albums.urlName, decoded), eq(albums.albumKey, decoded)))
    .limit(2)
  if (rows.length === 0) return null
  const byUrlName = rows.find((r: any) => r.urlName === decoded)
  return (byUrlName ?? rows[0])?.albumKey ?? null
}

function loadSmugMugCreds(): Promise<import('./lib-smugmug.js').SmugMugCredentials | null> {
  const secretsPath = path.join(import.meta.dirname, 'secrets.js')
  const authPath = path.join(import.meta.dirname, 'smugmugAuth.js')
  const p = fs.existsSync(secretsPath) ? secretsPath : fs.existsSync(authPath) ? authPath : null
  if (!p) return Promise.resolve(null)
  const url = pathToFileURL(p).href
  return import(url)
    .then((m) => {
      const creds = m.smugmug ?? m.default
      if (
        creds &&
        typeof creds.consumer_key === 'string' &&
        typeof creds.consumer_secret === 'string' &&
        typeof creds.oauth_token === 'string' &&
        typeof creds.oauth_token_secret === 'string'
      ) {
        return creds as import('./lib-smugmug.js').SmugMugCredentials
      }
      return null
    })
    .catch(() => null)
}

/** Load UPLOADTHING_TOKEN from config/secrets.js for UploadThing route handler. */
function loadUploadThingToken(): Promise<string | null> {
  const secretsPath = path.join(import.meta.dirname, 'secrets.js')
  if (!fs.existsSync(secretsPath)) return Promise.resolve(null)
  const url = pathToFileURL(secretsPath).href
  return import(url)
    .then((m: any) => (typeof m.UPLOADTHING_TOKEN === 'string' ? m.UPLOADTHING_TOKEN : null))
    .catch(() => null)
}

/** Load BINGO_ALBUM_KEY from config/secrets.js for forwarding bingo photos to SmugMug. */
function loadBingoAlbumKey(): Promise<string | null> {
  const secretsPath = path.join(import.meta.dirname, 'secrets.js')
  if (!fs.existsSync(secretsPath)) return Promise.resolve(null)
  const url = pathToFileURL(secretsPath).href
  return import(url)
    .then((m: any) => (typeof m.BINGO_ALBUM_KEY === 'string' ? m.BINGO_ALBUM_KEY.trim() : null))
    .catch(() => null)
}

/** Get approved bingo card IDs from event blob. Optional field; old events without it get []. */
function getApprovedCardIds(blob: unknown): number[] {
  if (blob == null || typeof blob !== 'object') return []
  const b = blob as { approvedCardIds?: unknown }
  if (!Array.isArray(b.approvedCardIds)) return []
  return b.approvedCardIds.filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
}

type BingoCardBlob = {
  cells?: unknown[]
  playerName?: unknown
  [key: string]: unknown
}

/** Parse bingo card blob safely from JSON/string/object. */
function parseBingoCardBlob(blob: unknown): BingoCardBlob {
  if (blob == null) return {}
  if (typeof blob === 'string') {
    try {
      const parsed = JSON.parse(blob) as unknown
      return parsed != null && typeof parsed === 'object' ? (parsed as BingoCardBlob) : {}
    } catch {
      return {}
    }
  }
  return typeof blob === 'object' ? (blob as BingoCardBlob) : {}
}

/** Trim and normalize player name for storage/display. Empty => null. */
function sanitizePlayerName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.slice(0, 60)
}

/** Read player name from card blob. */
function getCardPlayerName(card: { blob?: unknown }): string | null {
  const blob = parseBingoCardBlob(card.blob)
  return sanitizePlayerName(blob.playerName)
}

/** Parse card blob to cells array for preview. Safe for missing or string blob. */
function getCardCellsForPreview(card: { blob?: unknown }): Array<{ prompt?: string; imageUrl?: string | null; thumbnailUrl?: string | null; description?: string | null; isFreeSpace?: boolean }> {
  const b = parseBingoCardBlob(card.blob)
  const cells = Array.isArray(b.cells) ? b.cells : []
  return cells.map((c: any) => ({
    prompt: c?.prompt ?? '',
    imageUrl: c?.imageUrl ?? null,
    thumbnailUrl: c?.thumbnailUrl ?? null,
    description: c?.description ?? null,
    isFreeSpace: c?.prompt === 'Free space' || c?.isFreeSpace === true,
  }))
}

/** Placeholder cells for 3×3 photo hunt card preview (no images). No free space — all 9 are prompts. */
const PLACEHOLDER_CELLS_3X3: Array<{ prompt: string; imageUrl: null; thumbnailUrl: null; description: null; isFreeSpace: boolean }> = [
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
  { prompt: '—', imageUrl: null, thumbnailUrl: null, description: null, isFreeSpace: false },
]

/** Unihack Photo Hunt: event slug and id for the default game. */
const UNIHACK_SLUG = 'unihack'
const UNIHACK_EVENT_ID = 4

/**
 * Build cells for a photo hunt card: no free space. For 3×3 use 9 prompts, for 5×5 use 25.
 * Shuffles and takes the first total from the event's prompts.
 */
function buildPhotoHuntCells(
  prompts: string[],
  gridSize: 3 | 5
): Array<{ prompt: string; imageUrl: null; description: null; isFreeSpace: false }> {
  const total = gridSize * gridSize
  const shuffled = prompts.slice().sort(() => Math.random() - 0.5)
  const chosen = shuffled.slice(0, total)
  return chosen.map((prompt) => ({ prompt, imageUrl: null, description: null, isFreeSpace: false as const }))
}

/** Join URL for the default Unihack Photo Hunt — new visitors get a fresh card here. */
const UNIHACK_JOIN_URL = `/event/${UNIHACK_SLUG}/join`

/** Read request body as Buffer (for Node IncomingMessage). */
function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Build Fetch Request from Node IncomingMessage (for UploadThing route handler). */
async function nodeRequestToFetch(
  req: IncomingMessage,
  body: Buffer
): Promise<Request> {
  const host = req.headers.host ?? 'localhost'
  const url = `http://${host}${req.url ?? '/'}`
  return new Request(url, {
    method: req.method ?? 'GET',
    headers: req.headers as HeadersInit,
    body: body.length > 0 ? body : undefined,
  })
}

/** Cached UploadThing route handler (single function for GET and POST; uploadthing/server returns one handler). */
let uploadThingHandler: ((req: Request) => Promise<Response>) | null = null

/**
 * Handle uploadPhoto: if JSON body with uploadThingUrl/fileKey + albumKey, fetch from UploadThing and send to SmugMug;
 * otherwise use legacy form upload (file to server then SmugMug).
 */
function uploadPhotoController(
  res: ServerResponse,
  req: IncomingMessage,
  website: Website,
  requestInfo: RequestInfo
) {
  console.debug("Running uploadPhotoController")
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }
  const contentType = (req.headers['content-type'] ?? '').toLowerCase()
  if (contentType.includes('application/json')) {
    readRequestBody(req)
      .then((buf) => {
        console.debug("Running readRequestBody")
        let body: { uploadThingUrl?: string; fileKey?: string; albumKey?: string; filename?: string; url?: string }
        try {
          body = JSON.parse(buf.toString('utf8'))
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
          return null
        }
        const url = body.uploadThingUrl ?? body.url
        const albumKey = body.albumKey?.trim()
        const fileKey = body.fileKey ?? null
        const fileSize = typeof body.size === 'number' ? body.size : null
        if ((!url && !body.fileKey) || !albumKey) {
          console.debug("No url or fileKey and albumKey, which are required")
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'uploadThingUrl (or url) and albumKey required' }))
          return null
        }
        return loadSmugMugCreds().then((creds) => {
          console.debug("We got our smugmug credentials, now doing the smugmug upload")
          if (!creds) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'SmugMug credentials not configured' }))
            return null
          }
          if (!url) {
            console.debug("No url, which is required")
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'uploadThingUrl or url required (client must send URL from upload response)' }))
            return null
          }
          console.debug("Fetching the image from UploadThing")
          return fetch(url)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`Fetch ${r.status}`))))
            .then((ab) => Buffer.from(ab))
            .then((buffer) => {
              console.debug("We got the image from UploadThing, now doing the SmugMug upload")
              const filename = body.filename ?? 'image.jpg'
              const mime = filename.match(/\.(jpe?g|png|gif|webp)$/i)
                ? (filename.endsWith('.png') ? 'image/png' : filename.endsWith('.gif') ? 'image/gif' : filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg')
                : 'image/jpeg'
              return uploadToAlbum(creds, albumKey, buffer, mime, {
                filename,
                title: filename,
                caption: '',
                keywords: '',
              }).then((uploadResp) => {
                const albumImageUri = uploadResp?.Image?.AlbumImageUri
                if (!albumImageUri) throw new Error('SmugMug upload response missing AlbumImageUri')
                return get(creds, albumImageUri).then((apiBody: any) => {
                  const albumImage = apiBody?.Response?.AlbumImage ?? apiBody?.Response
                  if (!albumImage) throw new Error('SmugMug API: no AlbumImage in response')
                  if (!website.db) {
                    return { thumbnailUrl: uploadResp.Image?.URL ?? '', url: uploadResp.Image?.URL ?? '' }
                  }
                  return website.db.drizzle
                    .insert(images)
                    .values({
                      caption: albumImage.Caption ?? '',
                      filename: albumImage.FileName ?? filename,
                      url: uploadResp.Image?.URL ?? '',
                      originalSize: albumImage.OriginalSize ?? null,
                      originalWidth: albumImage.OriginalWidth ?? null,
                      originalHeight: albumImage.OriginalHeight ?? null,
                      thumbnailUrl: albumImage.ThumbnailUrl ?? uploadResp.Image?.URL ?? null,
                      archivedUri: albumImage.ArchivedUri ?? null,
                      archivedSize: albumImage.ArchivedSize ?? null,
                      archivedMD5: albumImage.ArchivedMD5 ?? null,
                      imageKey: albumImage.ImageKey ?? albumImage.Key ?? '',
                      preferredDisplayFileExtension: albumImage.PreferredDisplayFileExtension ?? null,
                      uri: albumImage.Uri ?? null,
                      albumKey,
                    })
                    .then(() => {
                      if (fileKey) addTempFile(fileKey, fileSize ?? 0)
                      loadUploadThingToken().then((token) =>
                        runCleanupIfNeeded(token).catch((e) => console.error('[uploadthing-cleanup]', e))
                      )
                      return {
                        thumbnailUrl: albumImage.ThumbnailUrl ?? uploadResp.Image?.URL ?? '',
                        url: uploadResp.Image?.URL ?? '',
                      }
                    })
                })
              })
            })
        })
      })
      .then((out) => {
        if (out == null) return
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(out))
      })
      .catch((err) => {
        console.error('UploadThing→SmugMug error:', err)
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: (err as Error).message }))
      })
    return
  }
  smugMugUploader.controller.call(smugMugUploader, res, req, website, requestInfo)
}

/**
 * UploadThing route handler: GET/POST /api/uploadthing. Converts Node req/res to Fetch and delegates.
 */
function uploadThingRouteController(
  res: ServerResponse,
  req: IncomingMessage,
  _website: Website,
  _requestInfo: RequestInfo
) {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }
  readRequestBody(req)
    .then((body) => nodeRequestToFetch(req, body))
    .then((fetchReq) => {
      if (!uploadThingHandler) {
        return loadUploadThingToken().then((token) => {
          if (!token) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'UploadThing token not configured (UPLOADTHING_TOKEN in config/secrets.js)' }))
            return null
          }
          uploadThingHandler = createRouteHandler({
            router: uploadthingRouter,
            config: { token },
          })
          return uploadThingHandler(fetchReq)
        })
      }
      return uploadThingHandler(fetchReq)
    })
    .then((response) => {
      if (response == null) return
      res.statusCode = response.status
      response.headers.forEach((value, key) => res.setHeader(key, value))
      return response.arrayBuffer().then((ab) => res.end(Buffer.from(ab)))
    })
    .catch((err) => {
      console.error('UploadThing route error:', err)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: (err as Error).message }))
    })
}

/** Manual trigger: run UploadThing temporary-file cleanup when storage is over threshold. */
function uploadThingCleanupController(
  res: ServerResponse,
  _req: IncomingMessage,
  _website: Website,
  _requestInfo: RequestInfo
) {
  loadUploadThingToken()
    .then((token) => runCleanupIfNeeded(token))
    .then((result) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    })
    .catch((err) => {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: (err as Error).message }))
    })
}

/**
 * Thalia uses the first path segment as the controller key, so /api/uploadthing
 * resolves to controller 'api', not 'api/uploadthing'. This controller dispatches
 * by pathname to the correct handler.
 */
function apiController(
  res: ServerResponse,
  req: IncomingMessage,
  website: Website,
  requestInfo: RequestInfo
) {
  const pathname = requestInfo.pathname ?? ''
  const host = requestInfo.host ?? 'unknown'
  console.log('[api] request host=%s pathname=%s method=%s', host, pathname, requestInfo.method ?? 'GET')
  // Diagnostic for nginx/proxy debugging: see docs/nginx-proxy-debug.md
  if (pathname === '/api/diagnose') {
    const pathnameVal = requestInfo.pathname ?? ''
    const domains = smugmugDomains
    const hostInDomains = domains.includes(host)
    const rawHeaders: Record<string, string> = {}
    const pick = ['host', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-host']
    for (const key of pick) {
      const val = req.headers[key]
      if (val != null) rawHeaders[key] = Array.isArray(val) ? val.join(', ') : String(val)
    }
    const payload = {
      ok: true,
      message: 'Diagnostic: request reached api controller',
      request: { host, pathname: pathnameVal, method: requestInfo.method },
      rawHeaders,
      routeGuard: {
        configuredDomains: domains,
        hostInDomains,
        note: hostInDomains
          ? 'Host matches a configured domain; route guard should find a route.'
          : 'Host NOT in configured domains; route guard will not match, guest gets no permissions and may receive 401.',
      },
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload, null, 2))
    return
  }
  if (pathname === '/api/uploadthing') {
    uploadThingRouteController(res, req, website, requestInfo)
    return
  }
  if (pathname === '/api/uploadthing-cleanup') {
    uploadThingCleanupController(res, req, website, requestInfo)
    return
  }
  if (pathname === '/api/mistral-describe') {
    mistralDescribeController(res, req)
    return
  }
  if (pathname === '/api/image-notes') {
    imageNotesController(res, req, website)
    return
  }
  if (pathname === '/api/bingo-cell') {
    bingoCellController(res, req, website)
    return
  }
  if (pathname === '/api/bingo-player-name') {
    bingoPlayerNameController(res, req, website)
    return
  }
  const bingoGameMatch = pathname.match(/^\/api\/bingo-game\/(\d+)$/)
  if (bingoGameMatch) {
    getBingoGameStateController(res, parseInt(bingoGameMatch[1], 10), website)
    return
  }
  const bingoCardPreviewMatch = pathname.match(/^\/api\/bingo-card-preview\/(\d+)$/)
  if (bingoCardPreviewMatch) {
    getBingoCardPreviewController(res, parseInt(bingoCardPreviewMatch[1], 10), website)
    return
  }
  const bingoEventAdminMatch = pathname.match(/^\/api\/bingo-event\/(\d+)\/admin-data$/)
  if (bingoEventAdminMatch) {
    getBingoEventAdminDataController(res, parseInt(bingoEventAdminMatch[1], 10), website)
    return
  }
  const bingoEventApproveMatch = pathname.match(/^\/api\/bingo-event\/(\d+)\/approve-cards$/)
  if (bingoEventApproveMatch) {
    approveCardsController(res, req, parseInt(bingoEventApproveMatch[1], 10), website)
    return
  }
  if (pathname === '/api/claim-card') {
    claimCardController(res, req, website, requestInfo)
    return
  }
  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: 'Not found' }))
}

/** POST /api/image-notes: body { albumKey, imageKey, note }. Upserts image_notes by albumKey+imageKey. */
function imageNotesController(res: ServerResponse, req: IncomingMessage, website: Website) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  if (!website.db) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Database not configured.' }))
    return
  }
  readRequestBody(req)
    .then((buf) => {
      const body = JSON.parse(buf.toString()) as { albumKey?: string; imageKey?: string; note?: string }
      const albumKey = typeof body?.albumKey === 'string' ? body.albumKey.trim() : ''
      const imageKey = typeof body?.imageKey === 'string' ? body.imageKey.trim() : ''
      const note = typeof body?.note === 'string' ? body.note : (body?.note != null ? JSON.stringify(body.note) : '')
      if (!imageKey || !note) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'imageKey and note required' }))
        return null
      }
      return { albumKey, imageKey, note }
    })
    .then((payload) => {
      if (!payload) return null
      const db = website.db!.drizzle
      return db
        .select()
        .from(image_notes)
        .where(and(eq(image_notes.albumKey, payload.albumKey), eq(image_notes.imageKey, payload.imageKey)))
        .limit(1)
        .then((rows) => (rows[0] ? db.update(image_notes).set({ note: payload.note }).where(eq(image_notes.id, rows[0].id)) : db.insert(image_notes).values({ albumKey: payload.albumKey || null, imageKey: payload.imageKey, note: payload.note })))
        .then(() => payload)
    })
    .then((payload) => {
      if (!payload) return
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, albumKey: payload.albumKey, imageKey: payload.imageKey }))
    })
    .catch((err) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message ?? String(err) }))
    })
}

/** POST /api/bingo-cell: body { cardId, cellIndex, imageUrl }. Updates cell, runs Mistral describe, saves to card blob. */
function bingoCellController(res: ServerResponse, req: IncomingMessage, website: Website) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  if (!website.db) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Database not configured.' }))
    return
  }
  readRequestBody(req)
    .then((buf) => {
      const raw = buf.toString()
      const body = JSON.parse(raw) as { cardId?: number | string; cellIndex?: number | string; imageUrl?: string }
      const cardId = typeof body?.cardId === 'number' ? body.cardId : parseInt(String(body?.cardId ?? ''), 10)
      const cellIndex = typeof body?.cellIndex === 'number' ? body.cellIndex : parseInt(String(body?.cellIndex ?? ''), 10)
      const imageUrl = (typeof body?.imageUrl === 'string' ? body.imageUrl : '').trim()
      console.log('[bingo-cell] POST received', { cardId, cellIndex, imageUrlLen: imageUrl?.length })
      if (!Number.isFinite(cardId) || cardId < 1 || !Number.isFinite(cellIndex) || cellIndex < 0 || !imageUrl) {
        console.log('[bingo-cell] validation failed', { cardId, cellIndex, hasImageUrl: !!imageUrl, keys: body ? Object.keys(body) : [] })
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'cardId, cellIndex (non-negative), and imageUrl required' }))
        return null
      }
      return { cardId, cellIndex, imageUrl }
    })
    .then((payload) => {
      if (!payload) return null
      console.log('[bingo-cell] payload ok, loading card', payload.cardId)
      const db = website.db!.drizzle
      return db.select().from(bingo_cards).where(eq(bingo_cards.id, payload.cardId)).limit(1).then((rows) => {
        if (!rows[0]) return null
        return { card: rows[0], payload }
      })
    })
    .then((ctx) => {
      if (!ctx) {
        if (!res.headersSent) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Card not found' }))
        }
        console.log('[bingo-cell] card not found')
        return null
      }
      const { card, payload } = ctx
      console.log('[bingo-cell] card loaded, loading creds and bingo album key')
      const cardBlob = parseBingoCardBlob(card.blob)
      const cells = Array.isArray(cardBlob.cells) ? cardBlob.cells.slice() : []
      if (payload.cellIndex >= cells.length) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: cells.length === 0 ? 'Card has no cells; please refresh the page.' : 'Invalid cellIndex' }))
        return null
      }
      return Promise.all([
        loadMistralApiKey(),
        loadSmugMugCreds(),
        loadBingoAlbumKey(),
      ]).then(([mistralKey, creds, bingoAlbumKey]) => {
        if (!mistralKey) return null
        if (!creds || !bingoAlbumKey) {
          if (!res.headersSent) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'SmugMug or BINGO_ALBUM_KEY not configured (config/secrets.js)' }))
          }
          return null
        }
        return { mistralKey, creds, bingoAlbumKey, cells, payload, card, cardBlob }
      })
    })
    .then((ctx) => {
      if (!ctx) {
        if (!res.headersSent) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Mistral API key not configured' }))
        }
        console.log('[bingo-cell] no ctx (Mistral key or SmugMug/bingo album missing)')
        return null
      }
      const { mistralKey, creds, bingoAlbumKey, cells, payload, card, cardBlob } = ctx
      const uploadThingUrl = payload.imageUrl
      console.log('[bingo-cell] fetching image from UploadThing...')
      return fetch(uploadThingUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`Fetch UploadThing image: ${r.status}`)
          console.log('[bingo-cell] UploadThing fetch ok, status', r.status)
          const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
          const mime = /^image\/(jpeg|png|gif|webp)$/.test(ct) ? ct : 'image/jpeg'
          return r.arrayBuffer().then((ab) => ({ buffer: Buffer.from(ab), mime }))
        })
        .then(({ buffer, mime }) => {
          console.log('[bingo-cell] buffer size', buffer.length, 'mime', mime)
          const ext = mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : 'jpg'
          const filename = `bingo-${payload.cardId}-${payload.cellIndex}.${ext}`
          console.log('[bingo-cell] uploading to SmugMug album', bingoAlbumKey, '...')
          return uploadToAlbum(creds, bingoAlbumKey, buffer, mime, {
            filename,
            title: filename,
            caption: '',
            keywords: '',
          }).then((uploadResp: SmugMugUploadResponse) => {
            const imageUri = uploadResp?.Image?.ImageUri
            console.log('[bingo-cell] SmugMug upload done, ImageUri', imageUri ? `${imageUri.slice(0, 50)}...` : 'missing')
            if (!imageUri) throw new Error('SmugMug upload response missing ImageUri')
            console.log('[bingo-cell] getting ImageSizeDetails...')
            return getImageSizeDetails(creds, imageUri).then((sizeUrls) => {
              console.log('[bingo-cell] ImageSizeDetails done, url len', sizeUrls.url?.length)
              const imageUrlForCell = sizeUrls.url
              const thumbnailUrlForCell = sizeUrls.thumbnailUrl
              console.log('[bingo-cell] calling Mistral describeImage...')
              return describeImageWithRetry(mistralKey, imageUrlForCell).then((result) => {
                console.log('[bingo-cell] Mistral describe done, running score/safety check...')
                const cellPrompt = cells[payload.cellIndex]?.prompt ?? ''
                const isFreeSpace = cellPrompt === 'Free space' || cells[payload.cellIndex]?.isFreeSpace === true
                if (!isFreeSpace && cellPrompt) {
                  return scoreAndCheckSafety(mistralKey, cellPrompt, result.description)
                    .then((scoring) => {
                      console.log('[bingo-cell] scoring done', { score: scoring.score, safe: scoring.safe, reason: scoring.reason })
                      return { score: scoring.score, safe: scoring.safe }
                    })
                    .catch((err) => {
                      console.warn('[bingo-cell] scoring failed, saving without score', err?.message ?? err)
                      return { score: undefined, safe: true }
                    })
                    .then(({ score: s, safe: sf }) => {
                      const updated = {
                        ...cells[payload.cellIndex],
                        imageUrl: imageUrlForCell,
                        thumbnailUrl: thumbnailUrlForCell,
                        description: result.description,
                        ...(s != null && { score: s }),
                        safe: sf,
                      }
                      cells[payload.cellIndex] = updated
                      const db = website.db!.drizzle
                      return db.update(bingo_cards).set({ blob: { ...cardBlob, cells } }).where(eq(bingo_cards.id, card.id))
                        .then(() => ({ cell: cells[payload.cellIndex], cells }))
                    })
                }
                const updated = {
                  ...cells[payload.cellIndex],
                  imageUrl: imageUrlForCell,
                  thumbnailUrl: thumbnailUrlForCell,
                  description: result.description,
                  safe: true,
                }
                cells[payload.cellIndex] = updated
                console.log('[bingo-cell] saving to DB (no scoring for free space)...')
                const db = website.db!.drizzle
                return db.update(bingo_cards).set({ blob: { ...cardBlob, cells } }).where(eq(bingo_cards.id, card.id))
                  .then(() => ({ cell: cells[payload.cellIndex], cells }))
              })
            })
          })
        })
    })
    .then((result) => {
      if (!result) return
      console.log('[bingo-cell] response sent ok')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    })
    .catch((err) => {
      console.log('[bingo-cell] error', err?.message ?? String(err))
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message ?? String(err) }))
    })
}

/** POST /api/bingo-player-name: body { cardId, playerName }. Sets/clears card player name stored in bingo_cards.blob.playerName. */
function bingoPlayerNameController(res: ServerResponse, req: IncomingMessage, website: Website) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  if (!website.db) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Database not configured.' }))
    return
  }
  readRequestBody(req)
    .then((buf) => {
      const body = JSON.parse(buf.toString()) as { cardId?: number | string; playerName?: string }
      const cardId = typeof body?.cardId === 'number' ? body.cardId : parseInt(String(body?.cardId ?? ''), 10)
      const playerName = sanitizePlayerName(body?.playerName)
      if (!Number.isFinite(cardId) || cardId < 1) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'cardId required' }))
        return null
      }
      return { cardId, playerName }
    })
    .then((payload) => {
      if (!payload) return null
      const db = website.db!.drizzle
      return db.select().from(bingo_cards).where(eq(bingo_cards.id, payload.cardId)).limit(1).then((rows) => {
        const card = rows[0]
        if (!card) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Card not found' }))
          return null
        }
        const cardBlob = parseBingoCardBlob(card.blob)
        const nextBlob = { ...cardBlob, playerName: payload.playerName }
        return db.update(bingo_cards).set({ blob: nextBlob }).where(eq(bingo_cards.id, card.id)).then(() => payload)
      })
    })
    .then((payload) => {
      if (!payload) return
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, cardId: payload.cardId, playerName: payload.playerName }))
    })
    .catch((err) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message ?? String(err) }))
    })
}

/** POST /api/claim-card: body { cardId }. Requires auth. Sets bingo_cards.ownerId to current user so they can save their card. */
function claimCardController(
  res: ServerResponse,
  req: IncomingMessage,
  website: Website,
  requestInfo: RequestInfo
) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  const userId = requestInfo.userAuth?.userId
  if (!userId) {
    res.statusCode = 401
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'You must be logged in to save your card.' }))
    return
  }
  if (!website.db) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Database not configured.' }))
    return
  }
  readRequestBody(req)
    .then((buf) => {
      const body = JSON.parse(buf.toString()) as { cardId?: number | string }
      const cardId = typeof body?.cardId === 'number' ? body.cardId : parseInt(String(body?.cardId ?? ''), 10)
      if (!Number.isFinite(cardId) || cardId < 1) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'cardId required' }))
        return null
      }
      return { cardId, userId }
    })
    .then((payload) => {
      if (!payload) return null
      const db = website.db!.drizzle
      return db.update(bingo_cards).set({ ownerId: payload.userId }).where(eq(bingo_cards.id, payload.cardId)).then(() => payload)
    })
    .then((payload) => {
      if (!payload) return
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, cardId: payload.cardId }))
    })
    .catch((err) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: (err as Error).message ?? String(err) }))
    })
}

/** Shared: load bingo card + event and return game state (or null if card not found). Used by bingo-game API and preview API/homepage. */
async function getBingoGameState(cardId: number, website: Website): Promise<{ cardId: number; eventName: string; playerName: string | null; gridSize: number; cells: Array<{ prompt?: string; imageUrl?: string | null; description?: string | null; isFreeSpace?: boolean }> } | null> {
  if (!website.db) return null
  const rows = await website.db.drizzle.select().from(bingo_cards).where(eq(bingo_cards.id, cardId)).limit(1)
  const card = rows[0]
  if (!card) return null
  const eventRows = await website.db.drizzle.select().from(events).where(eq(events.id, card.eventId)).limit(1)
  const event = eventRows[0]
  const cardBlob = parseBingoCardBlob(card.blob)
  let rawCells = Array.isArray(cardBlob.cells) ? cardBlob.cells : []
  if (rawCells.length === 0 && event?.prompts) {
    const prompts: string[] = typeof event.prompts === 'string' ? (() => { try { return JSON.parse(event.prompts) } catch { return [] } })() : (event.prompts ?? [])
    const gridSizeNum = event.gridSize === '5' ? 5 : 3
    rawCells = buildPhotoHuntCells(prompts, gridSizeNum)
    await website.db.drizzle.update(bingo_cards).set({ blob: { ...cardBlob, cells: rawCells } }).where(eq(bingo_cards.id, card.id)).catch((err) => console.error('[bingo] Failed to persist rebuilt cells:', err))
  }
  const cells = rawCells.map((c: any) => ({ ...c, isFreeSpace: false }))
  const gridSize = event?.gridSize === '5' ? 5 : 3
  return { cardId: card.id, eventName: event?.name ?? '', playerName: sanitizePlayerName(cardBlob.playerName), gridSize, cells }
}

/** GET /api/bingo-game/:cardId. Returns JSON { cardId, eventName, playerName, gridSize, cells } for client-side render. */
function getBingoGameStateController(res: ServerResponse, cardId: number, website: Website) {
  if (!website.db) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Database not configured.' }))
    return
  }
  getBingoGameState(cardId, website)
    .then((state) => {
      if (!state) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Card not found' }))
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(state))
    })
    .catch((err) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message ?? String(err) }))
    })
}

/** Preview shape for bingo-card-preview partial and GET /api/bingo-card-preview/:cardId. */
type BingoCardPreview = { cardId: number; playerName: string | null; title: string; cardUrl: string; gridSize: number; is3x3: boolean; cells: Array<{ prompt?: string; imageUrl?: string | null; thumbnailUrl?: string | null; description?: string | null; isFreeSpace?: boolean }> }

/** Load preview data for one card. Returns null if card not found. Use for API or server-render. */
async function getBingoCardPreview(cardId: number, website: Website): Promise<BingoCardPreview | null> {
  const state = await getBingoGameState(cardId, website)
  if (!state) return null
  const rawCells = state.cells.map((c: any) => ({
    ...c,
    thumbnailUrl: c.thumbnailUrl ?? c.imageUrl ?? null,
  }))
  const cells = rawCells.length > 0 ? rawCells : PLACEHOLDER_CELLS_3X3
  const title = `${state.eventName} — Card #${state.cardId}`
  return {
    cardId: state.cardId,
    playerName: state.playerName,
    title,
    cardUrl: `/bingo/${state.cardId}`,
    gridSize: state.gridSize,
    is3x3: state.gridSize === 3,
    cells,
  }
}

/** GET /api/bingo-card-preview/:cardId. Returns JSON { cardId, title, cardUrl, gridSize, cells } for previews (e.g. homepage). */
function getBingoCardPreviewController(res: ServerResponse, cardId: number, website: Website) {
  if (!website.db) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Database not configured.' }))
    return
  }
  getBingoCardPreview(cardId, website)
    .then((preview) => {
      if (!preview) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Card not found' }))
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(preview))
    })
    .catch((err) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message ?? String(err) }))
    })
}

/** Load preview data for featured card IDs. Returns array (placeholder for missing cards). */
async function loadFeaturedCardsPreview(website: Website, cardIds: number[]): Promise<BingoCardPreview[]> {
  const results = await Promise.all(cardIds.map((id) => getBingoCardPreview(id, website)))
  return results.map((preview, i) => preview ?? {
    cardId: cardIds[i],
    playerName: null,
    title: `Card ${cardIds[i]}`,
    cardUrl: `/bingo/${cardIds[i]}`,
    gridSize: 3 as const,
    is3x3: true,
    cells: PLACEHOLDER_CELLS_3X3,
  })
}

/** GET /api/bingo-event/:eventId/admin-data. Returns { eventId, eventName, gridSize, prompts, cards } for edit-event admin. */
function getBingoEventAdminDataController(res: ServerResponse, eventId: number, website: Website) {
  if (!website.db) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Database not configured.' }))
    return
  }
  website.db.drizzle.select().from(events).where(eq(events.id, eventId)).limit(1)
    .then((rows: any[]) => {
      const event = rows[0]
      if (!event) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Event not found' }))
        return null
      }
      let prompts: string[] = []
      try {
        prompts = JSON.parse(event.prompts || '[]')
      } catch {
        prompts = (event.prompts || '').split(/\n/).map((s: string) => s.trim()).filter(Boolean)
      }
      const approvedCardIds = getApprovedCardIds(event.blob)
      return website.db!.drizzle.select().from(bingo_cards).where(eq(bingo_cards.eventId, eventId)).orderBy(asc(bingo_cards.id))
        .then((cardRows: any[]) => {
          const ownerIds = [...new Set((cardRows.map((r) => r.ownerId).filter((id) => id != null) as number[]))]
          return (ownerIds.length > 0
            ? website.db!.drizzle.select().from(users).where(inArray(users.id, ownerIds))
            : Promise.resolve([])
          ).then((userRows: any[]) => {
            const ownerMap = new Map<number, { name: string; email: string }>()
            userRows.forEach((u) => {
              if (u?.id != null) ownerMap.set(u.id, { name: u.name ?? '', email: u.email ?? '' })
            })
            const cards = cardRows.map((row) => {
              let blob = row.blob
              if (typeof blob === 'string') {
                try {
                  blob = JSON.parse(blob) as { cells?: Array<{ prompt?: string; imageUrl?: string; description?: string; score?: number; safe?: boolean }> }
                } catch {
                  blob = {}
                }
              }
              const cells = Array.isArray((blob as any)?.cells) ? (blob as any).cells : []
              const filledCount = cells.filter((c: any) => c?.imageUrl).length
              const totalScore = cells.reduce((sum: number, c: any) => sum + (typeof c?.score === 'number' ? c.score : 0), 0)
              const hasFlagged = cells.some((c: any) => c?.safe === false)
              const note = hasFlagged ? 'Flagged' : (filledCount > 0 ? 'OK' : '—')
              const owner = row.ownerId != null ? ownerMap.get(row.ownerId) ?? null : null
              return {
                id: row.id,
                createdAt: row.createdAt,
                filledCount,
                cells,
                totalScore,
                note,
                approved: approvedCardIds.includes(row.id),
                owner,
              }
            })
            // Per-prompt average score: for each prompt, average score of all submitted cells (across cards) with that prompt
            const promptScores = prompts.map((prompt) => {
              let sum = 0
              let count = 0
              cards.forEach((card) => {
                card.cells.forEach((c: any) => {
                  if (c?.prompt === prompt && c?.imageUrl && typeof c.score === 'number') {
                    sum += c.score
                    count += 1
                  }
                })
              })
              return count > 0 ? Math.round((sum / count) * 10) / 10 : 0
            })
            return {
              eventId: event.id,
              eventName: event.name,
              gridSize: event.gridSize === '5' ? 5 : 3,
              prompts,
              promptScores,
              cards,
              approvedCardIds,
            }
          })
        })
    })
    .then((data) => {
      if (!data) return
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
    })
    .catch((err) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message ?? String(err) }))
    })
}

/** POST /api/bingo-event/:eventId/approve-cards. Body { cardIds: number[] }. Updates event blob.approvedCardIds. */
function approveCardsController(
  res: ServerResponse,
  req: IncomingMessage,
  eventId: number,
  website: Website
) {
  if (req.method !== 'POST' || !website.db) {
    res.statusCode = req.method !== 'POST' ? 405 : 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: req.method !== 'POST' ? 'Method not allowed' : 'Database not configured.' }))
    return
  }
  readRequestBody(req)
    .then((buf) => {
      const body = JSON.parse(buf.toString()) as { cardIds?: unknown }
      const raw = Array.isArray(body.cardIds) ? body.cardIds : []
      const cardIds = raw.filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0)
      return { eventId, cardIds }
    })
    .then(({ eventId: eid, cardIds }) =>
      website.db!.drizzle.select().from(events).where(eq(events.id, eid)).limit(1).then((rows: any[]) => {
        const event = rows[0]
        if (!event) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Event not found' }))
          return null
        }
        let blob = event.blob
        if (typeof blob === 'string') {
          try {
            blob = JSON.parse(blob) as Record<string, unknown>
          } catch {
            blob = {}
          }
        }
        const nextBlob = { ...(blob && typeof blob === 'object' ? blob : {}), approvedCardIds: cardIds }
        return website.db!.drizzle.update(events).set({ blob: nextBlob }).where(eq(events.id, eid)).then(() => ({ cardIds }))
      })
    )
    .then((out) => {
      if (!out) return
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, approvedCardIds: out.cardIds }))
    })
    .catch((err) => {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message ?? String(err) }))
    })
}

/** POST /api/mistral-describe: body { imageUrl }. Returns { description, usage? } or { error }. */
function mistralDescribeController(res: ServerResponse, req: IncomingMessage) {
  console.debug('[mistral] mistral-describe request method=', req.method)
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  readRequestBody(req)
    .then((buf) => {
      const raw = buf.toString()
      console.debug('[mistral] body length:', raw.length)
      const body = JSON.parse(raw) as { imageUrl?: string }
      const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : ''
      if (!imageUrl) {
        console.debug('[mistral] missing or empty imageUrl')
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'imageUrl required' }))
        return null
      }
      console.debug('[mistral] imageUrl received, length:', imageUrl.length)
      return loadMistralApiKey().then((key) => (key ? { key, imageUrl } : null))
    })
    .then((ctx) => {
      if (!ctx) {
        console.debug('[mistral] no API key, returning 503')
        if (!res.headersSent) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Mistral API key not configured (MISTRAL_API_KEY in config/secrets.js)' }))
        }
        return null
      }
      console.debug('[mistral] calling describeImage')
      return describeImage(ctx.key, ctx.imageUrl)
    })
    .then((result) => {
      if (result == null) return
      console.debug('[mistral] sending success response')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    })
    .catch((err) => {
      console.debug('[mistral] controller error:', err?.message ?? err)
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message ?? String(err) }))
    })
}

/** Role-based route rules: SmugMug paths require user or admin (concatenated with Thalia default routes). */
const smugmugRoutes: RoleRouteRule[] = [
  { path: '/', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'], guest: ['read'] } },
  /** Password reset flow: guest must access these without being logged in. */
  { path: '/forgotPassword', permissions: { admin: [...ALL_PERMISSIONS], user: ['read', 'create'], guest: ['read', 'create'] } },
  { path: '/resetPassword', permissions: { admin: [...ALL_PERMISSIONS], user: ['read', 'create'], guest: ['read', 'create'] } },
  { path: '/logon', permissions: { admin: [...ALL_PERMISSIONS], user: ['read', 'create'], guest: ['read', 'create'] } },
  { path: '/js', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'], guest: ['read'] } },
  { path: '/css', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'], guest: ['read'] } },
  { path: '/galleries', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'] } },
  { path: '/album', permissions: { admin: [...ALL_PERMISSIONS], user: ['read', 'update'] } },
  { path: '/create-album', permissions: { admin: [...ALL_PERMISSIONS], user: ['read', 'create'] } },
  { path: '/album-create', permissions: { admin: [...ALL_PERMISSIONS], user: ['create'] } },
  { path: '/album-edit', permissions: { admin: [...ALL_PERMISSIONS], user: ['update'] } },
  { path: '/list-smugmug-albums', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'] } },
  { path: '/album-json', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'] } },
  { path: '/uploadPhoto', permissions: { admin: [...ALL_PERMISSIONS], user: ['create'] } },
  { path: '/api', permissions: { admin: [...ALL_PERMISSIONS], user: ['create', 'read'], guest: ['create', 'read'] } },
  /** UploadThing callbacks come from their servers (no session); guest must be allowed so the callback succeeds. */
  { path: '/api/uploadthing', permissions: { guest: ['create', 'read'], admin: [...ALL_PERMISSIONS], user: ['create', 'read'] } },
  /** Longer path so it matches before /api/uploadthing; cleanup stays admin-only. */
  { path: '/api/uploadthing-cleanup', permissions: { admin: [...ALL_PERMISSIONS], user: [] } },
  { path: '/uploadthing-test', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'] } },
  { path: '/mistral-test', permissions: { admin: [...ALL_PERMISSIONS], user: ['read', 'create'] } },
  { path: '/websocket-test', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'] } },
  { path: '/pricing', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'], guest: ['read'] } },
  { path: '/photo-upload-disclaimer', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'], guest: ['read'] } },
  { path: '/list-events', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'] } },
  { path: '/create-event', permissions: { admin: [...ALL_PERMISSIONS], user: ['create'] } },
  { path: '/edit-event', permissions: { admin: [...ALL_PERMISSIONS], user: ['update'] } },
  { path: '/event', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'], guest: ['read'] } },
  { path: '/bingo', permissions: { admin: [...ALL_PERMISSIONS], user: ['read', 'create'], guest: ['read', 'create'] } },
]

/** Hosts that can serve this site. Add your deployment host (e.g. IP:port or hostname) so the route guard allows access. */
const smugmugDomains = ['localhost', '100.75.136.113:3535', 'mistral.david-ma.net', '100.116.54.46:1337', 'backup.david-ma.net']

const smugmugConfig: RawWebsiteConfig = {
  domains: smugmugDomains,
  routes: smugmugRoutes,
  database: {
    schemas: {
      albums,
      images,
      image_notes,
      events,
      bingo_cards,
    },
    machines: {
      albums: AlbumMachine,
      images: ImageMachine,
      smugmug: smugMugUploader,
    },
  },
  controllers: {
    /** Serves / (root): Unihack Photo Hunt landing. New visitors start via joinUrl; repeat visitors use localStorage to continue. */
    homepage: (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const html = website.getContentHtml('index', 'wrapper')({
        title: 'Unihack Photo Hunt',
        siteName: 'Unihack Photo Hunt',
        joinUrl: UNIHACK_JOIN_URL,
        unihackUrl: 'https://www.unihack.net/',
        currentYear: new Date().getFullYear(),
        userAuth: requestInfo.userAuth ?? {},
      })
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    /** Old SmugMug galleries gate; use /smugmug_homepage or link from nav if needed. */
    smugmug_homepage: (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const userAuth = requestInfo.userAuth ?? {}
      const html = website.getContentHtml('smugmug_index', 'wrapper')({
        title: 'Galleries',
        siteName: 'SmugMug',
        currentYear: new Date().getFullYear(),
        userAuth,
      })
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    smugmugAlbums: AlbumMachine.controller.bind(AlbumMachine),
    smugmugImages: ImageMachine.controller.bind(ImageMachine),
    uploadPhoto: uploadPhotoController,
    api: apiController,
    'uploadthing-test': (res: ServerResponse, _req: IncomingMessage, website: Website) => {
      const html = website.getContentHtml('uploadthing-test', 'uploadthing-test')({})
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    'mistral-test': (res: ServerResponse, _req: IncomingMessage, website: Website) => {
      const html = website.getContentHtml('mistral-test', 'mistral-test')({})
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    'websocket-test': (res: ServerResponse, _req: IncomingMessage, website: Website) => {
      const html = website.getContentHtml('websocket-test', 'websocket-test')({})
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    'pricing': (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const html = website.getContentHtml('pricing', 'wrapper')({
        title: 'Pricing',
        userAuth: requestInfo.userAuth,
      })
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    'photo-upload-disclaimer': (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const html = website.getContentHtml('photo-upload-disclaimer', 'wrapper')({
        title: 'Photo upload disclaimer',
        siteName: 'SmugMug',
        currentYear: new Date().getFullYear(),
        userAuth: requestInfo.userAuth ?? {},
      })
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    'list-events': (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      if (!website.db) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'text/html')
        res.end('<h1>Service Unavailable</h1><p>Database not configured.</p>')
        return
      }
      website.db.drizzle.select().from(events).where(isNull(events.deletedAt)).orderBy(asc(events.name))
        .then((rows: any[]) => {
          const html = website.getContentHtml('list-events', 'wrapper')({
            title: 'Bingo events',
            events: rows,
            userAuth: requestInfo.userAuth ?? {},
            siteName: 'SmugMug',
            currentYear: new Date().getFullYear(),
          })
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        })
        .catch((err: Error) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${err.message}</p>`)
        })
    },
    'create-event': (res: ServerResponse, req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      if (req.method === 'POST') {
        parseForm(res, req).then((form: { fields: Record<string, string> }) => {
          const name = (form.fields?.name ?? '').trim()
          const slug = (form.fields?.slug ?? '').trim().toLowerCase().replace(/\s+/g, '-')
          const gridSize = (form.fields?.gridSize ?? '3') === '5' ? '5' : '3'
          const promptsText = (form.fields?.prompts ?? '').trim()
          const description = (form.fields?.description ?? '').trim()
          if (!name || !slug) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'text/html')
            res.end('<h1>Bad Request</h1><p>Name and slug required.</p>')
            return
          }
          let prompts: string[]
          try {
            prompts = JSON.parse(promptsText || '[]')
          } catch {
            prompts = promptsText.split(/\n/).map((s) => s.trim()).filter(Boolean)
          }
          const minPrompts = gridSize === '5' ? 25 : 9
          if (prompts.length < minPrompts) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'text/html')
            res.end(`<h1>Bad Request</h1><p>At least ${minPrompts} prompts required for ${gridSize}×${gridSize} photo hunt grid.</p>`)
            return
          }
          if (!website.db) {
            res.statusCode = 503
            res.end('Database not configured.')
            return
          }
          website.db.drizzle.insert(events).values({
            name,
            slug,
            gridSize,
            description: description || null,
            prompts: JSON.stringify(prompts),
          }).then(() => {
            res.setHeader('Location', '/list-events')
            res.statusCode = 302
            res.end()
          }).catch((err: Error) => {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/html')
            res.end(`<h1>Error</h1><p>${err.message}</p>`)
          })
        })
        return
      }
      const html = website.getContentHtml('create-event', 'wrapper')({
        title: 'Create bingo event',
        userAuth: requestInfo.userAuth ?? {},
        siteName: 'SmugMug',
        currentYear: new Date().getFullYear(),
      })
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    'edit-event': (res: ServerResponse, req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const slug = requestInfo.action || ''
      if (!slug || !website.db) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html')
        res.end('<h1>Bad Request</h1><p>Event slug required.</p>')
        return
      }
      const db = website.db.drizzle
      db.select().from(events).where(eq(events.slug, decodeURIComponent(slug))).limit(1)
        .then((rows: any[]) => {
          const event = rows[0]
          if (!event) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/html')
            res.end('<h1>Not Found</h1><p>Event not found.</p>')
            return
          }
          if (req.method === 'POST') {
            parseForm(res, req).then((form: { fields: Record<string, string> }) => {
              const name = (form.fields?.name ?? '').trim()
              const gridSize = (form.fields?.gridSize ?? '5') === '5' ? '5' : '3'
              const promptsText = (form.fields?.prompts ?? '').trim()
              const description = (form.fields?.description ?? '').trim()
              let prompts: string[]
              try {
                prompts = JSON.parse(promptsText || '[]')
              } catch {
                prompts = promptsText.split(/\n/).map((s) => s.trim()).filter(Boolean)
              }
              const minPrompts = gridSize === '5' ? 25 : 9
              if (prompts.length < minPrompts) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'text/html')
                res.end(`<h1>Bad Request</h1><p>At least ${minPrompts} prompts required for photo hunt grid.</p>`)
                return
              }
              db.update(events).set({ name: name || event.name, gridSize, description: description || null, prompts: JSON.stringify(prompts) }).where(eq(events.id, event.id))
                .then(() => {
                  res.setHeader('Location', '/list-events')
                  res.statusCode = 302
                  res.end()
                })
                .catch((err: Error) => {
                  res.statusCode = 500
                  res.end(`<h1>Error</h1><p>${err.message}</p>`)
                })
            })
            return
          }
          let promptsList: string[] = []
          try {
            promptsList = JSON.parse(event.prompts || '[]')
          } catch {
            promptsList = (event.prompts || '').split(/\n/).map((s: string) => s.trim()).filter(Boolean)
          }
          const html = website.getContentHtml('edit-event', 'wrapper')({
            title: 'Edit event',
            event: { ...event, promptsList, promptsAsText: promptsList.join('\n'), isGrid3: event.gridSize === '3', isGrid5: event.gridSize === '5' },
            userAuth: requestInfo.userAuth ?? {},
            siteName: 'SmugMug',
            currentYear: new Date().getFullYear(),
          })
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        })
        .catch((err: Error) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${err.message}</p>`)
        })
    },
    event: (res: ServerResponse, req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const pathname = requestInfo.pathname ?? ''
      const pathParts = pathname.split('/').filter(Boolean)
      const isJoin = pathParts[pathParts.length - 1] === 'join' && pathParts[0] === 'event' && pathParts.length === 3
      const slug = isJoin ? decodeURIComponent(pathParts[1]) : (requestInfo.action || '')
      if (!slug || !website.db) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html')
        res.end('<h1>Bad Request</h1><p>Event slug required.</p>')
        return
      }
      const db = website.db.drizzle
      db.select().from(events).where(and(eq(events.slug, slug), isNull(events.deletedAt))).limit(1)
        .then((rows: any[]) => {
          const event = rows[0]
          if (!event) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/html')
            res.end('<h1>Not Found</h1><p>Event not found.</p>')
            return
          }
          if (isJoin && req.method === 'GET') {
            const prompts: string[] = JSON.parse(event.prompts || '[]')
            const gridSize = event.gridSize === '5' ? 5 : 3
            const cells = buildPhotoHuntCells(prompts, gridSize)
            return db.insert(bingo_cards).values({ eventId: event.id, ownerId: null, blob: { cells } })
              .then((insertResult: any) => {
                const cardId = insertResult?.insertId ?? insertResult?.[0]?.insertId
                if (!cardId) throw new Error('No card id returned')
                res.setHeader('Location', `/bingo/${cardId}`)
                res.statusCode = 302
                res.end()
              })
          }
          let promptsList: string[] = []
          try {
            promptsList = JSON.parse(event.prompts || '[]')
          } catch {
            promptsList = []
          }
          const approvedIds = getApprovedCardIds(event.blob)
          if (approvedIds.length === 0) {
            const html = website.getContentHtml('event-show', 'wrapper')({
              title: event.name,
              event: { ...event, promptsList },
              joinUrl: `/event/${encodeURIComponent(event.slug)}/join`,
              approvedCards: [],
              userAuth: requestInfo.userAuth ?? {},
              siteName: 'SmugMug',
              currentYear: new Date().getFullYear(),
            })
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
            return
          }
          return db
            .select()
            .from(bingo_cards)
            .where(and(inArray(bingo_cards.id, approvedIds), eq(bingo_cards.eventId, event.id)))
            .then((cardRows: any[]) => {
              const gridSizeNum = event.gridSize === '5' ? 5 : 3
              const approvedCards = cardRows.map((card) => {
                const playerName = getCardPlayerName(card)
                return {
                  id: card.id,
                  playerName,
                  cells: getCardCellsForPreview(card),
                  gridSize: gridSizeNum,
                  is3x3: gridSizeNum === 3,
                  eventName: event.name,
                  cardUrl: `/bingo/${card.id}`,
                  title: `Card #${card.id}`,
                }
              })
              const html = website.getContentHtml('event-show', 'wrapper')({
                title: event.name,
                event: { ...event, promptsList },
                joinUrl: `/event/${encodeURIComponent(event.slug)}/join`,
                approvedCards,
                userAuth: requestInfo.userAuth ?? {},
                siteName: 'SmugMug',
                currentYear: new Date().getFullYear(),
              })
              res.setHeader('Content-Type', 'text/html')
              res.end(html)
            })
        })
        .catch((err: Error) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${err.message}</p>`)
        })
    },
    bingo: (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const host = requestInfo.host ?? 'unknown'
      const pathname = requestInfo.pathname ?? ''
      console.log('[bingo] request host=%s pathname=%s action=%s', host, pathname, requestInfo.action ?? '')
      const cardIdRaw = requestInfo.action || ''
      const cardId = parseInt(cardIdRaw, 10)
      if (!Number.isFinite(cardId) || !website.db) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html')
        res.end('<h1>Bad Request</h1><p>Card ID required.</p>')
        return
      }
      website.db.drizzle.select().from(bingo_cards).where(eq(bingo_cards.id, cardId)).limit(1)
        .then((rows: any[]) => {
          const card = rows[0]
          if (!card) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/html')
            res.end('<h1>Not Found</h1><p>Card not found.</p>')
            return
          }
          return website.db!.drizzle.select().from(events).where(eq(events.id, card.eventId)).limit(1).then((eventRows: any[]) => {
            const event = eventRows[0]
            const cardBlob = parseBingoCardBlob(card.blob)
            let rawCells = Array.isArray(cardBlob.cells) ? cardBlob.cells : []
            if (rawCells.length === 0 && event?.prompts) {
              const prompts: string[] = typeof event.prompts === 'string' ? (() => { try { return JSON.parse(event.prompts) } catch { return [] } })() : (event.prompts ?? [])
              const gridSizeNum = event.gridSize === '5' ? 5 : 3
              rawCells = buildPhotoHuntCells(prompts, gridSizeNum)
              website.db!.drizzle.update(bingo_cards).set({ blob: { ...cardBlob, cells: rawCells } }).where(eq(bingo_cards.id, card.id)).catch((err) => console.error('[bingo] Failed to persist rebuilt cells:', err))
            }
            const cells = rawCells.map((c: any) => ({ ...c, isFreeSpace: false }))
            const gridSize = event?.gridSize === '5' ? 5 : 3
            const html = website.getContentHtml('bingo-card', 'wrapper')({
              title: 'Photo Hunt',
              cardId: card.id,
              gridSize,
              cells,
              eventName: event?.name,
              playerName: sanitizePlayerName(cardBlob.playerName),
              cardOwnerId: card.ownerId ?? null,
              userAuth: requestInfo.userAuth ?? {},
              siteName: 'Unihack Photo Hunt',
              currentYear: new Date().getFullYear(),
            })
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
          })
        })
        .catch((err: Error) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${err.message}</p>`)
        })
    },
    'album-json': (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const slug = requestInfo.action || ''
      if (!slug) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Album slug required.' }))
        return
      }
      if (!website.db) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Database not configured.' }))
        return
      }
      const db = website.db.drizzle
      resolveSlugToAlbumKey(db, slug)
        .then((albumKey) => {
          if (!albumKey) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Album not found.' }))
            return null
          }
          return loadSmugMugCreds().then((creds) => {
            if (!creds) {
              res.statusCode = 503
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'SmugMug credentials not configured.' }))
              return null
            }
            return Promise.all([getAlbum(creds, albumKey), getAlbumImages(creds, albumKey)])
          })
        })
        .then((out) => {
          if (!out) return
          const [album, imagesList] = Array.isArray(out) ? out : [null, null]
          if (!album) return
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ...album, images: imagesList ?? [] }))
        })
        .catch((err) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: (err as Error).message }))
        })
    },
    'list-smugmug-albums': (
      res: ServerResponse,
      _req: IncomingMessage,
      _website: Website,
      _requestInfo: RequestInfo,
    ) => {
      loadSmugMugCreds()
        .then((creds) => {
          if (!creds) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                error: 'SmugMug credentials not configured (config/secrets.js or config/smugmugAuth.js)',
              }),
            )
            return
          }
          return listAlbums(creds)
        })
        .then((albumsList) => {
          if (!albumsList) return
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(albumsList))
        })
        .catch((err) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: (err as Error).message }))
        })
    },
    galleries: (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      if (!website.db) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'text/html')
        res.end('<h1>Service Unavailable</h1><p>Database not configured.</p>')
        return
      }
      const db = website.db.drizzle
      db.select()
        .from(albums)
        .where(isNull(albums.deletedAt))
        .orderBy(asc(albums.name))
        .then((rows: any[]) => {
          const albumsList = rows.map((r: any) => {
            const slug = r.urlName && String(r.urlName).trim() ? r.urlName : r.albumKey
            return {
              name: r.name,
              urlName: r.urlName,
              slug: slug,
              slugEncoded: encodeURIComponent(slug),
            }
          })
          const html = website.getContentHtml('galleries', 'wrapper')({
            title: 'Galleries',
            albums: albumsList,
            userAuth: requestInfo.userAuth ?? {},
            siteName: 'SmugMug',
            currentYear: new Date().getFullYear(),
          })
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
          loadSmugMugCreds().then((creds) => {
            if (creds) topUpAlbumsFromApi(creds, db, albums).catch(() => {})
          })
        })
        .catch((err: Error) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${err.message}</p>`)
        })
    },
    album: (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const pathname = requestInfo.pathname ?? ''
      const pathParts = pathname.split('/').filter(Boolean)
      // /album/slug/image/imageKey -> ['album', 'slug', 'image', 'imageKey']
      const isImageShow = pathParts.length === 4 && pathParts[0] === 'album' && pathParts[2] === 'image'
      if (isImageShow) {
        const slug = decodeURIComponent(pathParts[1])
        const imageKey = pathParts[3]
        if (!website.db) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'text/html')
          res.end('<h1>Service Unavailable</h1><p>Database not configured.</p>')
          return
        }
        const db = website.db.drizzle
        resolveSlugToAlbumKey(db, slug)
          .then((albumKey) => {
            if (!albumKey) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'text/html')
              res.end('<h1>Not Found</h1><p>Album not found.</p>')
              return null
            }
            return Promise.all([
              db.select().from(images).where(and(eq(images.albumKey, albumKey), eq(images.imageKey, imageKey))).limit(1),
              db.select().from(image_notes).where(and(eq(image_notes.albumKey, albumKey), eq(image_notes.imageKey, imageKey))).limit(1),
            ]).then(([imgRows, noteRows]) => ({ albumKey, image: imgRows[0], noteRow: noteRows[0] ?? null }))
          })
          .then((ctx) => {
            if (!ctx) return
            if (!ctx.image) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'text/html')
              res.end('<h1>Not Found</h1><p>Image not found.</p>')
              return
            }
            let noteData: { description?: string; usage?: unknown; [k: string]: unknown } | null = null
            if (ctx.noteRow?.note) {
              try {
                noteData = JSON.parse(ctx.noteRow.note) as { description?: string; usage?: unknown; [k: string]: unknown }
              } catch {
                noteData = { description: ctx.noteRow.note }
              }
            }
            const displaySlug = encodeURIComponent(slug)
            const html = website.getContentHtml('image-show', 'wrapper')({
              title: ctx.image.filename ?? 'Image',
              albumKey: ctx.albumKey,
              albumSlug: slug,
              albumSlugEncoded: displaySlug,
              image: {
                imageKey: ctx.image.imageKey,
                url: ctx.image.url,
                thumbnailUrl: ctx.image.thumbnailUrl,
                caption: ctx.image.caption,
                filename: ctx.image.filename,
              },
              note: noteData,
              userAuth: requestInfo.userAuth ?? {},
              siteName: 'SmugMug',
              currentYear: new Date().getFullYear(),
            })
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
          })
          .catch((err: Error) => {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/html')
            res.end(`<h1>Error</h1><p>${err.message}</p>`)
          })
        return
      }
      const slug = requestInfo.action || ''
      if (!slug) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html')
        res.end('<h1>Bad Request</h1><p>Album slug required.</p>')
        return
      }
      if (!website.db) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'text/html')
        res.end('<h1>Service Unavailable</h1><p>Database not configured.</p>')
        return
      }
      const db = website.db.drizzle
      resolveSlugToAlbumKey(db, slug).then((albumKey) => {
        if (!albumKey) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/html')
          res.end('<h1>Not Found</h1><p>Album not found.</p>')
          return
        }
        return Promise.all([
          db.select().from(albums).where(eq(albums.albumKey, albumKey)).limit(1),
          db.select().from(images).where(eq(images.albumKey, albumKey)),
        ])
          .then(([albumRows, imageRows]) => {
            const albumRow = albumRows[0]
            const album = albumRow
              ? {
                  name: albumRow.name,
                  description: albumRow.description,
                  privacy: albumRow.privacy,
                  urlName: albumRow.urlName,
                  uri: albumRow.uri,
                  webUri: albumRow.webUri,
                  dateAdded: albumRow.dateAdded,
                  dateModified: albumRow.dateModified,
                }
              : {
                  name: null,
                  description: null,
                  privacy: null,
                  urlName: null,
                  uri: null,
                  webUri: null,
                  dateAdded: null,
                  dateModified: null,
                }
            const imagesForTemplate = imageRows.map((r: any) => ({
              imageKey: r.imageKey,
              caption: r.caption,
              thumbnailUrl: r.thumbnailUrl,
              url: r.url,
              fileName: r.filename,
            }))
            const displaySlug = albumRow?.urlName && String(albumRow.urlName).trim() ? albumRow.urlName : albumKey
            const html = website.getContentHtml(
              'album-show',
              'wrapper',
            )({
              title: albumRow?.name ?? 'Album',
              albumKey,
              albumSlug: displaySlug,
              albumSlugEncoded: encodeURIComponent(displaySlug),
              album,
              images: imagesForTemplate,
              userAuth: requestInfo.userAuth ?? {},
              siteName: 'SmugMug',
              currentYear: new Date().getFullYear(),
            })
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
            loadSmugMugCreds().then((creds) => {
              if (creds) topUpAlbumAndImagesFromApi(creds, db, albumKey, albums, images).catch(() => {})
            })
          })
          .catch((err: Error) => {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/html')
            res.end(`<h1>Error</h1><p>${err.message}</p>`)
          })
      })
    },
    'create-album': (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      const html = website.getContentHtml('create-album', 'wrapper')({
        title: 'New album',
        userAuth: requestInfo.userAuth ?? {},
        siteName: 'SmugMug',
        currentYear: new Date().getFullYear(),
      })
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    },
    'album-create': (res: ServerResponse, req: IncomingMessage, website: Website, _requestInfo: RequestInfo) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end('Method Not Allowed')
        return
      }
      parseForm(res, req)
        .then((form: { fields: Record<string, string> }) => {
          const name = (form.fields?.Name ?? '').trim()
          if (!name) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'text/html')
            res.end('<h1>Bad Request</h1><p>Album name is required.</p>')
            return null
          }
          return loadSmugMugCreds().then((creds) => {
            if (!creds) {
              res.statusCode = 503
              res.setHeader('Content-Type', 'text/html')
              res.end('<h1>Service Unavailable</h1><p>SmugMug credentials not configured.</p>')
              return null
            }
            return createAlbum(creds, {
              Name: name,
              Description: form.fields?.Description?.trim() || undefined,
              Privacy: form.fields?.Privacy?.trim() || undefined,
              UrlName: form.fields?.UrlName?.trim() || undefined,
            }).then(({ albumKey, urlName }) => {
              const slug =
                urlName && String(urlName).trim()
                  ? encodeURIComponent(urlName.trim())
                  : albumKey
              return { slug }
            })
          })
        })
        .then((out) => {
          if (!out) return
          res.statusCode = 302
          res.setHeader('Location', `/album/${out.slug}`)
          res.end()
        })
        .catch((err) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${(err as Error).message}</p>`)
        })
    },
    'album-edit': (res: ServerResponse, req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end('Method Not Allowed')
        return
      }
      parseForm(res, req)
        .then((form: { fields: Record<string, string> }) => {
          const albumKey = form.fields?.albumKey || ''
          if (!albumKey) {
            res.statusCode = 400
            res.end('Missing albumKey')
            return null
          }
          return loadSmugMugCreds().then((creds) => {
            if (!creds) {
              res.statusCode = 503
              res.end('SmugMug credentials not configured')
              return null
            }
            const fields: Record<string, string> = {}
            if (form.fields.Name != null) fields.Name = form.fields.Name
            if (form.fields.Description != null) fields.Description = form.fields.Description
            if (form.fields.Privacy != null) fields.Privacy = form.fields.Privacy
            if (form.fields.UrlName != null) fields.UrlName = form.fields.UrlName
            return patchAlbum(creds, albumKey, fields).then(() => {
              if (!website.db) return { albumKey }
              return website.db.drizzle
                .select({ urlName: albums.urlName })
                .from(albums)
                .where(eq(albums.albumKey, albumKey))
                .limit(1)
                .then((rows: any[]) => {
                  const r = rows[0]
                  const slug =
                    r?.urlName && String(r.urlName).trim()
                      ? encodeURIComponent(r.urlName.trim())
                      : albumKey
                  return { slug }
                })
            })
          })
        })
        .then((out) => {
          if (!out) return
          const slug = 'slug' in out ? out.slug : out.albumKey
          res.statusCode = 302
          res.setHeader('Location', `/album/${slug}`)
          res.end()
        })
        .catch((err) => {
          res.statusCode = 500
          res.end((err as Error).message)
        })
    },
  },
}

const temp_config = recursiveObjectMerge(security.securityConfig(), smugmugConfig)

import { websocket_config } from './lib-websocket.js'
export const config = recursiveObjectMerge(temp_config, websocket_config)
export { buildPhotoHuntCells }