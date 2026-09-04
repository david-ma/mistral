#!/usr/bin/env bun
/**
 * Simple MariaDB backup — shell pipeline, Bun only orchestrates.
 *
 *   docker compose exec -T db mariadb-dump … | gzip > tmp/….sql.gz
 *
 * Usage:
 *   bun run db:backup
 *
 * Restore (example):
 *   gzip -dc tmp/smugmug_backup_YYYY-MM-DD_HH-MM-SS.sql.gz \
 *     | docker compose exec -T db mariadb -usmugmug_user -psmugmug_password smugmug
 */
import { mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'

const REPO_ROOT = path.join(import.meta.dir, '..')

const DB_NAME = process.env.SMUGMUG_DB_NAME ?? 'smugmug'
const DB_USER = process.env.SMUGMUG_DUMP_USER ?? 'smugmug_user'
const DB_PASSWORD = process.env.SMUGMUG_DUMP_PASSWORD ?? 'smugmug_password'
const BACKUP_DIR = process.env.SMUGMUG_BACKUP_DIR ?? path.join(REPO_ROOT, 'tmp')

function timestampStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-') +
    '_' +
    [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('-')
  )
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2)
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size
  } catch {
    return 0
  }
}

async function main(): Promise<void> {
  const stamp = timestampStamp()
  const baseName = `smugmug_backup_${stamp}`
  const sqlGz = path.join(BACKUP_DIR, `${baseName}.sql.gz`)
  const sqlGzTmp = `${sqlGz}.tmp`

  await mkdir(BACKUP_DIR, { recursive: true })

  const dumpArgs = [
    'compose',
    'exec',
    '-T',
    'db',
    'mariadb-dump',
    `-u${DB_USER}`,
    `-p${DB_PASSWORD}`,
    DB_NAME,
    '--single-transaction',
    '--quick',
    '--lock-tables=false',
  ]

  const docker = ['docker', ...dumpArgs].map(shellQuote).join(' ')
  const pipeline = `set -o pipefail; ${docker} | gzip > ${shellQuote(sqlGzTmp)}`
  const logged = pipeline.replace(`-p${DB_PASSWORD}`, '-p***')

  console.log(`[backup] database=${DB_NAME} -> ${sqlGz}`)
  console.log(`[backup] ${logged}`)

  const t0 = Date.now()
  const proc = Bun.spawn(['bash', '-o', 'pipefail', '-c', pipeline], {
    cwd: REPO_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  const bytes = await fileSize(sqlGzTmp)

  if (exitCode !== 0) {
    console.error(`[backup] FAILED exit=${exitCode} partial=${formatMiB(bytes)} MiB`)
    process.exit(exitCode || 1)
  }

  if (bytes === 0) {
    console.error('[backup] FAILED: empty output')
    process.exit(1)
  }

  const verify = Bun.spawn(['gzip', '-t', sqlGzTmp], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await verify.exited) !== 0) {
    console.error('[backup] FAILED: gzip -t')
    process.exit(1)
  }

  await rename(sqlGzTmp, sqlGz)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[backup] OK ${formatMiB(bytes)} MiB in ${secs}s`)
  console.log(`[backup] ${sqlGz}`)
}

main().catch((err: unknown) => {
  console.error('[backup] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
