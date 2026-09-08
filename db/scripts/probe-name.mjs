// Operator diagnostic: what, if anything, already carries a NAME in the echo
// schema — a table, a view, a composite type, an enum, a function.
//
// Written because `create table echo.decision` failed with "type decision
// already exists", which is a message about the TYPE namespace and not about
// the table namespace: in Postgres those are the same namespace, and a name
// can be taken by something that is not a table at all. Guessing which is
// exactly the "I cannot see any is not there are none" trap.
//
//   DATABASE_URL="<owner>" node scripts/probe-name.mjs <name> [name ...]
//
// Catalogue only: no org data, no content.
import { ownerClient } from './lib/owner-url.mjs'

const raw = process.env.DATABASE_URL
if (!raw) {
  console.error('DATABASE_URL is required (the owner/Session connection).')
  process.exit(2)
}
const names = process.argv.slice(2)
if (names.length === 0) {
  console.error('usage: probe-name.mjs <name> [name ...]')
  process.exit(2)
}

const client = await ownerClient(raw)
try {
  const types = await client.query(
    `select n.nspname as schema, t.typname as name, t.typtype as typtype,
            c.relkind as relkind
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       left join pg_class c on c.oid = t.typrelid
      where t.typname = any($1::text[])
      order by n.nspname, t.typname`,
    [names],
  )
  console.log('— types / relations —')
  for (const r of types.rows) {
    console.log(
      `${r.schema}.${r.name}  typtype=${r.typtype}  relkind=${r.relkind ?? '—'}`,
    )
  }
  if (types.rows.length === 0) console.log('(none)')

  const funcs = await client.query(
    `select n.nspname as schema, p.proname as name,
            pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname = any($1::text[])
      order by n.nspname, p.proname`,
    [names],
  )
  console.log('— functions —')
  for (const r of funcs.rows) console.log(`${r.schema}.${r.name}(${r.args})`)
  if (funcs.rows.length === 0) console.log('(none)')
} finally {
  await client.end()
}
