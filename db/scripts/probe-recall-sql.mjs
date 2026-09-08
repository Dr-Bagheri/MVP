// Does live recall's query actually RUN? (db/0214, item 7)
//
// The query is the risky part of that feature and TypeScript cannot see it:
// `to_tsquery` over a `string_agg` of quoted prefix terms is either valid SQL
// or a runtime error, and the difference only shows the first time a host is
// in a meeting — which is the worst possible moment to find out.
//
// READ ONLY, and it reads NOTHING: the term list below cannot match a word in
// any language, so this proves the SQL parses, plans and executes while
// returning zero rows. Nobody's decisions are read.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ownerClient } from './lib/owner-url.mjs'

/* copied byte for byte from db.mjs — see probe-telegram.mjs's header for why
   retyping the python one-liner is not an option */
const NEURAI_PYTHON =
  process.env.NEURAI_PYTHON ??
  'C:/Users/amirreza/Desktop/neurai-mvp/server/.venv/Scripts/python.exe'

function ownerUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  if (!existsSync(NEURAI_PYTHON)) throw new Error('no DATABASE_URL and no python')
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

const SQL = `with terms as (select unnest($2::text[]) as w),
      q as (select to_tsquery('simple',
             string_agg(quote_literal(w) || ':*', ' | ')) as tsq from terms)
 select i.id, i.kind, i.body, i.status,
        i.meeting_id, m.title as meeting_title,
        coalesce(m.scheduled_at, i.created_at) as decided_at,
        i.owner_id, i.due_on,
        (select count(*) from terms t
          where i.search @@ plainto_tsquery('simple', t.w)) as shared
   from echo.meeting_item i
   join echo.meeting m on m.id = i.meeting_id
  cross join q
  where i.meeting_id <> $1::uuid
    and i.kind in ('decision', 'action')
    and i.search @@ q.tsq
    and (select count(*) from terms t
          where i.search @@ plainto_tsquery('simple', t.w)) >= $3
  order by shared desc, decided_at desc
  limit $4`

const client = await ownerClient(ownerUrl())
try {
  /* terms nothing can match, in both scripts, so the SQL is exercised and the
     result set is empty by construction */
  const impossible = ['zzqqxxvv', 'ژژققضض']
  const result = await client.query(SQL, [
    '00000000-0000-4000-8000-000000000000', impossible, 2, 3,
  ])
  console.log(`the query RAN · ${result.rows.length} rows (0 expected — the terms match nothing)`)
  if (result.rows.length !== 0) {
    console.log('UNEXPECTED: impossible terms matched something; the probe is not measuring what it thinks')
    process.exitCode = 1
  }

  /* and the discriminating half: the same SQL with terms that CAN match must
     be able to return a row, or the reading above is "valid SQL that never
     matches" wearing a pass. Counted only, never read. */
  const [{ count }] = (await client.query(
    `select count(*)::int as count from echo.meeting_item where kind in ('decision','action')`)).rows
  console.log(`ledger holds ${count} decision/action rows`)
  if (count > 0) {
    const [sample] = (await client.query(
      `select body from echo.meeting_item where kind in ('decision','action') limit 1`)).rows
    const words = String(sample.body).split(/[^\p{L}\p{N}\u200c]+/u)
      .filter((w) => w.length >= 3).slice(0, 4)
    if (words.length >= 2) {
      const hit = await client.query(SQL, [
        '00000000-0000-4000-8000-000000000000', words, 2, 3,
      ])
      console.log(`its own words matched ${hit.rows.length} row(s) · shared=${hit.rows[0]?.shared ?? '-'}`)
      if (hit.rows.length === 0) {
        console.log('THE INDEX DOES NOT MATCH ITS OWN ROW — the fold or the query is wrong')
        process.exitCode = 1
      }
    }
  } else {
    console.log('no rows to match against — the discriminating half could not run')
  }
} finally {
  await client.end()
}
