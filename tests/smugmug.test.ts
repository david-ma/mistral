/**
 * Tests for SmugMug helpers (config/lib-smugmug.ts).
 * - Unit: bad/incomplete credentials, response shape.
 * - Integration: listAlbums against real API when credentials are available (e.g. SMUGMUG_RUN_INTEGRATION=1 or config present).
 */

import { describe, test, expect } from 'bun:test'
import {
  getNodeChildren,
  listAlbums,
  type SmugMugCredentials,
  type SmugMugAlbum,
} from '../config/lib-smugmug.js'

const minimalCreds: SmugMugCredentials = {
  consumer_key: 'key',
  consumer_secret: 'secret',
  oauth_token: 'token',
  oauth_token_secret: 'token_secret',
}

describe('SmugMug helpers', () => {
  describe('listAlbums', () => {
    test('throws when credentials are missing oauth_token', async () => {
      const bad = { ...minimalCreds, oauth_token: '' }
      await expect(listAlbums(bad)).rejects.toThrow()
    })

    test('throws when credentials are missing consumer_key', async () => {
      const bad = { ...minimalCreds, consumer_key: '' }
      await expect(listAlbums(bad)).rejects.toThrow()
    })

    test('returns an array (integration)', async () => {
      const runIntegration = process.env.SMUGMUG_RUN_INTEGRATION === '1'
      if (!runIntegration) {
        expect(true).toBe(true)
        return
      }
      const creds = await loadTestCreds()
      if (!creds) {
        expect(true).toBe(true)
        return
      }
      const albums = await listAlbums(creds)
      expect(Array.isArray(albums)).toBe(true)
      albums.forEach((a: SmugMugAlbum) => {
        expect(a).toHaveProperty('nodeId')
        expect(a).toHaveProperty('name')
        expect(a).toHaveProperty('type')
        expect(a).toHaveProperty('uri')
      })
    })
  })

  describe('getNodeChildren', () => {
    test('throws on invalid path when API returns error', async () => {
      await expect(getNodeChildren(minimalCreds, '/api/v2/node/invalid999!children')).rejects.toThrow()
    })
  })
})

async function loadTestCreds(): Promise<SmugMugCredentials | null> {
  try {
    const path = await import('path')
    const { pathToFileURL } = await import('url')
    const configDir = path.join(import.meta.dirname, '..', 'config')
    const secretsPath = path.join(configDir, 'secrets.js')
    const authPath = path.join(configDir, 'smugmugAuth.js')
    const fs = await import('fs')
    const mod = fs.existsSync(secretsPath)
      ? await import(pathToFileURL(secretsPath).href)
      : fs.existsSync(authPath)
        ? await import(pathToFileURL(authPath).href)
        : null
    const creds = mod?.smugmug ?? mod?.default
    if (
      creds &&
      typeof creds.consumer_key === 'string' &&
      typeof creds.consumer_secret === 'string' &&
      typeof creds.oauth_token === 'string' &&
      typeof creds.oauth_token_secret === 'string'
    ) {
      return creds as SmugMugCredentials
    }
  } catch {
    // ignore
  }
  return null
}
