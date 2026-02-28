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
import { eq, isNull, asc, or, and } from 'drizzle-orm'
import { albums, images, image_notes, events, bingo_cards } from '../models/master-schema.js'
import {
  listAlbums,
  getAlbumImages,
  getAlbum,
  patchAlbum,
  createAlbum,
  get,
  uploadToAlbum,
  type SmugMugUploadResponse,
} from './lib-smugmug.js'
import { topUpAlbumsFromApi, topUpAlbumAndImagesFromApi } from './smugmug-topup.js'
import { ServerResponse, IncomingMessage } from 'http'
import { Website } from 'thalia/website'
import { RequestInfo } from 'thalia/server'
import { createRouteHandler } from 'uploadthing/server'
import { uploadthingRouter } from './uploadthing.js'
import { addTempFile, runCleanupIfNeeded } from './uploadthing-cleanup.js'
import { loadMistralApiKey, describeImage } from './lib-mistral.js'

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
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'uploadThingUrl (or url) and albumKey required' }))
          return null
        }
        return loadSmugMugCreds().then((creds) => {
          if (!creds) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'SmugMug credentials not configured' }))
            return null
          }
          if (!url) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'uploadThingUrl or url required (client must send URL from upload response)' }))
            return null
          }
          return fetch(url)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`Fetch ${r.status}`))))
            .then((ab) => Buffer.from(ab))
            .then((buffer) => {
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
      if (!Number.isFinite(cardId) || cardId < 1 || !Number.isFinite(cellIndex) || cellIndex < 0 || !imageUrl) {
        console.debug('[bingo-cell] validation failed', { cardId, cellIndex, hasImageUrl: !!imageUrl, keys: body ? Object.keys(body) : [] })
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'cardId, cellIndex (non-negative), and imageUrl required' }))
        return null
      }
      return { cardId, cellIndex, imageUrl }
    })
    .then((payload) => {
      if (!payload) return null
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
        return null
      }
      const { card, payload } = ctx
      const blob = (card.blob as { cells?: Array<{ prompt?: string; imageUrl?: string; description?: string }> }) ?? {}
      const cells = Array.isArray(blob.cells) ? blob.cells.slice() : []
      if (payload.cellIndex >= cells.length) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Invalid cellIndex' }))
        return null
      }
      return loadMistralApiKey().then((key) => (key ? { key, cells, payload, card } : null))
    })
    .then((ctx) => {
      if (!ctx) {
        if (!res.headersSent) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Mistral API key not configured' }))
        }
        return null
      }
      const { cells, payload, card } = ctx
      const updated = { ...cells[payload.cellIndex], imageUrl: payload.imageUrl }
      cells[payload.cellIndex] = updated
      const db = website.db!.drizzle
      return describeImage(ctx.key, payload.imageUrl).then((result) => {
        updated.description = result.description
        return db.update(bingo_cards).set({ blob: { cells } }).where(eq(bingo_cards.id, card.id))
      }).then(() => ({ cell: cells[payload.cellIndex], cells }))
    })
    .then((result) => {
      if (!result) return
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
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
  { path: '/list-events', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'] } },
  { path: '/create-event', permissions: { admin: [...ALL_PERMISSIONS], user: ['create'] } },
  { path: '/edit-event', permissions: { admin: [...ALL_PERMISSIONS], user: ['update'] } },
  { path: '/event', permissions: { admin: [...ALL_PERMISSIONS], user: ['read'], guest: ['read'] } },
  { path: '/bingo', permissions: { admin: [...ALL_PERMISSIONS], user: ['read', 'create'], guest: ['read', 'create'] } },
]

const smugmugConfig: RawWebsiteConfig = {
  domains: ['localhost'],
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
    homepage: (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
      console.log("running index controller")
      const userAuth = requestInfo.userAuth ?? {}
      const html = website.getContentHtml('index', 'wrapper')({
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
          const minPrompts = gridSize === '5' ? 24 : 8
          if (prompts.length < minPrompts) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'text/html')
            res.end(`<h1>Bad Request</h1><p>At least ${minPrompts} prompts required for ${gridSize}×${gridSize} grid (centre is a free space).</p>`)
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
              const minPrompts = gridSize === '5' ? 24 : 8
              if (prompts.length < minPrompts) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'text/html')
                res.end(`<h1>Bad Request</h1><p>At least ${minPrompts} prompts required (centre is a free space).</p>`)
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
            const shuffled = prompts.slice().sort(() => Math.random() - 0.5)
            const gridSize = event.gridSize === '5' ? 5 : 3
            const total = gridSize * gridSize
            const centerIndex = total === 9 ? 4 : 12 // 3×3 → 4, 5×5 → 12
            const numPrompts = total - 1 // one free space
            const chosen = shuffled.slice(0, numPrompts)
            const cells: Array<{ prompt: string; imageUrl: null; description: null }> = []
            let p = 0
            for (let i = 0; i < total; i++) {
              if (i === centerIndex) {
                cells.push({ prompt: 'Free space', imageUrl: null, description: null, isFreeSpace: true })
              } else {
                cells.push({ prompt: chosen[p] ?? '', imageUrl: null, description: null, isFreeSpace: false })
                p++
              }
            }
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
          const html = website.getContentHtml('event-show', 'wrapper')({
            title: event.name,
            event: { ...event, promptsList },
            joinUrl: `/event/${encodeURIComponent(event.slug)}/join`,
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
    bingo: (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
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
            let blob = card.blob
            if (typeof blob === 'string') {
              try {
                blob = JSON.parse(blob) as { cells?: Array<{ prompt?: string; imageUrl?: string; description?: string }> }
              } catch {
                blob = {}
              }
            }
            blob = (blob as { cells?: Array<{ prompt?: string; imageUrl?: string; description?: string }> }) ?? {}
            let rawCells = Array.isArray(blob.cells) ? blob.cells : []
            if (rawCells.length === 0 && event?.prompts) {
              const prompts: string[] = typeof event.prompts === 'string' ? (() => { try { return JSON.parse(event.prompts) } catch { return [] } })() : (event.prompts ?? [])
              const shuffled = prompts.slice().sort(() => Math.random() - 0.5)
              const gridSizeNum = event.gridSize === '5' ? 5 : 3
              const total = gridSizeNum * gridSizeNum
              const centerIndex = total === 9 ? 4 : 12
              const numPrompts = total - 1
              const chosen = shuffled.slice(0, numPrompts)
              rawCells = []
              let p = 0
              for (let i = 0; i < total; i++) {
                if (i === centerIndex) {
                  rawCells.push({ prompt: 'Free space', imageUrl: null, description: null })
                } else {
                  rawCells.push({ prompt: chosen[p] ?? '', imageUrl: null, description: null })
                  p++
                }
              }
              website.db!.drizzle.update(bingo_cards).set({ blob: { cells: rawCells } }).where(eq(bingo_cards.id, card.id)).catch((err) => console.error('[bingo] Failed to persist rebuilt cells:', err))
            }
            const cells = rawCells.map((c: any) => ({ ...c, isFreeSpace: c.prompt === 'Free space' }))
            const gridSize = event?.gridSize === '5' ? 5 : 3
            const html = website.getContentHtml('bingo-card', 'wrapper')({
              title: 'Bingo card',
              cardId: card.id,
              gridSize,
              cells,
              eventName: event?.name,
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

export const config = recursiveObjectMerge(security.securityConfig(), smugmugConfig)
