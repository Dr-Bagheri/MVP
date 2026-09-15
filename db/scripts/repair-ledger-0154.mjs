#!/usr/bin/env node
// One-time ledger repair for the 0132 → 0154 renumbering (review F12).
//
//   node scripts/repair-ledger-0154.mjs
//
// The migration "the sweeps get their indexes" was applied to the dev
// project under the number 0132, then renumbered on disk to 0154 (two files
// carried 0132). Its header was rewritten in the same move, so the ledger
// row disagrees with the file on BOTH the version and the checksum, and
// `db.mjs migrate` re-runs a migration whose indexes already exist.
// 0154's own header prescribes the rename; the checksum half is what that
// note missed. Idempotent: a second run finds no row and changes nothing.
// Never a migration (it edits the ledger the migrator reads).

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(here, '..', '..', '.env.dev')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (v !== '' && process.env[k] === undefined) process.env[k] = v
  }
}
const url = process.env.DATABASE_URL
if (!url) {
  console.error('set DATABASE_URL (owner) or provide ../.env.dev')
  process.exit(2)
}
const OLD = '0132_the_sweeps_get_their_indexes'
const NEW = '0154_the_sweeps_get_their_indexes'
const checksum = createHash('sha256')
  .update(readFileSync(resolve(here, '..', 'migrations', `${NEW}.sql`)))
  .digest('hex')

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
try {
  const r = await db.query(
    'update public.echo_migration set version = $1, checksum = $2 where version = $3',
    [NEW, checksum, OLD],
  )
  console.log(r.rowCount === 1 ? `renamed ${OLD} → ${NEW}` : 'nothing to repair (already renamed)')
} finally {
  await db.end()
}
