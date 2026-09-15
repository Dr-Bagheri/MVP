// Is a Telegram bot connected, and has its inbox ever been read? (db/0212)
//
// Owner altitude, READ ONLY. The counting corollary is why: under RLS "I
// counted N" and "there are N" are different statements, and "does this
// organisation have a bot at all" is an inventory question, which answers
// only from above the wall.
//
// Nothing here writes. A write test on the organisation's live data is what
// cost the task board on 2026-09-06.
import { execFileSync } from 'node:child_process'
import { ownerClient } from './lib/owner-url.mjs'
import { findNeuraiPython } from './lib/neurai-python.mjs'

/*
 * The same lookup db.mjs does. The QUERY stays duplicated, deliberately: db.mjs
 * is the migration runner for production, and refactoring it to serve a
 * diagnostic is the wrong trade.
 *
 * The one-liner below is COPIED byte for byte from db.mjs and must stay that
 * way. Retyping it cost three failed runs — a JS string literal eats
 * backslashes, so `r'~\\.neurai'` written with one becomes `~.neurai`, and the
 * script then reports "no secret store" about a store that is right there.
 *
 * The interpreter's PATH is the one part that is NOT duplicated and has NO
 * default: where it lives is a property of the machine, and the two obvious
 * defaults — a stranger's home directory, or one rebuilt from `$USERPROFILE` —
 * are both worse than none. lib/neurai-python.mjs (review F4) makes that
 * argument once and owns the two sentences for the two kinds of nothing. This
 * caller has DATABASE_URL as a first sink, so it takes the non-throwing half
 * and passes the `reason` on rather than restating it.
 */
function ownerUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const { path: NEURAI_PYTHON, reason } = findNeuraiPython()
  if (!NEURAI_PYTHON) {
    throw new Error(`no DATABASE_URL, and no python to read the secret store with. ${reason}`)
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

const client = await ownerClient(ownerUrl())
try {
  const conns = await client.query(
    `select provider, status, account_label, updates_cursor, polled_at
       from echo.connector_connection order by provider`)
  console.log('connections:',
    conns.rows.map((r) => `${r.provider}/${r.status}`).join(', ') || '(none)')

  const tg = conns.rows.filter((r) => r.provider === 'telegram')
  if (tg.length === 0) {
    console.log('telegram: NOT CONNECTED — the voice-note lane has nothing to poll')
  } else {
    for (const row of tg) {
      console.log(`telegram: ${row.account_label} · ${row.status}`
        + ` · cursor ${row.updates_cursor ?? '(never looked)'}`
        + ` · last poll ${row.polled_at ? row.polled_at.toISOString() : '(never)'}`)
    }
  }

  const links = await client.query('select count(*)::int as n from echo.telegram_identity')
  const codes = await client.query(
    `select count(*)::int as n from echo.telegram_link_code
      where redeemed_at is null and expires_at > now()`)
  console.log(`linked accounts: ${links.rows[0].n} · live codes: ${codes.rows[0].n}`)
} finally {
  await client.end()
}
