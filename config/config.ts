/**
 * SmugMug Thalia website config.
 * Security (users, sessions, audits) + albums/images + SmugMug API helpers.
 */

import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { RawWebsiteConfig } from 'thalia'
import { CrudFactory, SmugMugUploader } from 'thalia/controllers'
import { ThaliaSecurity } from 'thalia/security'
import { recursiveObjectMerge } from 'thalia/website'
import { albums, images } from '../models/master-schema.js'
import { listAlbums, getAlbumImages } from './lib-smugmug.js'

const mailAuthPath = path.join(import.meta.dirname, 'mailAuth.js')
const security = new ThaliaSecurity({ mailAuthPath })

const AlbumMachine = new CrudFactory(albums as any)
const ImageMachine = new CrudFactory(images as any)
const smugMugUploader = new SmugMugUploader()

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
    'list-smugmug-albums': (res, _req, _website, _requestInfo) => {
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
    galleries: (res, _req, website, _requestInfo) => {
      loadSmugMugCreds()
        .then((creds) => {
          if (!creds) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'text/html')
            res.end('<h1>Service Unavailable</h1><p>SmugMug credentials not configured.</p>')
            return
          }
          return listAlbums(creds)
        })
        .then((albumsList) => {
          if (!albumsList) return
          const html = website.getContentHtml('galleries', 'wrapper')({ albums: albumsList })
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        })
        .catch((err) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${(err as Error).message}</p>`)
        })
    },
    album: (res, _req, website, requestInfo) => {
      const albumKey = requestInfo.action || ''
      if (!albumKey) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html')
        res.end('<h1>Bad Request</h1><p>Album key required.</p>')
        return
      }
      loadSmugMugCreds()
        .then((creds) => {
          if (!creds) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'text/html')
            res.end('<h1>Service Unavailable</h1><p>SmugMug credentials not configured.</p>')
            return
          }
          return getAlbumImages(creds, albumKey).then((images) => ({ creds, images }))
        })
        .then((result) => {
          if (!result) return
          const { images } = result
          const albumName = requestInfo.slug ? decodeURIComponent(requestInfo.slug) : albumKey
          const html = website.getContentHtml('album-show', 'wrapper')({
            albumKey,
            albumName,
            images: images || [],
          })
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        })
        .catch((err) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/html')
          res.end(`<h1>Error</h1><p>${(err as Error).message}</p>`)
        })
    },
  },
}

export const config = recursiveObjectMerge(security.securityConfig(), smugmugConfig)
