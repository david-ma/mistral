/**
 * Track UploadThing files tagged "temporary" (used for SmugMug flow) and delete
 * oldest when total storage exceeds a threshold. Uses a JSON file for persistence.
 */
import fs from 'fs'
import path from 'path'
import { UTApi } from 'uploadthing/server'

const DATA_DIR = path.join(import.meta.dirname, '..', 'data')
const TEMP_FILE = path.join(DATA_DIR, 'uploadthing-temp.json')

/** Default threshold: 500MB. Override with UPLOADTHING_STORAGE_THRESHOLD_BYTES env. */
const DEFAULT_THRESHOLD_BYTES = 500 * 1024 * 1024

export type TempFileEntry = { fileKey: string; size: number; createdAt: string }

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readTempStore(): TempFileEntry[] {
  ensureDataDir()
  if (!fs.existsSync(TEMP_FILE)) return []
  try {
    const raw = fs.readFileSync(TEMP_FILE, 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function writeTempStore(entries: TempFileEntry[]) {
  ensureDataDir()
  fs.writeFileSync(TEMP_FILE, JSON.stringify(entries, null, 2), 'utf8')
}

/**
 * Record a temporary file (uploaded via UploadThing for SmugMug). Call after
 * successfully forwarding to SmugMug so we can prune it when over threshold.
 */
export function addTempFile(fileKey: string, size: number) {
  const entries = readTempStore()
  entries.push({
    fileKey,
    size,
    createdAt: new Date().toISOString(),
  })
  writeTempStore(entries)
}

/**
 * If total size of tracked temporary files exceeds threshold, delete oldest
 * from UploadThing and from the store until under threshold.
 * Requires UPLOADTHING_TOKEN (e.g. from secrets).
 */
export async function runCleanupIfNeeded(
  token: string | null,
  thresholdBytes: number = DEFAULT_THRESHOLD_BYTES
): Promise<{ deleted: number; freedBytes: number }> {
  if (!token) return { deleted: 0, freedBytes: 0 }
  const entries = readTempStore()
  const total = entries.reduce((sum, e) => sum + e.size, 0)
  if (total <= thresholdBytes) return { deleted: 0, freedBytes: 0 }

  const utapi = new UTApi({ token })
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  let freed = 0
  let deleted = 0
  const remaining = [...entries]

  for (const entry of sorted) {
    if (total - freed <= thresholdBytes) break
    try {
      await utapi.deleteFiles(entry.fileKey)
      freed += entry.size
      deleted += 1
      const idx = remaining.findIndex((e) => e.fileKey === entry.fileKey)
      if (idx >= 0) remaining.splice(idx, 1)
    } catch (err) {
      console.error('[uploadthing-cleanup] Failed to delete', entry.fileKey, err)
    }
  }

  if (remaining.length !== entries.length) {
    writeTempStore(remaining)
  }
  return { deleted, freedBytes: freed }
}
