// Operator diagnostic: which Postgres EXTENSIONS this deployment could
// install, and which it already has.
//
// Written because "is pgvector available on Supabase" is a question whose
// plausible answer (yes, it is documented) is not evidence about THIS
// project — and a migration that reaches for an extension the platform does
// not carry fails at apply time, after the file is checksummed.
//
//   DATABASE_URL="<owner>" node scripts/probe-extensions.mjs [name ...]
//
// Reads only catalogue metadata: no org data, no content.
import { ownerClient } from './lib/owner-url.mjs'

const raw = process.env.DATABASE_URL
if (!raw) {
  console.error('DATABASE_URL is required (the owner/Session connection).')
  process.exit(2)
}

const wanted = process.argv.slice(2)
const client = await ownerClient(raw)
try {
  const { rows } = await client.query(
    wanted.length > 0
      ? `select name, default_version, installed_version, comment
           from pg_available_extensions
          where name = any($1::text[])
          order by name`
      : `select name, default_version, installed_version
           from pg_available_extensions
          where installed_version is not null
          order by name`,
    wanted.length > 0 ? [wanted] : [],
  )
  if (rows.length === 0) {
    console.log('(no such extension is available on this deployment)')
  } else {
    for (const r of rows) {
      console.log(
        `${r.name.padEnd(24)} available ${String(r.default_version).padEnd(10)}` +
          ` installed ${r.installed_version ?? '—'}`,
      )
    }
  }
  const v = await client.query(`select current_setting('server_version') as v`)
  console.log('postgres', v.rows[0].v)
} finally {
  await client.end()
}
