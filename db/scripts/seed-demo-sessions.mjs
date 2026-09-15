#!/usr/bin/env node
// Seed a lived-in assistant history for the demo account, so the Home page
// opens on a list of past conversations instead of "No conversations yet."
//
//   node scripts/seed-demo-sessions.mjs
//   node scripts/seed-demo-sessions.mjs --for sara@pishrodata.demo
//   node scripts/seed-demo-sessions.mjs --reset            # remove only these
//
// Every conversation is grounded in what the other demo seeds actually put in
// the database — the Simorgh codename, the Aseman contract, the Pasargad
// quote, Ali's acceptance checklist, the weekly 1:1 — so clicking any of them
// during the demo shows an answer that matches the rest of the product.
//
// Idempotent — every row is keyed by a fixed UUID (de000030 for sessions,
// de000031 for messages); running twice is the same end state. Timestamps are
// relative to now, so the sidebar always reads "today / yesterday / earlier".
//
// These are TRANSCRIPTS, not runs: no echo.agent_run row is written, so no
// token spend and no model is implied. `agent_run_id` stays null, which the
// message reader already tolerates (it is nullable and messages predating
// runs carry null).
//
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
const FOR_EMAIL = flag('--for', 'demo@pishrodata.demo').toLowerCase()
const ORG = 'de000000-0000-4000-8000-000000000001' // پیشرو داده

const sessionId = (n) => `de000030-0000-4000-8000-${String(n).padStart(12, '0')}`
const messageId = (n, seq) => `de000031-0000-4000-8000-${String(n).padStart(4, '0')}${String(seq).padStart(8, '0')}`

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// ── the history ────────────────────────────────────────────────────────────
// `ago` is when the LAST message landed; earlier turns are spaced backwards.
// The title is what the sidebar shows: the product derives it from the opening
// question, so it is written here the same way.
const SESSIONS = [
  {
    n: 1,
    ago: 3 * DAY + 2 * HOUR,
    title: 'What should I focus on this week?',
    turns: [
      ['user', 'What should I focus on this week?'],
      [
        'assistant',
        "Two things stand out.\n\n**Pasargad Bank** — you owe Ms. Moradi the price quote (forty users plus the custom-reports module), due Tuesday the ninth. That is the only open item with a date on it.\n\n**Aseman** — the contract is close to signing; what is still blocking it is the custom-reports module they want staged before signature.\n\nNothing on your board is marked high or critical, so the week is yours to shape around those two.",
      ],
      ['user', 'Anything I am forgetting from last week?'],
      [
        'assistant',
        'From the weekly 1:1 with NAI on 1 September: Ali Najafi owns the Simorgh acceptance checklist, and you took the review of Hamid\'s support macros. Neither has a due date, so they will not chase you — worth a nudge if you want them closed before the next 1:1.',
      ],
    ],
  },
  {
    n: 2,
    ago: 2 * DAY + 5 * HOUR,
    title: 'What did we decide about Simorgh?',
    turns: [
      ['user', 'What did we decide about Simorgh?'],
      [
        'assistant',
        'From **“Weekly meeting with NAI”** (1 September):\n\n- “Simorgh” is the internal codename for the Aseman custom-reports rollout — the report builder, the scheduled exports and the delivery work, under one name.\n- It is internal only: it does not go in anything Aseman sees.\n- Aseman wants Simorgh staged before they sign, so the rollout leads the contract rather than following it.\n\nThe acceptance checklist for it sits with Ali Najafi.',
      ],
      ['user', 'Has it come up in any other call?'],
      [
        'assistant',
        'Once, obliquely. In **“Pasargad Bank — pricing call”** (4 September) the custom-reports module is quoted as a flat annual add-on covering the report builder and the scheduled exports — the same scope Simorgh covers, sold to a different customer. The codename itself was not used on that call, which is correct: it is an internal name.',
      ],
    ],
  },
  {
    n: 3,
    ago: 1 * DAY + 3 * HOUR,
    title: 'Who owns the Simorgh acceptance checklist?',
    turns: [
      ['user', 'Who owns the Simorgh acceptance checklist?'],
      [
        'assistant',
        'Ali Najafi. He took it in the 1 September weekly meeting with NAI — the checklist has to be ready before Aseman sees the staged environment. There is no due date on it yet; say the word and I will put one on the board.',
      ],
    ],
  },
  {
    n: 4,
    ago: 22 * HOUR,
    title: 'Draft the price quote email for Pasargad Bank',
    turns: [
      ['user', 'Draft the price quote email for Pasargad Bank'],
      [
        'assistant',
        'Here is a draft. It follows what was agreed on the 4 September call — second tier for forty users, custom-reports as a flat annual add-on, the support SLA wording included, demo environment first.\n\n---\n\n**Subject:** Price quote — reporting platform for Pasargad Bank\n\nDear Ms. Moradi,\n\nThank you for your time last Thursday. As discussed, here is our quote for the reporting platform for forty users, together with the custom-reports module.\n\nForty users falls in our second tier (up to fifty). The custom-reports module is a flat annual add-on and includes both the report builder and the scheduled exports.\n\nOur standard support SLA applies, and we will stand up the demo environment first so your team can work in it before anything is signed.\n\nI am happy to walk through any of this on a call.\n\nWarm regards,\n\n---\n\nThe tier prices are not in any call I can read, so I left them for you to fill in. Want me to attach this to the “Send Pasargad Bank the price quote” task?',
      ],
      ['user', 'Yes, attach it to the task.'],
      [
        'assistant',
        'Done — the draft is on **“Send Pasargad Bank the price quote”**, still due tomorrow at 16:30. It stays open until you send it.',
      ],
    ],
  },
  {
    n: 5,
    ago: 4 * HOUR,
    title: 'Summarise the Pasargad Bank pricing call',
    turns: [
      ['user', 'Summarise the Pasargad Bank pricing call'],
      [
        'assistant',
        '**Pasargad Bank — pricing call**, Thursday 4 September, with Ms. Moradi.\n\n**Decisions**\n- Quote forty users at the second tier (up to fifty), with the custom-reports module as a flat annual add-on.\n- The support SLA wording goes in the quote itself, not a separate annex.\n- Pasargad gets a demo environment before anything is signed.\n\n**Action items**\n- Send the price quote — owner: Sara, by Tuesday the ninth.\n\nThat action is already on the board and still open.',
      ],
    ],
  },
]

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
console.log(`seed-demo-sessions: ${RESET ? 'RESET' : 'SEED'} against ${host.replace(/:\d+\/.*/, '')}`)

try {
  const ids = SESSIONS.map((s) => sessionId(s.n))

  if (RESET) {
    await db.query('begin')
    const m = await db.query('delete from echo.agent_message where session_id = any($1)', [ids])
    await db.query('delete from echo.agent_session_share where session_id = any($1)', [ids]).catch(() => {})
    const s = await db.query('delete from echo.agent_session where id = any($1)', [ids])
    await db.query('commit')
    console.log(`  removed ${s.rowCount} conversation(s) and ${m.rowCount} message(s)`)
    await db.end()
    process.exit(0)
  }

  const actor = await db.query(
    'select id, display_name_en, display_name from echo.app_user where org_id = $1 and lower(email) = $2',
    [ORG, FOR_EMAIL],
  )
  if (actor.rowCount === 0) throw new Error(`${FOR_EMAIL} is not a member of the demo org — add them first`)
  const userId = actor.rows[0].id

  await db.query('begin')
  // agent_session/agent_message policies read echo.actor_id(); at owner
  // altitude nobody is acting, so act as the person whose history this is.
  await db.query(`select set_config('echo.actor_id', $1, true)`, [userId])

  const now = Date.now()
  let messages = 0
  for (const s of SESSIONS) {
    const last = new Date(now - s.ago)
    // space the earlier turns backwards, ~90s apart, so the order is stable
    const at = (i) => new Date(last.getTime() - (s.turns.length - 1 - i) * 90_000).toISOString()
    const opened = at(0)

    await db.query(
      `insert into echo.agent_session (id, org_id, actor_id, title, context, current_agent, floor, last_message_at, created_at, updated_at)
       values ($1, $2, $3, $4, '{}'::jsonb, 'echo', '{}'::text[], $5, $6, $5)
       on conflict (id) do update set
         org_id = excluded.org_id, actor_id = excluded.actor_id, title = excluded.title,
         current_agent = 'echo', last_message_at = excluded.last_message_at,
         created_at = excluded.created_at, updated_at = excluded.updated_at, archived_at = null`,
      [sessionId(s.n), ORG, userId, s.title, last.toISOString(), opened],
    )

    for (const [seq, [role, content]] of s.turns.entries()) {
      await db.query(
        `insert into echo.agent_message (id, session_id, org_id, seq, role, content, tool_calls, agent_run_id, created_at)
         values ($1, $2, $3, $4, $5, $6, '[]'::jsonb, null, $7)
         on conflict (id) do update set
           role = excluded.role, content = excluded.content, seq = excluded.seq,
           created_at = excluded.created_at`,
        [messageId(s.n, seq), sessionId(s.n), ORG, seq, role, content, at(seq)],
      )
      messages += 1
    }
  }
  await db.query('commit')

  const who = actor.rows[0].display_name_en || actor.rows[0].display_name
  console.log(`  ${SESSIONS.length} conversation(s), ${messages} message(s) for ${who} <${FOR_EMAIL}>`)
  for (const s of SESSIONS) {
    const hours = Math.round(s.ago / HOUR)
    console.log(`    · "${s.title}" — ${hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`}`)
  }
  console.log('done')
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error('seed-demo-sessions failed:', e.message)
  process.exitCode = 1
} finally {
  await db.end().catch(() => {})
}
