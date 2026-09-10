#!/usr/bin/env node
/*
 * READ-ONLY, OWNER ALTITUDE: how many voices do the org's MEETING records
 * carry, set beside how many people were actually in the room?
 *
 * User report, 2026-09-10: "voice diarization did not work properly in
 * meetings — it usually does not go past 2 speakers, but usually there are
 * more speakers than 2." That is a claim about rows, and under RLS a member's
 * read answers only for the member (rule 11's counting corollary) — the test
 * account saw ONE meeting while the team holds them daily. So this reads at
 * the owner's altitude, the way probe-telegram.mjs does, and prints numbers
 * and ids only: never a title's words beyond a short prefix, never a line of
 * transcript.
 *
 * Usage: node db/scripts/probe-diarization.mjs [--days 14]
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ownerClient } from './lib/owner-url.mjs'

/*
 * The same lookup db.mjs does — COPIED byte for byte from probe-telegram.mjs,
 * which copied it from db.mjs, for the reason recorded there: a JS string
 * literal eats backslashes, and a retyped `r'~\\.neurai'` reports "no secret
 * store" about a store that is right there.
 */
const NEURAI_PYTHON =
  process.env.NEURAI_PYTHON ??
  'C:\\Users\\amirreza\\Desktop\\neurai-mvp\\server\\.venv\\Scripts\\python.exe'

function ownerUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  if (!existsSync(NEURAI_PYTHON)) {
    throw new Error('no DATABASE_URL, and no python to read the secret store with')
  }
  const out = execFileSync(
    NEURAI_PYTHON,
    [
      '-c',
      "import os;os.environ.setdefault('NEURAI_DATA_DIR',os.path.expanduser(r'~\\\\.neurai'));" +
        "from neurai.security import get_secret;print(get_secret('echo_platform_db_url') or '',end='')",
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
  if (!out) throw new Error('the store has no echo_platform_db_url')
  return out
}

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 14

const client = await ownerClient(ownerUrl())
try {
  const orgs = await client.query(
    `select o.id, left(o.name, 24) as name, o.status,
            (select count(*)::int from echo.app_user u where u.org_id = o.id and u.status = 'active') as active_members,
            (select count(*)::int from echo.meeting m where m.org_id = o.id) as meetings,
            (select count(*)::int from echo.call c where c.org_id = o.id and c.deleted_at is null) as calls
       from echo.org o order by o.created_at`)

  const meetings = await client.query(
    `select m.id, m.org_id, left(m.title, 20) as title, m.mode, m.created_at, m.call_id, m.archived_at is not null as archived,
            (select count(*)::int from echo.meeting_attendee a where a.meeting_id = m.id) as roster,
            (select count(*)::int from echo.meeting_attendee a where a.meeting_id = m.id and a.attended_at is not null) as attended,
            coalesce(array_length(m.invitees, 1), 0) as guests,
            c.status as call_status, c.duration_ms,
            (select count(*)::int from echo.call_part p where p.call_id = c.id) as parts,
            (select count(*)::int from echo.call_speaker s where s.call_id = c.id) as voices,
            (select count(distinct ts.call_speaker_id)::int from echo.transcript_segment ts where ts.call_id = c.id and ts.call_speaker_id is not null) as voices_in_text,
            (select count(*)::int from echo.transcript_segment ts where ts.call_id = c.id) as lines,
            (select ts.provenance->'diarization'->>'source' from echo.transcript_segment ts where ts.call_id = c.id order by ts.seq limit 1) as diar_source,
            (select ts.provenance->'stt'->>'lane' from echo.transcript_segment ts where ts.call_id = c.id order by ts.seq limit 1) as lane
       from echo.meeting m
       left join echo.call c on c.id = m.call_id
      where m.created_at > now() - ($1 || ' days')::interval
      order by m.created_at desc`, [String(days)])

  /* the people on each meeting, as ACCOUNT ids only, and who is the host —
     enough to judge how many distinct people could have spoken */
  const owners = await client.query(
    `select u.id, u.org_id, u.role from echo.app_user u where u.role = 'owner' and u.status = 'active'`)

  const out = {
    orgs: orgs.rows.map((o) => ({ ...o, id: String(o.id).slice(0, 8) })),
    owners: owners.rows.map((u) => ({ id: u.id, org: String(u.org_id).slice(0, 8) })),
    meetings: meetings.rows.map((m) => ({
      ...m,
      id: String(m.id).slice(0, 8),
      org: String(m.org_id).slice(0, 8),
      org_id: undefined,
      call_id: m.call_id ? String(m.call_id) : null,
    })),
  }
  console.log(JSON.stringify(out, null, 1))
} finally {
  await client.end()
}
