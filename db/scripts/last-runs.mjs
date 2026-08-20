// Operator diagnostic: the last assistant runs' OUTCOME metadata, at owner
// altitude (DATABASE_URL = the owner/Session connection).
//
// Prints id-prefix, status, model, error, timings — and NEVER selects
// `request` or `steps`: those quote conversation content, and this script
// exists precisely so a failure can be diagnosed without reading any of it.
//
//   DATABASE_URL="<owner>" node scripts/last-runs.mjs
//
// The URL is parsed HERE, leniently, instead of being handed to pg's
// connectionString: pg's strict WHATWG parse rejects a password containing a
// raw `#` (everything after it reads as a fragment), and a real Supabase
// password is exactly where such characters live. Split on the LAST `@`, so
// any character in the password is fine, encoded or not.
import pg from 'pg'

const raw = process.env.DATABASE_URL
if (!raw) {
  console.error('DATABASE_URL is required (the owner/Session connection).')
  process.exit(2)
}

function parseDbUrl(url) {
  const noScheme = url.replace(/^postgres(?:ql)?:\/\//, '')
  const at = noScheme.lastIndexOf('@')
  if (at < 0) throw new Error('no user@host in the connection string')
  const creds = noScheme.slice(0, at)
  const hostPart = noScheme.slice(at + 1)
  const colon = creds.indexOf(':')
  const user = colon < 0 ? creds : creds.slice(0, colon)
  const password = colon < 0 ? '' : creds.slice(colon + 1)
  const m = hostPart.match(/^([^:/?]+)(?::(\d+))?\/([^?]+)/)
  if (!m) throw new Error('no host/database in the connection string')
  const decode = (v) => { try { return decodeURIComponent(v) } catch { return v } }
  return {
    user: decode(user),
    password: decode(password),
    host: m[1],
    port: m[2] ? Number(m[2]) : 5432,
    database: decode(m[3]),
  }
}

const cfg = parseDbUrl(raw)
const local = ['localhost', '127.0.0.1', '[::1]'].includes(cfg.host)
const client = new pg.Client({
  ...cfg,
  // Supabase requires TLS; same posture as db.mjs for operator tooling.
  ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
})
await client.connect()
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
