/**
 * Database connectivity and schema health check.
 * Verifies we can connect to the DB and that the schema is functional.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { drizzle } from 'drizzle-orm/mysql2'
import { sql } from 'drizzle-orm'
import { url } from '../drizzle.config.js'
import { users, fruit } from '../models/master-schema.js'

describe('Database connection and models', () => {
  const db = drizzle(url)

  test('can connect and run a raw query', async () => {
    const result = await db.execute(sql`SELECT 1 as ok`)
    expect(result).toBeDefined()
    // mysql2 returns [rows, fields]; rows is an array of row objects
    const rows = Array.isArray(result) ? result[0] : result
    expect(rows).toBeDefined()
    const first = Array.isArray(rows) ? rows[0] : rows
    expect(first).toBeDefined()
    expect((first as { ok: number }).ok).toBe(1)
  })

  test('can query users table (schema wired)', async () => {
    const rows = await db.select().from(users).limit(1)
    expect(Array.isArray(rows)).toBe(true)
  })

  test('can query fruit table (schema wired)', async () => {
    const rows = await db.select().from(fruit).limit(1)
    expect(Array.isArray(rows)).toBe(true)
  })
})
