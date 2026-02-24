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
 * Perform a signed GET to the SmugMug API. path is the path after the host, e.g. /api/v2!authuser.
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
