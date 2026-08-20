// OWNER-altitude erasure of a TEST identity and everything it owns.
//
//   DATABASE_URL="<owner>" node scripts/erase-user.mjs test@example.com [more...]
//
// Exists because auth-side deletion is deliberately RESTRICT-blocked (0002:
// "the FK protecting a registration from deletion") and ~30 FKs reference
// echo.app_user — a hand-written delete chain would be a belief about the
// catalogue that rots with every migration. This walks the REAL catalogue
// instead: try the delete, read which constraint refused, delete the
// referencing rows, retry — bottom-up until the identity row goes. Each
// email is one transaction: all of it goes, or none of it does.
//
// Composite FKs ((child_id, org_id) → (id, org_id), the D9 backbone) are
// resolved POSITIONALLY and keyed on the id-half — pairing conkey/confkey
// by set-membership would cross-match the halves.
//
// After the app_user row is gone, any org left with ZERO members that the
// person belonged to is deleted too (a founded-then-abandoned test org).
// The auth.users row is NOT touched here — that lives on the auth side and
// is deleted with the service key once this reports clean.
//
// This tool is for TEST residue, by explicit operator instruction, and it
// prints every table it touches with a row count. It refuses to run
// without at least one email argument. It does not know how to be undone.
import { ownerClient } from './lib/owner-url.mjs'

const emails = process.argv.slice(2).map((e) => e.trim()).filter(Boolean)
if (emails.length === 0) {
  console.error('usage: DATABASE_URL="<owner>" node scripts/erase-user.mjs <email> [more emails]')
  process.exit(2)
}
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is required (the owner/Session connection).'); process.exit(2) }

const client = await ownerClient(url)

/**
 * For a refused FK constraint: which table/column points at us, and which of
 * OUR columns it references. Positional pairing; the id-half wins so a
 * composite FK erases by primary key.
 */
async function referencing(constraint) {
  const { rows } = await client.query(`
    select con.conrelid::regclass::text as tbl,
           att.attname                  as col,
           refatt.attname               as refcol
      from pg_constraint con
     cross join generate_subscripts(con.conkey, 1) as s
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = con.conkey[s]
      join pg_attribute refatt
        on refatt.attrelid = con.confrelid and refatt.attnum = con.confkey[s]
     where con.conname = $1 and con.contype = 'f'
     order by (refatt.attname = 'id') desc
     limit 1
  `, [constraint])
  return rows[0]
}

/** delete from `table` where `column` = value, clearing referencing rows first. */
async function eraseRows(table, column, value, depth = 0) {
  if (depth > 12) throw new Error(`FK chain deeper than 12 at ${table}.${column} — refusing`)
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await client.query(`delete from ${table} where ${column} = $1`, [value])
      if (res.rowCount > 0) console.log(`  ${table} (${column}): ${res.rowCount} row(s)`)
      return
    } catch (err) {
      if (err.code !== '23503' || !err.constraint) throw err
      const ref = await referencing(err.constraint)
      if (!ref) throw err
      const { rows } = await client.query(
        `select distinct ${ref.refcol} as v from ${table} where ${column} = $1`, [value])
      for (const row of rows) {
        await eraseRows(ref.tbl, ref.col, row.v, depth + 1)
      }
    }
  }
  throw new Error(`could not clear references for ${table}.${column} in 20 passes`)
}

for (const email of emails) {
  console.log(`\n=== ${email} ===`)
  await client.query('begin')
  try {
    const { rows: users } = await client.query(
      'select id, org_id, role, status from echo.app_user where email = $1::public.citext', [email])
    if (users.length === 0) {
      console.log('  no app_user row (nothing product-side)')
      await client.query('rollback')
      continue
    }
    for (const u of users) {
      console.log(`  app_user ${u.id} (role ${u.role}, status ${u.status}, org ${u.org_id})`)
      await eraseRows('echo.app_user', 'id', u.id)
      const { rows: members } = await client.query(
        'select count(*)::int as n from echo.app_user where org_id = $1', [u.org_id])
      if (members[0].n === 0) {
        console.log(`  org ${u.org_id} is now memberless — erasing it too`)
        await eraseRows('echo.org', 'id', u.org_id)
      }
    }
    await client.query('commit')
    console.log('  COMMITTED')
  } catch (err) {
    await client.query('rollback')
    console.error(`  ROLLED BACK — ${err.code ?? ''} ${err.message}`)
  }
}
await client.end()
