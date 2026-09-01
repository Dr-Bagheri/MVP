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
// Target resolution, in order:
//   DATABASE_URL in the environment
//   the 'echo_platform_db_url' secret in the local DPAPI store
//   the local container
// Pass --local to force the container even when the remote secret exists.
//
// Everything here runs against a plain Postgres as well as Supabase: the
// auth.users shim in test/shim stands in for Supabase Auth where it is
// absent, and is skipped where it is not.

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
// Match the dev project: Supabase runs Postgres 17.
const PG_IMAGE = 'postgres:17-alpine'
const PORT = process.env.ECHO_DB_PORT ?? '55432'
const LOCAL_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/echo`

const FORCE_LOCAL = process.argv.includes('--local')
// `test` used to drop and rebuild the schema every run. That was fine while
// this project was mine alone; now core/ and the worker share it, and dropping
// echo cascade would take their work with it. Default is therefore to clear
// only the suite's OWN fixture — identified by two org ids nobody else uses —
// and leave everything else standing. --fresh restores the old behaviour when
// you actually want to prove the migrations apply from zero.
const FRESH = process.argv.includes('--fresh')

// The DB connection string is a secret (it carries the password), so it lives
// in the same encrypted store as every other credential on this machine and
// never in the repo, the environment file, or a log line.
const NEURAI_PYTHON =
  process.env.NEURAI_PYTHON ??
  'C:\\Users\\amirreza\\Desktop\\neurai-mvp\\server\\.venv\\Scripts\\python.exe'

function secretDbUrl() {
  if (!existsSync(NEURAI_PYTHON)) return null
  try {
    const out = execFileSync(
      NEURAI_PYTHON,
      [
        '-c',
        "import os;os.environ.setdefault('NEURAI_DATA_DIR',os.path.expanduser(r'~\\\\.neurai'));" +
          "from neurai.security import get_secret;print(get_secret('echo_platform_db_url') or '',end='')",
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return out || null
  } catch {
    return null
  }
}

// A Supabase database password is generated with characters that are legal in
// a password but not in a URI — '/', '?', '#'. Pasted into the connection
// string as-is, '/' silently terminates the authority and the driver ends up
// resolving the *username* as a hostname ("ENOTFOUND postgres"), which reads
// like a network problem and is not one. Encode the password ourselves, using
// the last '@' as the delimiter so a password containing '@' also survives.
function normalizeDbUrl(url) {
  const at = url.lastIndexOf('@')
  const schemeEnd = url.indexOf('://')
  if (at < 0 || schemeEnd < 0) return url

  const scheme = url.slice(0, schemeEnd + 3)
  const cred = url.slice(schemeEnd + 3, at)
  const rest = url.slice(at + 1)
  const colon = cred.indexOf(':')
  if (colon < 0) return url

  const user = cred.slice(0, colon)
  const password = cred.slice(colon + 1)
  // Already encoded (or nothing to do) → leave it exactly as given.
  const encoded = encodeURIComponent(decodeURIComponent(password))
  return `${scheme}${encodeURIComponent(user)}:${encoded}@${rest}`
}

function resolveUrl() {
  if (FORCE_LOCAL) return { url: LOCAL_URL, source: 'local container (--local)' }
  if (process.env.DATABASE_URL)
    return { url: process.env.DATABASE_URL, source: 'DATABASE_URL' }
  const stored = secretDbUrl()
  if (stored) return { url: stored, source: "secret store ('echo_platform_db_url')" }
  return { url: LOCAL_URL, source: 'local container (default)' }
}

const { url: RAW_URL, source: URL_SOURCE } = resolveUrl()
const URL_ = normalizeDbUrl(RAW_URL)

// Local means "a database this tool created and may therefore destroy".
const IS_LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(URL_)

const sh = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

async function connect(url = URL_) {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
  const client = new pg.Client({
    connectionString: url,
    // Supabase requires TLS. We do not pin its CA here because this tool
    // targets a dev project; core/ connects with a pinned chain in anything
    // that carries real data.
    ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
  })
  await client.connect()
  return client
}

async function waitForPostgres(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const c = await connect(LOCAL_URL)
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
  const existing = sh('docker', ['ps', '-aq', '-f', `name=^${CONTAINER}$`]).trim()
  if (existing) {
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

// The ledger is hardened at creation, not only by migration 0071: on a FRESH
// Supabase database the default privileges hand anon/authenticated access to
// new public tables the moment this create runs, and the linter's CRITICAL
// (2026-08-20) was exactly that window. ENABLE not FORCE — the runner itself
// is the owner and the ledger's only legitimate client; FORCE with zero
// policies would lock it out of its own table. Revokes are role-conditional
// because anon/authenticated exist on Supabase, not on the local container.
const LEDGER = `
  create table if not exists public.echo_migration (
    version    text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  );
  revoke all on table public.echo_migration from public;
  do $$
  begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke all on table public.echo_migration from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke all on table public.echo_migration from authenticated;
    end if;
  end $$;
  alter table public.echo_migration enable row level security;`

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

// The fixture's synthetic people, identified by their email domain rather than
// by a list of ids.
//
// A list drifts: adding a person to the fixture and forgetting them here
// leaves an auth.users row behind, and the NEXT run fails on a duplicate key
// during setup — a confusing failure a long way from its cause. The domain is
// the fixture's own convention, so it cannot fall out of step with it.
//
// @example.com is this suite's alone: the dev seed uses @echo.local and other
// sessions' fixtures use @example.invalid. Anything matching here is ours.
const FIXTURE_EMAIL_DOMAIN = '%@example.com'

// The two orgs the fixture invents. Nothing else in any database uses them,
// which is what makes a targeted cleanup safe on a shared project.
const FIXTURE_ORGS = [
  '0a000000-0000-4000-8000-00000000000a',
  '0b000000-0000-4000-8000-00000000000b',
]

// Children first: every one of these is reachable from org_id, so the order is
// about foreign keys, not about visibility.
const FIXTURE_TABLES = [
  'agent_message', 'agent_session', 'summary', 'agent_run',
  'connector_secret', 'connector_connection', 'assistant_agent',
  'task_comment', 'task_assignee', 'task_checklist_item', 'task',
  'task_column', 'task_topic', 'meeting',
  'transcript_segment', 'call_speaker', 'call_part', 'person', 'call',
  'proposal_decision', 'api_key', 'admin_action', 'skill',
  'app_user', 'org',
]

async function clearFixture(db) {
  await db.query('drop schema if exists t cascade')
  for (const table of FIXTURE_TABLES) {
    // Tables come and go with migrations, and a rename means this list names
    // something that does not exist yet on a database mid-upgrade. Skipping is
    // right: there is nothing of ours in a table that isn't there.
    const { rows } = await db.query(`select to_regclass($1) is not null as present`, [
      `echo.${table}`,
    ])
    if (!rows[0].present) continue
    const column = table === 'org' ? 'id' : 'org_id'
    await db.query(`delete from echo.${table} where ${column} = any($1::uuid[])`, [FIXTURE_ORGS])
  }
  await db.query('delete from auth.users where email like $1', [FIXTURE_EMAIL_DOMAIN])
}

async function reset() {
  if (!IS_LOCAL && process.env.ECHO_ALLOW_REMOTE_RESET !== '1') {
    throw new Error(
      `refusing to reset a non-local database.\n` +
        `  target: ${URL_SOURCE}\n` +
        `  set ECHO_ALLOW_REMOTE_RESET=1 if you really mean this one.`,
    )
  }

  const db = await connect()
  try {
    await db.query('drop schema if exists echo cascade')
    await db.query('drop schema if exists t cascade')
    await db.query('drop table if exists public.echo_migration')

    if (IS_LOCAL) {
      // Ours: the shim from test/shim, safe to remove wholesale.
      await db.query('drop schema if exists auth cascade')
    } else {
      // Supabase's: dropping it would take authentication with it. Remove
      // only the rows the fixture created, and only if they are still there.
      await db.query('delete from auth.users where email like $1', [FIXTURE_EMAIL_DOMAIN])
    }

    // Roles survive a schema drop, so remove them too — a clean slate is the
    // point of reset. On a managed platform the migration role is not a
    // superuser and DROP OWNED BY needs membership, which it does not have by
    // default; grant it to ourselves first. If the platform still refuses,
    // leaving the role is harmless: dropping the schema already took every
    // privilege it held there, and 0012 is idempotent.
    for (const role of ['echo_app', 'echo_agent', 'echo_purge', 'echo_vendor']) {
      const { rows } = await db.query('select 1 from pg_roles where rolname = $1', [role])
      if (!rows.length) continue
      try {
        await db.query(`grant ${role} to current_user`)
        await db.query(`drop owned by ${role}`)
        await db.query(`drop role ${role}`)
      } catch (err) {
        console.log(`  note: kept role ${role} (${err.message.split('\n')[0]})`)
      }
    }
  } finally {
    await db.end()
  }
  console.log(`reset (${URL_SOURCE})`)
}

// --- the suite -------------------------------------------------------------
//
// Each test file runs in its own transaction and is rolled back, so the
// fixture is identical for every file and the files cannot affect each other.

async function test() {
  console.log(
    `target: ${URL_SOURCE}${IS_LOCAL ? '' : '  [remote]'}` +
      `  ·  ${FRESH ? 'FRESH (drops and rebuilds everything)' : 'fixture-only cleanup'}\n`,
  )

  if (FRESH) await reset()

  // Supabase Auth stands behind app_user in production. Locally there is no
  // auth schema, so install the shim; remotely there already is one, and we
  // leave it strictly alone.
  const pre = await connect()
  try {
    const { rows } = await pre.query(`select to_regclass('auth.users') is not null as present`)
    if (!rows[0].present) {
      await pre.query(readFileSync(join(TESTS, 'shim', 'auth_users.sql'), 'utf8'))
      console.log('installed the local auth.users shim')
    }
  } finally {
    await pre.end()
  }

  await migrate({ quiet: true })

  const db = await connect()
  let failures = 0
  try {
    // The suite works by becoming each role. On a managed platform the
    // migration role is not a superuser, and creating a role does not make you
    // a member of it — so SET ROLE is refused until we grant membership.
    // Test-harness setup only: production never needs this, because core/
    // connects AS these roles rather than switching into them.
    for (const role of ['echo_app', 'echo_agent', 'echo_purge', 'echo_vendor']) {
      try {
        await db.query(`grant ${role} to current_user`)
      } catch (err) {
        console.log(`  note: could not join role ${role} — ${err.message.split('\n')[0]}`)
      }
    }

    // Clear AFTER migrating, not before: the table list evolves with the
    // migrations, so cleaning first means naming tomorrow's schema against
    // today's database. A rename is where that bites.
    await clearFixture(db)

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
    // Leave the project as we found it. The tests themselves roll back, but
    // the fixture and helpers are committed so every file can see them — and
    // on a shared project that residue is somebody else's confusing data.
    await clearFixture(db).catch((err) =>
      console.error(`  warning: could not clear the fixture — ${err.message}`),
    )
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
  console.error(`usage: db.mjs <${Object.keys(commands).join('|')}> [--local]`)
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
