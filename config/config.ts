/**
 * SmugMug Thalia website config.
 * Security (users, sessions, audits) + albums/images + SmugMug API helpers.
 */
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { RawWebsiteConfig } from 'thalia/types'
import { CrudFactory, SmugMugUploader, parseForm } from 'thalia/controllers'
import { ThaliaSecurity } from 'thalia/security'
import { recursiveObjectMerge } from 'thalia/website'
import { eq, isNull, asc, or } from 'drizzle-orm'
import { albums, images } from '../models/master-schema.js'
import { listAlbums, getAlbumImages, getAlbum, patchAlbum, createAlbum } from './lib-smugmug.js'
import { topUpAlbumsFromApi, topUpAlbumAndImagesFromApi } from './smugmug-topup.js'
import { ServerResponse, IncomingMessage } from 'http'
import { Website } from 'thalia/website'
import { RequestInfo } from 'thalia/server'

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
  return import(url).then((m) => {
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
  }).catch(() => null)
}

const smugmugConfig: RawWebsiteConfig = {
  domains: ['localhost'],
  database: {
    schemas: {
      albums,
      images,
    },
    machines: {
      albums: AlbumMachine,
      images: ImageMachine,
      smugmug: smugMugUploader,
    },
  },
  controllers: {
    smugmugAlbums: AlbumMachine.controller.bind(AlbumMachine),
    smugmugImages: ImageMachine.controller.bind(ImageMachine),
    uploadPhoto: smugMugUploader.controller.bind(smugMugUploader),
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
    'list-smugmug-albums': (res: ServerResponse, _req: IncomingMessage, _website: Website, _requestInfo: RequestInfo) => {
      loadSmugMugCreds()
        .then((creds) => {
          if (!creds) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'SmugMug credentials not configured (config/secrets.js or config/smugmugAuth.js)' }))
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
    galleries: (res: ServerResponse, _req: IncomingMessage, website: Website, _requestInfo: RequestInfo) => {
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
            const slug = (r.urlName && String(r.urlName).trim()) ? r.urlName : r.albumKey
            return {
              name: r.name,
              urlName: r.urlName,
              slug: slug,
              slugEncoded: encodeURIComponent(slug),
            }
          })
          const html = website.getContentHtml('galleries', 'wrapper')({ albums: albumsList })
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
          loadSmugMugCreds().then((creds) => {
            if (creds) topUpAlbumsFromApi(creds, db, albums).catch(() => {})
          })
        })
        .catch((err: Error) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${(err).message}</p>`)
        })
    },
    album: (res: ServerResponse, _req: IncomingMessage, website: Website, requestInfo: RequestInfo) => {
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
            : { name: null, description: null, privacy: null, urlName: null, uri: null, webUri: null, dateAdded: null, dateModified: null }
          const imagesForTemplate = imageRows.map((r: any) => ({
            imageKey: r.imageKey,
            caption: r.caption,
            thumbnailUrl: r.thumbnailUrl,
            url: r.url,
            fileName: r.filename,
          }))
          const displaySlug = (albumRow?.urlName && String(albumRow.urlName).trim()) ? albumRow.urlName : albumKey
          const html = website.getContentHtml('album-show', 'wrapper')({
            albumKey,
            albumSlug: displaySlug,
            album,
            images: imagesForTemplate,
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
          res.end(`<h1>Error</h1><p>${(err).message}</p>`)
        })
      });
    },
    'create-album': (res: ServerResponse, _req: IncomingMessage, website: Website, _requestInfo: RequestInfo) => {
      const html = website.getContentHtml('create-album', 'wrapper')({})
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
            }).then(({ albumKey, uri }) => {
              const slug = (uri && uri.trim()) ? encodeURIComponent(uri.trim()) : albumKey
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
            return patchAlbum(creds, albumKey, fields).then(() => ({ albumKey }))
          })
        })
        .then((out) => {
          if (!out) return
          res.statusCode = 302
          res.setHeader('Location', `/album/${out.albumKey}`)
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
