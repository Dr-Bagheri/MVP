#!/usr/bin/env node
// Seed a stable development identity.
//
//   node scripts/seed-dev.mjs
//
// One org and two accepted members, under fixed UUIDs, so that core/ and the
// worker have something to be while developing. Without it the dev project has
// no app_user rows at all — the suite's fixture cleans up after itself — and
// every RLS-protected read from a hand-set actor returns empty, which presents
// as "the schema is broken" rather than "the database is empty".
//
// ===========================================================================
// THIS IS A SCRIPT AND MUST NEVER BECOME A MIGRATION.
//
// A numbered migration ships to every deployment. A fixed-UUID admin seeded
// into a customer's production database is a backdoor with documentation —
// the credentials are in a public repo, and nobody would notice the account
// because it looks like part of the schema. Production has no seeded
// identities: the first account there is created by echo.register_account()
// like anyone else's, and accepted by us (D13).
// ===========================================================================
//
// Idempotent, so running it twice is a no-op rather than an error.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'

const DEV_PROJECT_REF = 'aqgpxnyuxukwgphrxslw' // the dev project, and only it

const ORG = '0d000000-0000-4000-8000-00000000000d'
const ADMIN = '0d000000-0000-4000-8000-000000000001'
const MEMBER = '0d000000-0000-4000-8000-000000000002'
// The state nothing else can reach: with no users at all, every token 401s and
// the pending branch is never exercised end to end. web/ needs a real identity
// that authenticates and is then refused for being unaccepted (M15).
const PENDING = '0d000000-0000-4000-8000-000000000003'
// A suspended ORG with a perfectly ACTIVE member in it. The distinction is the
// point: the person did nothing wrong and is not pending, so "suspended" is a
// different answer from both "pending" and "forbidden", and it is the org's
// state that produces it.
const SUSPENDED_ORG = '0d000000-0000-4000-8000-00000000000e'
const SUSPENDED_MEMBER = '0d000000-0000-4000-8000-000000000004'

const NEURAI_PYTHON =
  process.env.NEURAI_PYTHON ??
  'C:\\Users\\amirreza\\Desktop\\neurai-mvp\\server\\.venv\\Scripts\\python.exe'

function storedUrl() {
  if (!existsSync(NEURAI_PYTHON)) return null
  try {
    return execFileSync(
      NEURAI_PYTHON,
      [
        '-c',
        "import os;os.environ.setdefault('NEURAI_DATA_DIR',os.path.expanduser(r'~\\\\.neurai'));" +
          "from neurai.security import get_secret;print(get_secret('echo_platform_db_url') or '',end='')",
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim() || null
  } catch {
    return null
  }
}

const raw = process.env.DATABASE_URL || storedUrl()
if (!raw) {
  console.error("no connection: set DATABASE_URL or store 'echo_platform_db_url'")
  process.exit(2)
}
const at = raw.lastIndexOf('@')
const schemeEnd = raw.indexOf('://')
const cred = raw.slice(schemeEnd + 3, at)
const colon = cred.indexOf(':')
const url =
  raw.slice(0, schemeEnd + 3) + cred.slice(0, colon) + ':' +
  encodeURIComponent(decodeURIComponent(cred.slice(colon + 1))) + '@' + raw.slice(at + 1)

const host = url.slice(url.lastIndexOf('@') + 1)
const local = /^(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(host)
const isDev = host.includes(DEV_PROJECT_REF) || local

// The guard that matters. --force exists because a second scratch project is a
// legitimate target; it prints what it is about to do to which host first.
if (!isDev && !process.argv.includes('--force')) {
  console.error(
    `refusing to seed a fixed-UUID admin into ${host}\n` +
      `  this script is dev-only: it is recognised targets (${DEV_PROJECT_REF}, localhost) or nothing.\n` +
      '  production has no seeded identities by design — pass --force only for another scratch project.',
  )
  process.exit(2)
}
if (!isDev) console.warn(`--force: seeding development identities into ${host}`)

const db = new pg.Client({
  connectionString: url,
  ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
})
await db.connect()
try {
  await db.query('begin')
  await db.query(
    `insert into auth.users (id, email) values
       ($1,'dev-admin@echo.local'), ($2,'dev-member@echo.local'),
       ($3,'dev-pending@echo.local'), ($4,'dev-suspended@echo.local')
     on conflict (id) do nothing`,
    [ADMIN, MEMBER, PENDING, SUSPENDED_MEMBER],
  )
  await db.query(
    `insert into echo.org (id, name, status) values
       ($1, 'سازمان توسعه', 'active'),
       ($2, 'سازمان تعلیق‌شده', 'suspended')
     on conflict (id) do nothing`,
    [ORG, SUSPENDED_ORG],
  )
  await db.query(
    `insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at)
     values ($1,$4,'dev-admin@echo.local','مدیر توسعه','admin','active', now()),
            ($2,$4,'dev-member@echo.local','عضو توسعه','member','active', now()),
            ($3,$4,'dev-pending@echo.local','در انتظار تأیید','member','pending', null),
            -- active person, suspended org: the whole point of the pair
            ($5,$6,'dev-suspended@echo.local','عضو سازمان تعلیق‌شده','member','active', now())
     on conflict (id) do nothing`,
    [ADMIN, MEMBER, PENDING, ORG, SUSPENDED_MEMBER, SUSPENDED_ORG],
  )
  await db.query('commit')

  const { rows } = await db.query(
    `select u.id, u.role, u.status, o.status as org_status, o.id as org_id
       from echo.app_user u join echo.org o on o.id = u.org_id
      where u.org_id = any($1::uuid[])
      order by o.status, u.status desc, u.role`,
    [[ORG, SUSPENDED_ORG]],
  )
  for (const r of rows) {
    console.log(
      `  ${r.role.padEnd(6)} user=${r.status.padEnd(7)} org=${r.org_status.padEnd(9)} ${r.id}`,
    )
  }
  console.log(`\n  active org    ${ORG}`)
  console.log(`  suspended org ${SUSPENDED_ORG}`)
  console.log(
    '\nset any of these as echo.actor_id. Three refusals, three different reasons:' +
      '\n  pending   — authenticates, then refused for being unaccepted (M15)' +
      '\n  suspended — an active person whose ORG is suspended; not their doing' +
      '\n  member    — active and allowed, but not an admin',
  )
} catch (err) {
  await db.query('rollback').catch(() => {})
  throw err
} finally {
  await db.end()
}
