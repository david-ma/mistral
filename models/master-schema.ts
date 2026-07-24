/**
 * Usage:
 * - Add your model schemas here
 * - bun drizzle-kit generate
 * - bun drizzle-kit push
 */

import { models } from 'thalia/models'
import { MySqlTableWithColumns } from 'drizzle-orm/mysql-core'
import { mailTable } from 'thalia/mail'

const users: MySqlTableWithColumns<any> = models.users
const sessions: MySqlTableWithColumns<any> = models.sessions
const audits: MySqlTableWithColumns<any> = models.audits
const albums: MySqlTableWithColumns<any> = models.albums
const images: MySqlTableWithColumns<any> = models.images
const mail: MySqlTableWithColumns<any> = mailTable as unknown as MySqlTableWithColumns<any>

import { fruit } from './fruit'
import { image_notes } from './image_notes'
import { events, bingo_cards } from './bingo'
export { users, sessions, audits, albums, images, fruit, mail, image_notes, events, bingo_cards }
