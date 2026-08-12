#!/usr/bin/env node
// Give application roles a way in — generate, grant, store, forget.
//
//   node scripts/grant-login.mjs echo_app echo_agent
//
// Migrations create the roles NOLOGIN and passwordless, because a password is
// a secret and secrets never appear in a migration (invariant 7). This is the
// out-of-band step, and it is a real deployment checklist item rather than a
// dev chore: without it, core/ cannot connect at all.
//
// The password is generated here with a CSPRNG, handed to Postgres, embedded
// in a connection URL, and written to the local DPAPI secret store. It is
// never printed, never written to a file in the repo, and never passed as a
// command-line argument (argv is readable by other processes). Nothing but the
// role name reaches stdout.
//
// A password supplied in the environment (ECHO_APP_PASSWORD, …) is used
// instead of a generated one, for the case where an operator must match a
// credential that already exists somewhere else.

import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'

// echo_vendor is absent by design, not by oversight: the acceptance procedure
// (D13) runs from the owner connection, and giving it a login would turn a
// deliberate operator path into a reachable service account.
const GRANTABLE = {
  echo_app: { env: 'ECHO_APP_PASSWORD', secret: 'echo_platform_db_app_url' },
  echo_agent: { env: 'ECHO_AGENT_PASSWORD', secret: 'echo_platform_db_agent_url' },
  echo_purge: { env: 'ECHO_PURGE_PASSWORD', secret: 'echo_platform_db_purge_url' },
}
const NEVER = new Set(['echo_vendor'])

const NEURAI_PYTHON =
  process.env.NEURAI_PYTHON ??
  'C:\\Users\\amirreza\\Desktop\\neurai-mvp\\server\\.venv\\Scripts\\python.exe'

const PY_PRELUDE =
  "import os,sys,json;os.environ.setdefault('NEURAI_DATA_DIR',os.path.expanduser(r'~\\\\.neurai'));" +
  'from neurai.security import get_secret, set_secret;'

function readSecret(name) {
  if (!existsSync(NEURAI_PYTHON)) throw new Error(`no NeurAI python at ${NEURAI_PYTHON}`)
  return execFileSync(
    NEURAI_PYTHON,
    ['-c', `${PY_PRELUDE}print(get_secret(${JSON.stringify(name)}) or '',end='')`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
}

// Value arrives on stdin, never on argv — another process can read a command
// line, and this one would carry a live credential.
function writeSecret(name, value) {
  execFileSync(
    NEURAI_PYTHON,
    ['-c', `${PY_PRELUDE}d=json.load(sys.stdin);set_secret(d['n'],d['v'])`],
    { input: JSON.stringify({ n: name, v: value }), encoding: 'utf8', stdio: ['pipe', 'ignore', 'inherit'] },
  )
}

// Same rule as db.mjs, applied to credentials we mint ourselves: a password is
// legal in a password and not always legal in a URI.
function buildUrl(adminUrl, role, password) {
  const at = adminUrl.lastIndexOf('@')
  const tail = adminUrl.slice(at + 1) // host:port/database
  return `postgresql://${encodeURIComponent(role)}:${encodeURIComponent(password)}@${tail}`
}

const roles = process.argv.slice(2)
if (!roles.length) {
  console.error(`usage: grant-login.mjs <${Object.keys(GRANTABLE).join('|')}> ...`)
  process.exit(2)
}
for (const role of roles) {
  if (NEVER.has(role)) {
    console.error(
      `refusing ${role}: its procedure runs from the owner connection by design (D13).\n` +
        'Giving it a login would turn a deliberate operator path into a reachable service account.',
    )
    process.exit(2)
  }
  if (!GRANTABLE[role]) {
    console.error(`unknown role: ${role}`)
    process.exit(2)
  }
}

const adminUrl = process.env.DATABASE_URL || readSecret('echo_platform_db_url')
if (!adminUrl) {
  console.error("no admin connection: set DATABASE_URL or store 'echo_platform_db_url'")
  process.exit(2)
}
const at = adminUrl.lastIndexOf('@')
const schemeEnd = adminUrl.indexOf('://')
const cred = adminUrl.slice(schemeEnd + 3, at)
const colon = cred.indexOf(':')
const normalizedAdmin =
  adminUrl.slice(0, schemeEnd + 3) +
  cred.slice(0, colon) + ':' +
  encodeURIComponent(decodeURIComponent(cred.slice(colon + 1))) +
  '@' + adminUrl.slice(at + 1)

const remote = !/@(localhost|127\.0\.0\.1)/.test(normalizedAdmin)
const ssl = remote ? { ssl: { rejectUnauthorized: false } } : {}

const admin = new pg.Client({ connectionString: normalizedAdmin, ...ssl })
await admin.connect()

try {
  for (const role of roles) {
    const { env, secret } = GRANTABLE[role]
    // base64url: strong, and unambiguous inside a URI even before encoding.
    const password = process.env[env] || randomBytes(32).toString('base64url')

    // ALTER ROLE takes no bind parameters, so build the statement server-side
    // with format(%I/%L) rather than concatenating a secret in JavaScript.
    const { rows } = await admin.query(
      `select format('alter role %I login password %L', $1::text, $2::text) as stmt`,
      [role, password],
    )
    await admin.query(rows[0].stmt)

    const url = buildUrl(normalizedAdmin, role, password)

    // Prove the credential works AND that the wall still stands on it: with no
    // identity attached, an application role must see nothing at all.
    const probe = new pg.Client({ connectionString: url, ...ssl })
    await probe.connect()
    try {
      const who = (await probe.query('select current_user as u')).rows[0].u
      if (who !== role) throw new Error(`connected as ${who}, expected ${role}`)
      const visible = (await probe.query('select count(*)::int as n from echo.call')).rows[0].n
      if (visible !== 0) {
        throw new Error(`${role} sees ${visible} call(s) with no identity attached — the wall is not holding`)
      }
    } finally {
      await probe.end()
    }

    writeSecret(secret, url)
    console.log(`${role}: login granted, connection verified, stored as '${secret}'`)
  }

  const { rows: left } = await admin.query(
    `select rolname from pg_roles
      where rolname like 'echo\\_%' and rolcanlogin order by rolname`,
  )
  console.log(`roles that can log in: ${left.map((r) => r.rolname).join(', ')}`)
} finally {
  await admin.end()
}
