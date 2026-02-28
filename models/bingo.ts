/**
 * Bingo: events (with grid size + prompts) and cards (one per player, cells filled by upload + Mistral).
 */
import { baseTableConfig, vc } from '../node_modules/thalia/models/util'
import { mysqlTable, text, int, json, boolean } from 'drizzle-orm/mysql-core'
import { MySqlTableWithColumns } from 'drizzle-orm/mysql-core'
import { models } from '../node_modules/thalia/models'

export const events: MySqlTableWithColumns<any> = mysqlTable('events', {
  ...baseTableConfig,
  name: vc('name').notNull(),
  slug: vc('slug').notNull().unique(),
  ownerId: int('owner_id').references(() => models.users.id),
  description: text('description'),
  /** '3' or '5' for 3×3 or 5×5 grid */
  gridSize: vc('grid_size').notNull().default('3'),
  /** JSON array of prompt strings: length 9 for 3×3, 25 for 5×5 */
  prompts: text('prompts').notNull(),
  blob: json('blob'),
})

export const bingo_cards: MySqlTableWithColumns<any> = mysqlTable('bingo_cards', {
  ...baseTableConfig,
  eventId: int('event_id').references(() => events.id),
  ownerId: int('owner_id').references(() => models.users.id),
  approved: boolean('approved').notNull().default(false),
  /** { "cells": [ { "prompt": "...", "imageUrl": "...", "thumbnailUrl": "...", "description": "..." }, ... ] } — 9 or 25 cells; imageUrl/thumbnailUrl from SmugMug after upload */
  blob: json('blob'),
})



