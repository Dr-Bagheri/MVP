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
// `verify` is the assertion that must hold on the new credential before it is
// stored, and it is NOT the same question for every role. For the application
// roles it is "sees nothing without an identity". For echo_purge that would be
// vacuously true — its policies are deliberately actor-independent — so the
// discriminating question is instead "sees only what is past its window", and
// answering it needs data to discriminate against.
const GRANTABLE = {
  echo_app: { env: 'ECHO_APP_PASSWORD', secret: 'echo_platform_db_app_url', verify: 'blind' },
  echo_agent: { env: 'ECHO_AGENT_PASSWORD', secret: 'echo_platform_db_agent_url', verify: 'blind' },
  echo_purge: { env: 'ECHO_PURGE_PASSWORD', secret: 'echo_platform_db_purge_url', verify: 'window' },
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

// An application role with no identity attached must see nothing at all.
async function verifyBlind(role, probe) {
  const visible = (await probe.query('select count(*)::int as n from echo.call')).rows[0].n
  if (visible !== 0) {
    throw new Error(
      `${role} sees ${visible} call(s) with no identity attached — the wall is not holding`,
    )
  }
}

// echo_purge is not gated on identity, so "sees nothing" proves nothing —
// on an empty database it is true of a role that could delete everything.
// Give it one live call and one whose window has expired, and require it to
// tell them apart: see only the expired one, fail to delete the live one, and
// delete the expired one. Probe data lives in its own org and is removed in
// the finally, whatever happens.
async function verifyPurgeWindow(admin, probe) {
  const ORG = '0c000000-0000-4000-8000-00000000000c'
  const USER = '0c000000-0000-4000-8000-000000000001'
  const LIVE = '0c000000-0000-4000-8000-0000000000a1'
  const EXPIRED = '0c000000-0000-4000-8000-0000000000a2'
  try {
    await admin.query(
      `insert into auth.users (id, email) values ($1, 'purge-probe@echo.local')
       on conflict (id) do nothing`, [USER])
    await admin.query(
      `insert into echo.org (id, name) values ($1, 'purge probe') on conflict (id) do nothing`, [ORG])
    await admin.query(
      `insert into echo.app_user (id, org_id, email, role, status, accepted_at)
       values ($1,$2,'purge-probe@echo.local','member','active', now())
       on conflict (id) do nothing`, [USER, ORG])
    await admin.query(
      `insert into echo.call (id, org_id, owner_id, title, deleted_at, deleted_by, purge_after)
       values ($1,$3,$4,'live', null, null, null),
              ($2,$3,$4,'expired', now() - interval '40 days', $4, now() - interval '10 days')
       on conflict (id) do nothing`, [LIVE, EXPIRED, ORG, USER])

    const seen = (await probe.query(
      `select id from echo.call where org_id = $1`, [ORG])).rows.map((r) => r.id)
    if (seen.length !== 1 || seen[0] !== EXPIRED) {
      throw new Error(
        `echo_purge sees ${JSON.stringify(seen)}; expected only the expired call — its window predicate is not holding`,
      )
    }

    const spared = await probe.query(`delete from echo.call where id = $1`, [LIVE])
    if (spared.rowCount !== 0) {
      throw new Error('echo_purge deleted a call that is still inside its window')
    }

    const taken = await probe.query(`delete from echo.call where id = $1`, [EXPIRED])
    if (taken.rowCount !== 1) {
      throw new Error('echo_purge could not delete a call whose window has expired')
    }
  } finally {
    await admin.query(`delete from echo.call where org_id = $1`, [ORG]).catch(() => {})
    await admin.query(`delete from echo.app_user where org_id = $1`, [ORG]).catch(() => {})
    await admin.query(`delete from echo.org where id = $1`, [ORG]).catch(() => {})
    await admin.query(`delete from auth.users where id = $1`, [USER]).catch(() => {})
  }
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

    const probe = new pg.Client({ connectionString: url, ...ssl })
    await probe.connect()
    try {
      const who = (await probe.query('select current_user as u')).rows[0].u
      if (who !== role) throw new Error(`connected as ${who}, expected ${role}`)
      if (GRANTABLE[role].verify === 'window') {
        await verifyPurgeWindow(admin, probe)
      } else {
        await verifyBlind(role, probe)
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
