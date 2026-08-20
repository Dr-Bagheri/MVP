// Operator diagnostic: the last assistant runs' OUTCOME metadata, at owner
// altitude (DATABASE_URL = the owner/Session connection).
//
// Prints id-prefix, status, model, error, timings — and NEVER selects
// `request` or `steps`: those quote conversation content, and this script
// exists precisely so a failure can be diagnosed without reading any of it.
//
//   DATABASE_URL="<owner>" node scripts/last-runs.mjs
//
// URL parsing lives in lib/owner-url.mjs (lenient split-on-last-@ — pg's
// strict parse rejects a password containing a raw `#`), shared with
// erase-user.mjs so the two operator tools cannot drift.
import { ownerClient } from './lib/owner-url.mjs'

const raw = process.env.DATABASE_URL
if (!raw) {
  console.error('DATABASE_URL is required (the owner/Session connection).')
  process.exit(2)
}

const client = await ownerClient(raw)
try {
  const { rows } = await client.query(`
    select left(id::text, 8)            as run,
           status::text                 as status,
           model,
           error,
           to_char(started_at,  'YYYY-MM-DD HH24:MI:SS') as started,
           to_char(finished_at, 'YYYY-MM-DD HH24:MI:SS') as finished
      from echo.agent_run
     order by started_at desc
     limit 8
  `)
  if (rows.length === 0) console.log('no runs recorded')
  else console.table(rows)
} finally {
  await client.end()
}
