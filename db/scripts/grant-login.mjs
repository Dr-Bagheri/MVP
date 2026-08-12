#!/usr/bin/env node
// Give the application roles a way in.
//
// Migrations create echo_app / echo_agent / echo_purge NOLOGIN and without
// passwords, because a password is a secret and secrets never appear in the
// repo (invariant 7). This script is the out-of-band step that grants LOGIN
// and sets each password from the environment — run once per deployment, by
// whoever holds the secrets.
//
//   ECHO_APP_PASSWORD=…  ECHO_AGENT_PASSWORD=…  ECHO_PURGE_PASSWORD=…  \
//   DATABASE_URL=postgres://…  node scripts/grant-login.mjs
//
// Nothing here is logged but the role name.

import pg from 'pg'

const ROLES = [
  ['echo_app', process.env.ECHO_APP_PASSWORD],
  ['echo_agent', process.env.ECHO_AGENT_PASSWORD],
  ['echo_purge', process.env.ECHO_PURGE_PASSWORD],
]

const missing = ROLES.filter(([, pw]) => !pw).map(([r]) => r)
if (missing.length) {
  console.error(
    `missing password(s) in the environment for: ${missing.join(', ')}\n` +
      'set ECHO_APP_PASSWORD / ECHO_AGENT_PASSWORD / ECHO_PURGE_PASSWORD',
  )
  process.exit(2)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

const db = new pg.Client({ connectionString: url })
await db.connect()
try {
  for (const [role, password] of ROLES) {
    // ALTER ROLE takes no bind parameters, so the statement has to be built
    // as text. Build it server-side with format(%I/%L) — Postgres does the
    // quoting — rather than concatenating a secret into SQL in JavaScript.
    const { rows } = await db.query(
      `select format('alter role %I login password %L', $1::text, $2::text) as stmt`,
      [role, password],
    )
    await db.query(rows[0].stmt)
    console.log(`granted login: ${role}`)
  }
} finally {
  await db.end()
}
