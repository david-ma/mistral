/**
 * Usage:
 * - Add your model schemas here
 * - bun drizzle-kit generate
 * - bun drizzle-kit push
 */

// Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Consider adding an extension to the import path.ts(2834)
import { models } from '../node_modules/thalia/models'
// import { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'
import { MySqlTableWithColumns } from 'drizzle-orm/mysql-core'

const users: MySqlTableWithColumns<any> = models.users
const sessions: MySqlTableWithColumns<any> = models.sessions
const audits: MySqlTableWithColumns<any> = models.audits
const albums: MySqlTableWithColumns<any> = models.albums
const images: MySqlTableWithColumns<any> = models.images

import { mailTable } from '../node_modules/thalia/server/mail.js'
const mail: MySqlTableWithColumns<any> = mailTable as unknown as MySqlTableWithColumns<any>


// export { users, sessions, audits, albums, images }

import { fruit } from './fruit.js'
export { users, sessions, audits, albums, images, fruit, mail }