#!/usr/bin/env node
// Echo — schema tool. Deliberately small: migrations are SQL, this only
// applies them in order and refuses to let an applied one change.
//
//   node scripts/db.mjs up        start the local Postgres container
//   node scripts/db.mjs migrate   apply pending migrations
//   node scripts/db.mjs test      reset + migrate + run the RLS/grant suite
//   node scripts/db.mjs reset     drop everything this project created
//   node scripts/db.mjs down      stop and remove the container
//
// The local container matches Supabase's Postgres major version. Everything
// here runs against a plain Postgres too — the auth.users shim in test/shim
// stands in for Supabase Auth so the same migrations apply either way.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const MIGRATIONS = join(ROOT, 'migrations')
const TESTS = join(ROOT, 'test')

const CONTAINER = 'echo-pg'
const PG_IMAGE = 'postgres:15-alpine' // Supabase's major version
const PORT = process.env.ECHO_DB_PORT ?? '55432'
const URL =
  process.env.DATABASE_URL ??
  `postgres://postgres:postgres@127.0.0.1:${PORT}/echo`

const sh = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

async function connect(url = URL) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  return client
}

async function waitForPostgres(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const c = await connect()
      await c.end()
      return
    } catch (err) {
      if (Date.now() > deadline) throw err
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

// --- commands --------------------------------------------------------------

async function up() {
  const running = sh('docker', ['ps', '-aq', '-f', `name=^${CONTAINER}$`]).trim()
  if (running) {
    sh('docker', ['start', CONTAINER])
  } else {
    sh('docker', [
      'run', '-d',
      '--name', CONTAINER,
      '-e', 'POSTGRES_PASSWORD=postgres',
      '-e', 'POSTGRES_DB=echo',
      // A UTF-8 ctype is not optional. Under a C locale the default text
      // search parser does not classify Persian letters as word characters
      // and every tsvector in the database silently comes out empty — the
      // kind of failure that passes every unit test and breaks only search.
      '-e', 'LANG=C.UTF-8',
      '-e', 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C.UTF-8',
      '-p', `${PORT}:5432`,
      PG_IMAGE,
    ])
  }
  await waitForPostgres()
  console.log(`postgres up on ${PORT} (${PG_IMAGE})`)
}

function down() {
  sh('docker', ['rm', '-f', CONTAINER])
  console.log('postgres removed')
}

const LEDGER = `
  create table if not exists public.echo_migration (
    version    text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )`

function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
      return {
        version: file.replace(/\.sql$/, ''),
        file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      }
    })
}

async function migrate({ quiet = false } = {}) {
  const db = await connect()
  try {
    await db.query(LEDGER)
    const { rows } = await db.query('select version, checksum from public.echo_migration')
    const applied = new Map(rows.map((r) => [r.version, r.checksum]))

    for (const m of migrationFiles()) {
      const seen = applied.get(m.version)
      if (seen) {
        // Migrations are append-only. Editing one that has already run means
        // two databases silently disagree about their own shape.
        if (seen !== m.checksum) {
          throw new Error(
            `${m.file} changed after it was applied. Write a new migration instead.`,
          )
        }
        continue
      }
      await db.query('begin')
      try {
        await db.query(m.sql)
        await db.query(
          'insert into public.echo_migration (version, checksum) values ($1, $2)',
          [m.version, m.checksum],
        )
        await db.query('commit')
        if (!quiet) console.log(`applied ${m.file}`)
      } catch (err) {
        await db.query('rollback')
        throw new Error(`${m.file}: ${err.message}`)
      }
    }
  } finally {
    await db.end()
  }
}

async function reset() {
  const db = await connect()
  try {
    await db.query('drop schema if exists echo cascade')
    await db.query('drop schema if exists auth cascade')
    await db.query('drop schema if exists t cascade')
    await db.query('drop table if exists public.echo_migration')
    // Roles survive a schema drop; drop what they own first, then them.
    for (const role of ['echo_app', 'echo_agent', 'echo_purge']) {
      await db.query(`
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = '${role}') then
            execute 'drop owned by ${role}';
            execute 'drop role ${role}';
          end if;
        end $$;
      `)
    }
  } finally {
    await db.end()
  }
  console.log('reset')
}

// --- the suite -------------------------------------------------------------
//
// Each test file runs in its own transaction and is rolled back, so the
// fixture is identical for every file and the files cannot affect each other.

async function test() {
  await reset()

  // Supabase Auth stands behind app_user in production; locally this shim
  // provides auth.users so the same FK is exercised here.
  const shim = await connect()
  try {
    await shim.query(readFileSync(join(TESTS, 'shim', 'auth_users.sql'), 'utf8'))
  } finally {
    await shim.end()
  }

  await migrate({ quiet: true })

  const db = await connect()
  let failures = 0
  try {
    // Helpers and fixture are committed; tests read them and roll back.
    await db.query(readFileSync(join(TESTS, 'helpers.sql'), 'utf8'))
    await db.query(readFileSync(join(TESTS, 'fixture.sql'), 'utf8'))

    const files = readdirSync(TESTS)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort()

    for (const file of files) {
      const sql = readFileSync(join(TESTS, file), 'utf8')
      const notices = []
      const onNotice = (n) => notices.push(n.message)
      db.on('notice', onNotice)
      await db.query('begin')
      try {
        await db.query(sql)
        await db.query('rollback')
        const checks = notices.filter((n) => n.startsWith('ok')).length
        console.log(`PASS  ${file}  (${checks} checks)`)
      } catch (err) {
        await db.query('rollback')
        failures++
        console.error(`FAIL  ${file}`)
        for (const n of notices.filter((n) => n.startsWith('ok'))) {
          console.error(`      ${n}`)
        }
        console.error(`      ${err.message}`)
      } finally {
        db.off('notice', onNotice)
      }
    }
  } finally {
    await db.end()
  }

  if (failures) {
    console.error(`\n${failures} test file(s) failed`)
    process.exit(1)
  }
  console.log('\nthe wall holds')
}

// --- entry -----------------------------------------------------------------

const cmd = process.argv[2]
const commands = { up, down, migrate, reset, test }

if (!commands[cmd]) {
  console.error(`usage: db.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(2)
}
if (!existsSync(MIGRATIONS)) {
  console.error('no migrations directory')
  process.exit(2)
}

try {
  await commands[cmd]()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
