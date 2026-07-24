/**
 * Image notes: AI-generated and non-AI metadata per image.
 * (albumKey, imageKey) identify the image in the images table.
 * note: JSON blob, e.g. { "description": "...", "faces": [...], "exif": {...} }.
 */
import { util } from 'thalia/models'
import { mysqlTable, text } from 'drizzle-orm/mysql-core'
import { MySqlTableWithColumns } from 'drizzle-orm/mysql-core'

export const image_notes: MySqlTableWithColumns<any> = mysqlTable('image_notes', {
  ...util.baseTableConfig,
  albumKey: util.vc('album_key'),
  imageKey: util.vc('image_key').notNull(),
  note: text('note').notNull(), // JSON blob: description, faces, exif, etc.
})
