/**
 * Top-up: fetch from SmugMug API and upsert into local DB.
 * Kept in a separate module so it can be removed or replaced later (e.g. by a
 * JSON endpoint that the front end calls to refresh and that also updates the DB).
 */
import { eq } from 'drizzle-orm'
import { listAlbums, getAlbum, getAlbumImages } from './lib-smugmug.js'
import type { SmugMugCredentials } from './lib-smugmug.js'

type Db = any
type AlbumsTable = any
type ImagesTable = any

/**
 * Fetch user's albums from API and upsert into albums table.
 * Call this after rendering the galleries page (fire-and-forget) or from a JSON endpoint.
 */
export async function topUpAlbumsFromApi(
  creds: SmugMugCredentials,
  db: Db,
  albumsTable: AlbumsTable
): Promise<void> {
  const list = await listAlbums(creds)
  for (const a of list) {
    const albumKey = a.albumKey ?? (a.uri ? a.uri.split('/').filter(Boolean).pop() : '')
    if (!albumKey) continue
    const existing = await db
      .select()
      .from(albumsTable)
      .where(eq(albumsTable.albumKey, albumKey))
      .limit(1)
    const row = {
      albumKey,
      name: a.name ?? null,
      urlName: a.urlName ?? null,
      uri: a.uri ?? null,
      updatedAt: new Date(),
    }
    if (existing.length > 0) {
      await db.update(albumsTable).set(row).where(eq(albumsTable.id, existing[0].id))
    } else {
      await db.insert(albumsTable).values({
        ...row,
        createdAt: new Date(),
      } as any)
    }
  }
}

/**
 * Fetch one album and its images from API and upsert into albums + images tables.
 * Call after rendering the album page (fire-and-forget) or from a JSON endpoint.
 */
export async function topUpAlbumAndImagesFromApi(
  creds: SmugMugCredentials,
  db: Db,
  albumKey: string,
  albumsTable: AlbumsTable,
  imagesTable: ImagesTable
): Promise<void> {
  const [album, imagesList] = await Promise.all([
    getAlbum(creds, albumKey),
    getAlbumImages(creds, albumKey),
  ])
  if (!album) return

  const albumRow = {
    albumKey: album.albumKey,
    name: album.name ?? null,
    description: album.description ?? null,
    privacy: album.privacy ?? null,
    urlName: album.urlName ?? null,
    uri: album.uri ?? null,
    webUri: album.webUri ?? null,
    dateAdded: album.dateAdded ?? null,
    dateModified: album.dateModified ?? null,
    updatedAt: new Date(),
  }
  const existingAlbum = await db
    .select()
    .from(albumsTable)
    .where(eq(albumsTable.albumKey, albumKey))
    .limit(1)
  if (existingAlbum.length > 0) {
    await db.update(albumsTable).set(albumRow).where(eq(albumsTable.id, existingAlbum[0].id))
  } else {
    await db.insert(albumsTable).values({
      ...albumRow,
      createdAt: new Date(),
    } as any)
  }

  for (const img of imagesList ?? []) {
    const imageKey = img.imageKey
    if (!imageKey) continue
    const existingImg = await db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.imageKey, imageKey))
      .limit(1)
    const row = {
      albumKey,
      imageKey,
      caption: img.caption ?? null,
      thumbnailUrl: img.thumbnailUrl ?? null,
      url: img.url ?? null,
      filename: img.fileName ?? null,
      updatedAt: new Date(),
    }
    if (existingImg.length > 0) {
      await db.update(imagesTable).set(row).where(eq(imagesTable.id, existingImg[0].id))
    } else {
      await db.insert(imagesTable).values({
        ...row,
        createdAt: new Date(),
      } as any)
    }
  }
}
