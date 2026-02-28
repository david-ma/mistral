/**
 * SmugMug API helpers. OAuth 1.0a signed requests; list albums and (later) more.
 * Credentials: load from config/secrets.js or config/smugmugAuth.js (gitignored).
 */

import https from 'https'
import crypto from 'crypto'

const BASE_URL = 'https://api.smugmug.com'

export type SmugMugCredentials = {
  consumer_key: string
  consumer_secret: string
  oauth_token: string
  oauth_token_secret: string
}

/** Normalised album/node for display. */
export type SmugMugAlbum = {
  nodeId: string
  name: string
  type: string
  uri: string
  urlName?: string
  /** Last segment of uri for use in URLs, e.g. /album/{{albumKey}} */
  albumKey?: string
}

/** Normalised image for display. */
export type SmugMugImage = {
  imageKey: string
  caption?: string
  thumbnailUrl?: string
  url?: string
  fileName?: string
}

function oauthEscape(s: string): string {
  if (s === undefined) return ''
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

function sortParams(obj: Record<string, string>): Record<string, string> {
  const keys = Object.keys(obj).sort()
  const out: Record<string, string> = {}
  keys.forEach((k) => { out[k] = obj[k] })
  return out
}

function expandParams(params: Record<string, string>): string {
  return Object.keys(params).map((k) => `${k}=${params[k]}`).join('&')
}

function b64HmacSha1(key: string, data: string): string {
  return crypto.createHmac('sha1', key).update(data).digest('base64')
}

function bundleAuthorization(url: string, params: Record<string, string>): string {
  const parts = Object.keys(params).map((k) => {
    let v = params[k]
    if (k === 'oauth_signature') v = encodeURIComponent(v)
    return `${k}="${v}"`
  })
  return `OAuth realm="${url}",${parts.join(',')}`
}

function signRequest(
  creds: SmugMugCredentials,
  method: string,
  targetUrl: string
): Record<string, string> {
  const urlObj = new URL(targetUrl)
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`
  const queryParams: Record<string, string> = {}
  urlObj.searchParams.forEach((v, k) => { queryParams[k] = v })

  const params: Record<string, string> = {
    oauth_consumer_key: creds.consumer_key,
    oauth_nonce: Math.random().toString().replace('0.', ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.oauth_token,
    oauth_version: '1.0',
    ...queryParams,
  }

  const sorted = sortParams(params)
  const escaped = oauthEscape(expandParams(sorted))
  const sigBase = `${method}&${oauthEscape(baseUrl)}&${escaped}`
  const sigKey = `${creds.consumer_secret}&${creds.oauth_token_secret}`
  params.oauth_signature = b64HmacSha1(sigKey, sigBase)

  if (params.oauth_signature.match(/[+/]/)) {
    return signRequest(creds, method, targetUrl)
  }
  return params
}

/**
 * Build paths for SmugMug API v2. Use with get(): get(creds, apiPath.album(key)), get(creds, apiPath.albumImages(key)), etc.
 */
export const apiPath = {
  /** GET /api/v2/album/:key */
  album: (albumKey: string) => `/api/v2/album/${encodeURIComponent(albumKey.replace(/!.*$/, ''))}`,
  /** GET /api/v2/album/:key!images */
  albumImages: (albumKey: string) => `${apiPath.album(albumKey)}!images`,
}

/**
 * Generic signed GET for any SmugMug API path (e.g. apiPath.album(key), apiPath.albumImages(key), or custom paths like /api/v2!authuser).
 * Returns parsed JSON.
 */
export function get(creds: SmugMugCredentials, path: string): Promise<unknown> {
  const urlWithVerbosity = path.includes('?') ? `${path}&_verbosity=1` : `${path}?_verbosity=1`
  const targetUrl = `${BASE_URL}${urlWithVerbosity}`
  const params = signRequest(creds, 'GET', targetUrl)

  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      host: 'api.smugmug.com',
      port: 443,
      path: urlWithVerbosity,
      method: 'GET',
      headers: {
        Authorization: bundleAuthorization(targetUrl, params),
        Accept: 'application/json',
        'X-Smug-ResponseType': 'JSON',
      },
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`SmugMug API ${res.statusCode}: ${data.slice(0, 300)}`))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error(`SmugMug API non-JSON: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Perform a signed POST with a JSON body. path is e.g. /api/v2/user/name!albums
 */
export function post(creds: SmugMugCredentials, path: string, body: Record<string, unknown>): Promise<unknown> {
  const targetUrl = `${BASE_URL}${path}`
  const params = signRequest(creds, 'POST', targetUrl)
  const bodyStr = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      host: 'api.smugmug.com',
      port: 443,
      path: path,
      method: 'POST',
      headers: {
        Authorization: bundleAuthorization(targetUrl, params),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Smug-ResponseType': 'JSON',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf8'),
      },
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`SmugMug API ${res.statusCode}: ${data.slice(0, 300)}`))
          return
        }
        try {
          resolve(data ? JSON.parse(data) : {})
        } catch {
          reject(new Error(`SmugMug API non-JSON: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.end(bodyStr, 'utf8')
  })
}

/**
 * Perform a signed PATCH with a JSON body. path is e.g. /api/v2/album/XYZ
 */
export function patch(creds: SmugMugCredentials, path: string, body: Record<string, unknown>): Promise<unknown> {
  const targetUrl = `${BASE_URL}${path}`
  const params = signRequest(creds, 'PATCH', targetUrl)
  const bodyStr = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      host: 'api.smugmug.com',
      port: 443,
      path: path,
      method: 'PATCH',
      headers: {
        Authorization: bundleAuthorization(targetUrl, params),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Smug-ResponseType': 'JSON',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf8'),
      },
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`SmugMug API ${res.statusCode}: ${data.slice(0, 300)}`))
          return
        }
        try {
          resolve(data ? JSON.parse(data) : {})
        } catch {
          reject(new Error(`SmugMug API non-JSON: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.end(bodyStr, 'utf8')
  })
}

/** Album metadata for display/edit (from GET /api/v2/album/KEY). */
export type SmugMugAlbumDetail = {
  albumKey: string
  name: string
  description?: string
  privacy?: string
  urlName?: string
  uri: string
  webUri?: string
  dateAdded?: string
  dateModified?: string
}

/**
 * Get one album's metadata (GET /api/v2/album/KEY).
 */
export function getAlbum(creds: SmugMugCredentials, albumKey: string): Promise<SmugMugAlbumDetail> {
  const path = `/api/v2/album/${encodeURIComponent(albumKey)}`
  return get(creds, path).then((body: any) => {
    const a = body?.Response?.Album ?? body?.Response
    if (!a) throw new Error('SmugMug getAlbum: no Album in response')
    return {
      albumKey,
      name: a.Name ?? a.Title ?? '',
      description: a.Description ?? '',
      privacy: a.Privacy ?? '',
      urlName: a.UrlName ?? '',
      uri: a.Uri ?? '',
      webUri: a.WebUri ?? '',
      dateAdded: a.DateAdded ?? '',
      dateModified: a.DateModified ?? '',
    }
  })
}

/**
 * Update album metadata (PATCH /api/v2/album/KEY). Pass only fields to update, e.g. { Name, Description, Privacy, UrlName }.
 */
export function patchAlbum(
  creds: SmugMugCredentials,
  albumKey: string,
  fields: Record<string, string>
): Promise<unknown> {
  const path = `/api/v2/album/${encodeURIComponent(albumKey)}`
  return patch(creds, path, fields)
}

/** Fields for creating a new album (POST to folder!albums per Album reference). */
export type CreateAlbumFields = {
  Name: string
  Description?: string
  Privacy?: string
  UrlName?: string
}

/**
 * Create a new album under the authenticated user's root folder.
 * Per https://api.smugmug.com/api/v2/doc/reference/album.html: POST to the FolderAlbums
 * endpoint of the folder, e.g. /api/v2/folder/user/example!albums with body
 * { Title, NiceName?, Privacy?, Description? }. Returns the new album key.
 */
export function createAlbum(
  creds: SmugMugCredentials,
  fields: CreateAlbumFields
): Promise<{ albumKey: string; uri?: string }> {
  return getAuthUserUri(creds).then((userPath) => {
    const match = userPath.match(/\/user\/([^/!]+)/)
    const username = match ? match[1] : ''
    if (!username) throw new Error('SmugMug createAlbum: could not get username from user URI')
    const folderPath = `/api/v2/folder/user/${encodeURIComponent(username)}!albums`
    const body: Record<string, string> = { Title: fields.Name }
    if (fields.Privacy != null && fields.Privacy.trim()) body.Privacy = fields.Privacy.trim()
    if (fields.UrlName != null && fields.UrlName.trim()) body.NiceName = fields.UrlName.trim()
    if (fields.Description != null && fields.Description.trim()) body.Description = fields.Description.trim()
    return post(creds, folderPath, body).then((data: any) => {
      const album = data?.Response?.Album ?? data?.Response
      const uri = album?.Uri ?? album?.uri
      const albumKey =
        (uri ? uri.split('/').filter(Boolean).pop() : null) ??
        album?.AlbumKey ??
        album?.Key ??
        album?.NodeID ??
        ''
      if (!albumKey) throw new Error('SmugMug createAlbum: no album key in response')
      const urlName = album?.UrlName ?? album?.NiceName ?? album?.urlName ?? ''
      return { albumKey, uri, urlName }
    })
  })
}

/**
 * Get the authenticated user's URI from /api/v2!authuser (e.g. /api/v2/user/frostickle).
 */
function getAuthUserUri(creds: SmugMugCredentials): Promise<string> {
  return get(creds, '/api/v2!authuser').then((body: any) => {
    const user = body?.Response?.User
    if (!user) throw new Error('SmugMug authuser: no User in response')
    const userUri = user.Uri ?? user.Uris?.Node?.Uri ?? user.Node?.Uri
    if (!userUri || typeof userUri !== 'string') {
      throw new Error('SmugMug authuser: could not find User URI')
    }
    return userUri.startsWith('http') ? new URL(userUri).pathname : userUri
  })
}

/**
 * List albums (and folders) under a node. nodePath is the API path, e.g. /api/v2/node/SCSW8.
 * Returns child nodes; filter by type "Album" if you only want albums.
 */
export function getNodeChildren(
  creds: SmugMugCredentials,
  nodePath: string
): Promise<SmugMugAlbum[]> {
  const base = nodePath.replace(/\/$/, '').replace(/!children$/, '')
  const path = base + '!children'
  return get(creds, path).then((body: any) => {
    const list = body?.Response?.Node?.Children ?? body?.Response?.Children ?? []
    const nodes = Array.isArray(list) ? list : []
    return nodes.map((n: any) => ({
      nodeId: n.NodeID ?? n.NodeId ?? n.Key ?? '',
      name: n.Name ?? '',
      type: n.Type ?? 'Unknown',
      uri: n.Uri ?? '',
      urlName: n.UrlName,
    }))
  })
}

/**
 * List albums for a user via the User!albums endpoint (e.g. /api/v2/user/frostickle!albums).
 * Response shape may be Response.Album or Response.User.Albums etc.
 */
function getUserAlbums(creds: SmugMugCredentials, userPath: string): Promise<SmugMugAlbum[]> {
  const base = userPath.replace(/\/$/, '').replace(/!albums$/, '')
  const path = base + '!albums'
  return get(creds, path).then((body: any) => {
    const res = body?.Response
    const list = res?.Album ?? res?.Albums ?? res?.User?.Albums ?? res?.User?.Album ?? []
    const albums = Array.isArray(list) ? list : (list ? [list] : [])
    return albums.map((a: any) => {
      const uri = a.Uri ?? ''
      const albumKey = uri ? uri.split('/').filter(Boolean).pop() : (a.AlbumKey ?? a.NodeID ?? a.NodeId ?? a.Key ?? '')
      return {
        nodeId: a.NodeID ?? a.NodeId ?? a.AlbumKey ?? a.Key ?? '',
        name: a.Name ?? a.Title ?? '',
        type: a.Type ?? 'Album',
        uri,
        urlName: a.UrlName,
        albumKey: albumKey ?? '',
      }
    })
  })
}

/**
 * List images in an album via Album!images (e.g. /api/v2/album/XYZ!images).
 */
export function getAlbumImages(
  creds: SmugMugCredentials,
  albumKey: string
): Promise<SmugMugImage[]> {
  const base = albumKey.replace(/!images$/, '').replace(/!albumimages$/, '')
  const path = `/api/v2/album/${encodeURIComponent(base)}!images`
  return get(creds, path).then((body: any) => {
    const res = body?.Response
    const list = res?.AlbumImage ?? res?.AlbumImages ?? res?.Image ?? res?.Images ?? res?.Album?.Images ?? []
    const items = Array.isArray(list) ? list : (list ? [list] : [])
    return items.map((img: any) => ({
      imageKey: img.ImageKey ?? img.Key ?? img.AlbumImageKey ?? '',
      caption: img.Caption ?? img.Title,
      thumbnailUrl: img.ThumbnailUrl ?? img.SmallImageUrl,
      url: img.Url ?? img.LargeImageUrl,
      fileName: img.FileName,
    }))
  })
}

/**
 * List the authenticated user's albums. Uses User!albums (e.g. /api/v2/user/frostickle!albums).
 */
export function listAlbums(
  creds: SmugMugCredentials,
  _options: { includeFolders?: boolean } = {}
): Promise<SmugMugAlbum[]> {
  return getAuthUserUri(creds).then((userPath) => getUserAlbums(creds, userPath))
}

/** Result of getImageSizeDetails: direct media URLs for display and thumbnail (JPEG/PNG etc.). */
export type ImageSizeDetailsUrls = {
  /** URL suitable for display or external consumers (e.g. Mistral); direct image, not a page. */
  url: string
  /** Smaller URL for thumbnails. */
  thumbnailUrl: string
}

/**
 * Fetch ImageSizeDetails for an image (raw media URLs). Use this to get direct image URLs
 * that external APIs (e.g. Mistral) can load; the upload response "URL" may be a web page.
 * imageUri: path from upload response Image.ImageUri (e.g. /api/v2/image/xxxxx).
 */
export function getImageSizeDetails(
  creds: SmugMugCredentials,
  imageUri: string
): Promise<ImageSizeDetailsUrls> {
  const pathOnly = imageUri.startsWith('http') ? new URL(imageUri).pathname : imageUri
  const path = pathOnly.replace(/\?.*$/, '') + '!sizedetails'
  console.log('[bingo-cell] getImageSizeDetails GET', path)
  return get(creds, path).then((body: any) => {
    const raw = body?.Response?.ImageSizeDetails ?? body?.Response ?? body
    if (!raw || typeof raw !== 'object') {
      throw new Error('SmugMug ImageSizeDetails: no response')
    }
    const byName: Record<string, string> = {}
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const name = item?.Size ?? item?.SizeName ?? item?.Name ?? ''
        const url = item?.Url ?? item?.url
        if (name && typeof url === 'string' && url.startsWith('http')) byName[String(name)] = url
      }
    } else {
      for (const key of Object.keys(raw)) {
        const val = raw[key]
        const url = val?.Url ?? val?.url
        if (typeof url === 'string' && url.startsWith('http')) byName[key] = url
      }
    }
    const preferOrder = ['Medium', 'Large', 'Small', 'X2Large', 'X3Large', 'Thumb', 'Tiny']
    let url = ''
    let thumbnailUrl = ''
    for (const name of preferOrder) {
      if (byName[name]) {
        if (!url && !['Thumb', 'Tiny'].includes(name)) url = byName[name]
        if (!thumbnailUrl && (name === 'Thumb' || name === 'Small' || name === 'Tiny')) thumbnailUrl = byName[name]
      }
    }
    if (!url) url = Object.values(byName)[0] ?? ''
    if (!thumbnailUrl) thumbnailUrl = url
    if (!url) {
      console.log('[bingo-cell] getImageSizeDetails: no media URL in response, keys:', Object.keys(byName))
      throw new Error('SmugMug ImageSizeDetails: no media URL found')
    }
    return { url, thumbnailUrl }
  })
}

/** Options for uploading a file buffer to a SmugMug album. */
export type UploadToAlbumOptions = {
  caption?: string
  title?: string
  keywords?: string
  filename?: string
}

/** Raw upload response from upload.smugmug.com (Image.AlbumImageUri, Image.URL, etc.). */
export type SmugMugUploadResponse = {
  stat: string
  method: string
  Image: {
    StatusImageReplaceUri: string
    ImageUri: string
    AlbumImageUri: string
    URL: string
  }
  Asset: { AssetComponentUri: string; AssetUri: string }
}

function createMultipartFromBuffer(
  buffer: Buffer,
  boundary: string,
  filename: string,
  mimeType: string
): Buffer {
  const parts = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, '\\"')}"`,
    `Content-Type: ${mimeType}`,
    '',
    buffer,
    '',
    `--${boundary}--`,
  ]
  return Buffer.concat(
    parts.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part + '\r\n')))
  )
}

/**
 * Upload a file buffer to a SmugMug album. Uses OAuth 1.0a POST to upload.smugmug.com.
 * Returns the raw upload response; use get(creds, response.Image.AlbumImageUri) for full AlbumImage metadata.
 */
export function uploadToAlbum(
  creds: SmugMugCredentials,
  albumKey: string,
  fileBuffer: Buffer,
  mimeType: string,
  options: UploadToAlbumOptions = {}
): Promise<SmugMugUploadResponse> {
  const targetUrl = 'https://upload.smugmug.com/'
  const params = signRequest(creds, 'POST', targetUrl)
  const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2, 10)
  const filename = options.filename ?? 'image.jpg'
  const caption = options.caption ?? ''
  const title = options.title ?? filename
  const keywords = options.keywords ?? ''

  const formData = createMultipartFromBuffer(
    fileBuffer,
    boundary,
    filename,
    mimeType || 'image/jpeg'
  )

  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      host: 'upload.smugmug.com',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        Authorization: bundleAuthorization(targetUrl, params),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formData.length,
        'X-Smug-AlbumUri': `/api/v2/album/${albumKey.replace(/!.*$/, '')}`,
        'X-Smug-Caption': caption,
        'X-Smug-FileName': filename,
        'X-Smug-Keywords': keywords,
        'X-Smug-ResponseType': 'JSON',
        'X-Smug-Title': title,
        'X-Smug-Version': 'v2',
      },
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`SmugMug upload ${res.statusCode}: ${data.slice(0, 300)}`))
          return
        }
        try {
          resolve(JSON.parse(data) as SmugMugUploadResponse)
        } catch {
          reject(new Error(`SmugMug upload non-JSON: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.end(formData)
  })
}
