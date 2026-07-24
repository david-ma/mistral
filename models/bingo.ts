/**
 * Bingo: events (with grid size + prompts) and cards (one per player, cells filled by upload + Mistral).
 */
import { util, models } from 'thalia/models'
import { mysqlTable, text, int, json, boolean } from 'drizzle-orm/mysql-core'
import { MySqlTableWithColumns } from 'drizzle-orm/mysql-core'

export const events: MySqlTableWithColumns<any> = mysqlTable('events', {
  ...util.baseTableConfig,
  name: util.vc('name').notNull(),
  slug: util.vc('slug').notNull().unique(),
  ownerId: int('owner_id').references(() => models.users.id),
  description: text('description'),
  /** '3' or '5' for 3×3 or 5×5 grid */
  gridSize: util.vc('grid_size').notNull().default('3'),
  /** JSON array of prompt strings: length 9 for 3×3, 25 for 5×5 */
  prompts: text('prompts').notNull(),
  /** Optional JSON: { approvedCardIds?: number[] } — bingo card IDs to show publicly on event page and homepage. Old events without this are safe (treat as []). */
  blob: json('blob'),
})

export const bingo_cards: MySqlTableWithColumns<any> = mysqlTable('bingo_cards', {
  ...util.baseTableConfig,
  eventId: int('event_id').references(() => events.id),
  ownerId: int('owner_id').references(() => models.users.id),
  approved: boolean('approved').notNull().default(false),
  /** { "cells": [ { "prompt": "...", "imageUrl": "...", "thumbnailUrl": "...", "description": "..." }, ... ] } — 9 or 25 cells; imageUrl/thumbnailUrl from SmugMug after upload */
  blob: json('blob'),
})
