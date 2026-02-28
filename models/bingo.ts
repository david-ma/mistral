/**
 * Allow bingo cards to be generated
 */
import { baseTableConfig, vc } from '../node_modules/thalia/models/util'
import { mysqlTable, text, int, json } from 'drizzle-orm/mysql-core'
import { MySqlTableWithColumns } from 'drizzle-orm/mysql-core'
import { users } from './master-schema'

export const events: MySqlTableWithColumns<any> = mysqlTable('events', {
  ...baseTableConfig,
  name: vc('name').notNull(),
  slug: vc('slug').notNull().unique(),
  ownerId: int('owner_id').references(() => users.id),
  description: text('description'),
  prompts: text('prompts'), // At least 8 prompts for generating bingo cards
  blob: json('blob'), // Anything else we want to store about the event
})

export const bingo_cards: MySqlTableWithColumns<any> = mysqlTable('bingo_cards', {
  ...baseTableConfig,
  eventId: int('event_id').references(() => events.id),
  ownerId: int('owner_id').references(() => users.id),
  blob: json('blob'), // JSON blob: { "title": "...", "description": "...", "image": "..." }
})



