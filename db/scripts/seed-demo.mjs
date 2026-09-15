#!/usr/bin/env node
// Seed the LIVE-DEMO path on top of the "پیشرو داده" demo organisation.
//
//   node scripts/seed-demo.mjs --in 20          # the upcoming meeting starts in 20 minutes
//   node scripts/seed-demo.mjs --reset          # rewind after a rehearsal (keeps the org)
//   node scripts/seed-demo.mjs --host sara@pishrodata.demo --in 15
//
// What it guarantees (idempotent — every row is keyed by a fixed UUID):
//   • a meeting folder "1 on 1"
//   • ONE upcoming, unrecorded, in-person meeting "First weekly meeting with NAI"
//     hosted by --host, in the "1 on 1" folder, scheduled --in minutes from now,
//     with a description that says it recurs weekly (the schema has no
//     recurrence field; the title/description is what the agent reads)
//   • the host answers in English (assistant_reply_language = 'en') and has an
//     explicit timezone (Asia/Tehran unless already set to a real zone)
//   • no OPEN high/critical task on the host's board (the demo line is
//     "no major tasks") — the seeded board already satisfies this; the script
//     only reports if that stops being true
//
// --reset undoes one rehearsal: unlinks the meeting's recording, removes the
// items and the tasks that came out of that recording, soft-deletes the call,
// removes any installed "tasks_digest" workflow (and its schedule/runs/cards),
// and re-schedules the meeting. It never touches the org, the people, or the
// pre-existing seeded records.
//
//
// SUPERSEDED FOR NEW ORGANISATIONS, KEPT FOR THIS ONE (M52, 2026-09-09).
// The platform console's Demo tab now seeds a whole demo organisation on any
// date, in English or Persian, through the product's own repositories — see
// core/src/api/demo-seed/ and ARCHITECTURE.md M52. This script still targets
// the hand-seeded org de000000-0000-4000-8000-000000000001 and still works;
// it is the LOCAL path (owner altitude, fixed UUIDs) and the console is the
// product one. If you are seeding a demo for somebody to present, use the
// console: it mints real sign-in accounts, which this script cannot.
// THIS IS A SCRIPT AND MUST NEVER BECOME A MIGRATION (see seed-dev.mjs).
// Reads DATABASE_URL (the owner connection) from the environment, or from
// ../.env.dev when that file exists. Never prints a secret.

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
const IN_MINUTES = Number(flag('--in', '20'))
const HOST_EMAIL = flag('--host', 'sara@pishrodata.demo')
const ORG = 'de000000-0000-4000-8000-000000000001' // پیشرو داده

if (!Number.isFinite(IN_MINUTES) || IN_MINUTES < 1 || IN_MINUTES > 1440) {
  console.error('--in must be minutes between 1 and 1440')
  process.exit(2)
}

// fixed ids — the whole point: running twice is a no-op
const TOPIC_1ON1 = 'de000010-0000-4000-8000-0000000000a1'
const MEETING = 'de000007-0000-4000-8000-0000000000c1'
const MEETING_TITLE = 'Weekly meeting with NAI'
const MEETING_DESCRIPTION =
  'Weekly 1:1 with NAI — every Monday morning. Recurring weekly 1:1 (previous one on 1 September).'
const STARTER_KEY = 'tasks_digest'

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
if (!raw) {
  console.error('no connection: set DATABASE_URL (owner) or provide ../.env.dev')
  process.exit(2)
}
const host = raw.slice(raw.lastIndexOf('@') + 1)
const local = /^(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(host)
const db = new pg.Client({
  connectionString: raw,
  ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
})
await db.connect()
console.log(`seed-demo: ${RESET ? 'RESET' : 'SEED'} against ${host.replace(/:\d+\/.*/, '')}`)

try {
  await db.query('begin')

  const org = await db.query('select id, name from echo.org where id = $1', [ORG])
  if (org.rowCount === 0) throw new Error(`demo org ${ORG} is missing — seed it first`)

  const hostRow = await db.query(
    'select id, display_name, display_name_en, timezone, assistant_reply_language from echo.app_user where org_id = $1 and email = $2',
    [ORG, HOST_EMAIL],
  )
  if (hostRow.rowCount === 0) throw new Error(`host ${HOST_EMAIL} is not a member of the demo org`)
  const hostUser = hostRow.rows[0]

  // ── reset ────────────────────────────────────────────────────────────────
  if (RESET) {
    const m = await db.query('select call_id from echo.meeting where id = $1', [MEETING])
    const callId = m.rows[0]?.call_id ?? null
    if (callId) {
      const t = await db.query('select id from echo.task where org_id = $1 and call_id = $2', [ORG, callId])
      const ids = t.rows.map((r) => r.id)
      if (ids.length) {
        await db.query('delete from echo.task_assignee where task_id = any($1)', [ids])
        await db.query('delete from echo.task_checklist_item where task_id = any($1)', [ids]).catch(() => {})
        await db.query('delete from echo.task_comment where task_id = any($1)', [ids]).catch(() => {})
        await db.query('delete from echo.task where id = any($1)', [ids])
      }
      console.log(`  removed ${ids.length} task(s) born from the rehearsal recording`)
      await db.query('update echo.meeting set call_id = null where id = $1', [MEETING])
      await db.query(
        `update echo.call set deleted_at = now(), deleted_by = $2 where id = $1 and deleted_at is null`,
        [callId, hostUser.id],
      )
      console.log('  unlinked and soft-deleted the rehearsal recording')
    }
    const items = await db.query('delete from echo.meeting_item where meeting_id = $1', [MEETING])
    console.log(`  removed ${items.rowCount} meeting item(s)`)

    const wf = await db.query(
      `select id from echo.workflow where org_id = $1 and (starter_key = $2 or handle like $3)`,
      [ORG, STARTER_KEY, `${STARTER_KEY}%`],
    ).catch(async () => db.query(`select id from echo.workflow where org_id = $1 and handle like $2`, [ORG, `${STARTER_KEY}%`]))
    for (const row of wf.rows) {
      const id = row.id
      await db.query('delete from echo.workflow_schedule where workflow_id = $1', [id]).catch(() => {})
      const runs = await db.query('select id from echo.workflow_run where workflow_id = $1', [id]).catch(() => ({ rows: [] }))
      const runIds = runs.rows.map((r) => r.id)
      if (runIds.length) {
        await db.query('delete from echo.workflow_step_output where run_id = any($1)', [runIds]).catch(() => {})
        await db.query('delete from echo.workflow_step_run where run_id = any($1)', [runIds]).catch(() => {})
        await db.query('delete from echo.agent_card where run_id = any($1)', [runIds]).catch(() => {})
        await db.query('delete from echo.workflow_run where id = any($1)', [runIds]).catch(() => {})
      }
      await db.query('delete from echo.workflow_mute where workflow_id = $1', [id]).catch(() => {})
      await db.query('delete from echo.workflow_auto_apply where workflow_id = $1', [id]).catch(() => {})
      await db.query('delete from echo.workflow_version where workflow_id = $1', [id]).catch(() => {})
      await db.query('delete from echo.workflow where id = $1', [id])
    }
    console.log(`  removed ${wf.rows.length} installed "${STARTER_KEY}" workflow(s)`)
  }

  // ── the folder ───────────────────────────────────────────────────────────
  await db.query(
    `insert into echo.meeting_topic (id, org_id, name, created_by)
     values ($1, $2, '1 on 1', $3)
     on conflict (id) do update set archived_at = null, name = excluded.name`,
    [TOPIC_1ON1, ORG, hostUser.id],
  )

  // ── the upcoming meeting ─────────────────────────────────────────────────
  const when = new Date(Date.now() + IN_MINUTES * 60_000)
  when.setSeconds(0, 0)
  await db.query(
    `insert into echo.meeting
       (id, org_id, title, scheduled_at, duration_minutes, mode, topic_id, location, description, created_by)
     values ($1, $2, $3, $4, 30, 'in_person', $5, 'Meeting room A', $6, $7)
     on conflict (id) do update set
       title = excluded.title, scheduled_at = excluded.scheduled_at, duration_minutes = 30,
       mode = 'in_person', topic_id = excluded.topic_id, description = excluded.description,
       archived_at = null, updated_at = now()`,
    [MEETING, ORG, MEETING_TITLE, when.toISOString(), TOPIC_1ON1, MEETING_DESCRIPTION, hostUser.id],
  )
  await db.query(
    `insert into echo.meeting_attendee (meeting_id, user_id, org_id, added_by)
     values ($1, $2, $3, $2) on conflict do nothing`,
    [MEETING, hostUser.id, ORG],
  )

  // ── the host's preferences ───────────────────────────────────────────────
  const tz = hostUser.timezone && hostUser.timezone !== 'auto' ? hostUser.timezone : 'Asia/Tehran'
  await db.query(
    `update echo.app_user set timezone = $2, assistant_reply_language = 'en' where id = $1`,
    [hostUser.id, tz],
  )

  // ── the demo board's PRIORITIES ──────────────────────────────────────────
  // (2026-09-08: the tasks seeded for the demo all arrived at one priority).
  // The home page now shows the priority as a rank code — P1 red
  // through P4 plain — and a board seeded entirely «medium» renders four
  // identical grey badges, which reads as a broken feature rather than as
  // work that happens to be evenly urgent. So the eight open demo cards carry
  // a real spread, pinned by their fixed ids like every other row here.
  //
  // The HOST's two stay out of high/critical on purpose: the demo line is
  // "no major tasks", and the check below is what enforces it.
  const DEMO_PRIORITY = [
    ['de000006-0000-4000-8000-000000000001', 'critical'], // Draft Q3 renewal terms — due the 10th
    ['de000006-0000-4000-8000-000000000002', 'high'],     // Migrate Aseman staging data — due the 11th
    ['de000006-0000-4000-8000-000000000003', 'medium'],   // Pasargad security questionnaire (host)
    ['de000006-0000-4000-8000-000000000005', 'medium'],   // Rewrite the Aseman onboarding checklist
    ['de000006-0000-4000-8000-000000000006', 'low'],      // Book the Q4 planning room
    ['de000006-0000-4000-8000-000000000007', 'low'],      // Review the new support macros
    ['de000006-0000-4000-8000-000000000008', 'high'],     // Prepare the Pasargad demo environment
    ['de000006-0000-4000-8000-000000000009', 'medium'],   // Phase-one acceptance criteria
  ]
  let repriced = 0
  for (const [id, priority] of DEMO_PRIORITY) {
    const r = await db.query(
      `update echo.task set priority = $3 where id = $1 and org_id = $2 and priority <> $3`,
      [id, ORG, priority],
    )
    repriced += r.rowCount
  }
  if (repriced > 0) console.log(`  set the priority on ${repriced} demo card(s)`)

  // ── the HOST's board must read "no major tasks" ──────────────────────────
  // (colleagues may carry urgent work; the demo line is about the person asking)
  const urgent = await db.query(
    `select count(*)::int as n from echo.task t
      join echo.task_assignee a on a.task_id = t.id and a.user_id = $2
      where t.org_id = $1 and t.archived_at is null and t.done_at is null
        and t.priority in ('high','critical')`,
    [ORG, hostUser.id],
  )
  if (urgent.rows[0].n > 0) {
    console.warn(`  ⚠ ${urgent.rows[0].n} open high/critical task(s) assigned to the host — the "no major tasks" line will be false`)
  }

  await db.query('commit')
  const name = hostUser.display_name_en || hostUser.display_name
  console.log(`  host: ${name} <${HOST_EMAIL}> — replies in English, zone ${tz}`)
  console.log(`  meeting "${MEETING_TITLE}" in folder "1 on 1" at ${when.toISOString()} (in ${IN_MINUTES} min)`)
  console.log('done')
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error('seed-demo failed:', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
