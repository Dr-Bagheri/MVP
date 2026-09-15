#!/usr/bin/env node
// Add ONE signed-in-able member to the "پیشرو داده" demo organisation, so the
// live demo can be driven from an account whose password is known.
//
//   node scripts/add-demo-user.mjs
//   node scripts/add-demo-user.mjs --email you@pishrodata.demo --name "Your Name"
//   node scripts/add-demo-user.mjs --role member --locale fa
//
// --role owner is refused by the schema: `app_user_one_owner_per_org` means
// the demo org's owner is Sara and stays Sara. admin is the working default.
//   node scripts/add-demo-user.mjs --reset            # remove the user again
//
// The password comes from DEMO_USER_PASSWORD in the environment, never from
// argv (argv is readable by other processes) and never from a file in the
// repo. It is set through GoTrue's admin API so it is hashed the same way a
// real sign-up would be; this script never prints it.
//
// Idempotent: re-running updates the profile and re-sets the password. What it
// guarantees for the given email:
//   • an auth.users row with a confirmed email and that password
//   • an ACTIVE echo.app_user in the demo org (default role admin) with
//     timezone Asia/Tehran, English assistant replies and the English UI
//   • an echo.person directory row linked to the account
//   • attendance on the upcoming demo meeting seeded by seed-demo.mjs
//
// THIS IS A SCRIPT AND MUST NEVER BECOME A MIGRATION (see seed-dev.mjs).
// Reads DATABASE_URL (the owner connection), SUPABASE_URL and
// SUPABASE_SERVICE_KEY from the environment, or from ../.env.dev when that
// file exists. Never prints a secret.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt
}
const RESET = args.includes('--reset')
const EMAIL = flag('--email', 'demo@pishrodata.demo').toLowerCase()
const NAME = flag('--name', 'Demo User')
const ROLE = flag('--role', 'admin')
const LOCALE = flag('--locale', 'en')
const ORG = 'de000000-0000-4000-8000-000000000001' // پیشرو داده
const MEETING = 'de000007-0000-4000-8000-0000000000c1' // seed-demo.mjs's upcoming meeting

if (!['owner', 'admin', 'member'].includes(ROLE)) {
  console.error('--role must be owner, admin or member')
  process.exit(2)
}

function loadEnv() {
  const file = resolve(here, '..', '..', '.env.dev')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (v !== '' && process.env[k] === undefined) process.env[k] = v
  }
}
loadEnv()

const raw = process.env.DATABASE_URL
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const PASSWORD = process.env.DEMO_USER_PASSWORD
if (!raw) {
  console.error('no connection: set DATABASE_URL (owner) or provide ../.env.dev')
  process.exit(2)
}
if (!RESET && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('need SUPABASE_URL and SUPABASE_SERVICE_KEY to set a password')
  process.exit(2)
}
if (!RESET && (!PASSWORD || PASSWORD.length < 8)) {
  console.error('set DEMO_USER_PASSWORD in the environment (at least 8 characters) — not on the command line')
  process.exit(2)
}

const admin = async (path, init) => {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    const why = body?.msg ?? body?.error_description ?? body?.error ?? text.slice(0, 200)
    throw new Error(`admin ${path} → ${res.status} ${why}`)
  }
  return body
}

const host = raw.slice(raw.lastIndexOf('@') + 1)
const local = /^(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(host)
const db = new pg.Client({
  connectionString: raw,
  ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
})
await db.connect()
console.log(`add-demo-user: ${RESET ? 'RESET' : 'ADD'} ${EMAIL} against ${host.replace(/:\d+\/.*/, '')}`)

// the admin list endpoint filters by email with ?filter= on older GoTrue and
// ?email= on newer; ask the database instead — it is the same row, over the
// one connection this script already holds.
const findAuthUser = async (email) => {
  const r = await db.query('select id from auth.users where lower(email) = $1', [email])
  return r.rows[0]?.id ?? null
}

try {
  const org = await db.query('select id, name from echo.org where id = $1', [ORG])
  if (org.rowCount === 0) throw new Error(`demo org ${ORG} is missing — seed it first`)

  const existing = await findAuthUser(EMAIL)

  // ── reset ────────────────────────────────────────────────────────────────
  if (RESET) {
    if (!existing) {
      console.log('  nothing to remove')
    } else {
      await db.query('begin')
      await db.query('delete from echo.meeting_attendee where user_id = $1', [existing])
      await db.query('delete from echo.person where org_id = $1 and app_user_id = $2', [ORG, existing])
      await db.query('delete from echo.app_user where id = $1', [existing])
      await db.query('commit')
      if (SUPABASE_URL && SERVICE_KEY) await admin(`/users/${existing}`, { method: 'DELETE' })
      console.log('  removed the account, the membership and the directory row')
    }
    await db.end()
    process.exit(0)
  }

  // ── the identity (GoTrue hashes the password the way a sign-up would) ─────
  let userId = existing
  if (userId) {
    await admin(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    })
    console.log('  account already existed — password re-set, email confirmed')
  } else {
    const created = await admin('/users', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    })
    userId = created.id
    console.log('  account created, email confirmed')
  }

  // ── the membership ───────────────────────────────────────────────────────
  await db.query('begin')
  await db.query(
    `insert into echo.app_user
       (id, org_id, email, display_name, display_name_en, username, role, status,
        accepted_at, locale, timezone, assistant_reply_language, job_title, kind)
     values ($1, $2, $3, $4, $4, $5, $6, 'active', now(), $7, 'Asia/Tehran', 'en', 'Product Manager', 'human')
     on conflict (id) do update set
       org_id = excluded.org_id, display_name = excluded.display_name,
       display_name_en = excluded.display_name_en, role = excluded.role,
       status = 'active', accepted_at = coalesce(echo.app_user.accepted_at, now()),
       locale = excluded.locale, timezone = excluded.timezone,
       assistant_reply_language = excluded.assistant_reply_language,
       deleted_at = null, tombstoned_at = null, updated_at = now()`,
    [userId, ORG, EMAIL, NAME, EMAIL.split('@')[0], ROLE, LOCALE],
  )

  // ── the directory row (so the person can be a speaker) ───────────────────
  const person = await db.query('select id from echo.person where org_id = $1 and app_user_id = $2', [ORG, userId])
  if (person.rowCount === 0) {
    await db.query(
      `insert into echo.person (org_id, display_name, app_user_id, created_by, title, team)
       values ($1, $2, $3, $3, 'manager', 'Product')`,
      [ORG, NAME, userId],
    )
  } else {
    await db.query('update echo.person set display_name = $2, updated_at = now() where id = $1', [
      person.rows[0].id,
      NAME,
    ])
  }

  // ── attendance on the upcoming demo meeting, when it is seeded ───────────
  const meeting = await db.query('select id from echo.meeting where id = $1', [MEETING])
  if (meeting.rowCount > 0) {
    await db.query(
      `insert into echo.meeting_attendee (meeting_id, user_id, org_id, added_by)
       values ($1, $2, $3, $2) on conflict do nothing`,
      [MEETING, userId, ORG],
    )
  }
  await db.query('commit')

  const urgent = await db.query(
    `select count(*)::int as n from echo.task t
      join echo.task_assignee a on a.task_id = t.id and a.user_id = $2
      where t.org_id = $1 and t.archived_at is null and t.done_at is null
        and t.priority in ('high','critical')`,
    [ORG, userId],
  )
  if (urgent.rows[0].n > 0) {
    console.warn(`  ⚠ ${urgent.rows[0].n} open high/critical task(s) assigned — the "no major tasks" line will be false`)
  }

  console.log(`  ${NAME} <${EMAIL}> — ${ROLE} in "${org.rows[0].name}", UI ${LOCALE}, replies in English, zone Asia/Tehran`)
  console.log(`  attendee of the upcoming demo meeting: ${meeting.rowCount > 0 ? 'yes' : 'meeting not seeded yet'}`)
  console.log('done')
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error('add-demo-user failed:', e.message)
  process.exitCode = 1
} finally {
  await db.end().catch(() => {})
}
