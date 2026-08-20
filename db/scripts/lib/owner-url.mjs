// Lenient DATABASE_URL parsing for OWNER-altitude operator scripts.
//
// pg's strict WHATWG parse rejects a password containing a raw `#`
// (everything after it reads as a URL fragment) — and a real Supabase
// password is exactly where such characters live. Split on the LAST `@`
// instead, so any character in the password is fine, encoded or not.
import pg from 'pg'

export function parseDbUrl(url) {
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

export async function ownerClient(rawUrl) {
  const cfg = parseDbUrl(rawUrl)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(cfg.host)
  const client = new pg.Client({
    ...cfg,
    // Supabase requires TLS; same posture as db.mjs for operator tooling.
    ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
  })
  await client.connect()
  return client
}
