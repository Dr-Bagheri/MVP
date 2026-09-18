/**
 * READ-ONLY: what every org and member currently names as a model.
 *
 * Written for the 2026-09-18 narrowing to three offered models. The product
 * refuses an id it does not offer, and it refuses it in two different ways
 * depending on who named it (typed = by name, stored = an absent rung), so
 * before the narrowing ships somebody has to look at what is actually stored
 * — an org whose `allowed_models` names nothing on the offer list has curated
 * itself to an empty set, and its members get "no model selected" until an
 * admin touches the screen.
 *
 * Owner altitude on purpose (rule 11's counting corollary): "I counted N" and
 * "there are N" are different statements under RLS, and an inventory question
 * answers only from above the wall.
 *
 * Writes nothing. Run: node db/scripts/probe-model-curation.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** The three the product offers — kept here as DATA, compared, never applied. */
const OFFERED = [
  "deepseek/deepseek-v4-flash-0731",
  "z-ai/glm-5.2",
  "google/gemini-3.6-flash",
];

/**
 * `.env` is read whole rather than through `--env-file`: the owner password
 * contains a '#', which node's env-file parser treats as a comment and
 * truncates in silence (recorded 2026-09-15).
 */
function envValue(name) {
  const text = readFileSync(path.join(ROOT, ".env"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && line.slice(0, at).trim() === name) return line.slice(at + 1).trim();
  }
  return null;
}

/** Percent-encode the password, as db/scripts/db.mjs does, for the same reason. */
function normalize(url) {
  const at = url.lastIndexOf("@");
  const schemeEnd = url.indexOf("://");
  if (at < 0 || schemeEnd < 0) return url;
  const cred = url.slice(schemeEnd + 3, at);
  const colon = cred.indexOf(":");
  if (colon < 0) return url;
  return `${url.slice(0, schemeEnd + 3)}${encodeURIComponent(cred.slice(0, colon))}`
    + `:${encodeURIComponent(decodeURIComponent(cred.slice(colon + 1)))}@${url.slice(at + 1)}`;
}

const url = envValue("DATABASE_URL");
if (!url) { console.error("no DATABASE_URL in .env"); process.exit(1); }

const client = new pg.Client({ connectionString: normalize(url), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const who = await client.query("select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass");
  console.log(`connected as ${who.rows[0].current_user} (rolbypassrls=${who.rows[0].bypass})`);
  console.log(`the product offers: ${OFFERED.join(", ")}\n`);

  const orgs = await client.query(
    `select id, name, kind, allowed_models from echo.org order by created_at`,
  );
  console.log("── orgs ──────────────────────────────────────────────");
  for (const o of orgs.rows) {
    const allowed = o.allowed_models ?? [];
    const survives = allowed.filter((m) => OFFERED.includes(m));
    const verdict = allowed.length === 0
      ? "uncurated — gets all three"
      : survives.length === 0
        ? "*** STRANDED: nothing it allows is offered ***"
        : `keeps ${survives.length} of ${allowed.length}`;
    console.log(`  ${o.name} [${o.kind}] ${verdict}`);
    if (allowed.length > 0) console.log(`    allowed: ${allowed.join(", ")}`);
  }

  const prefs = await client.query(
    `select u.preferred_model, count(*)::int as people
       from echo.app_user u
      where u.preferred_model is not null
      group by 1 order by 2 desc`,
  );
  console.log("\n── stored member preferences ─────────────────────────");
  if (prefs.rows.length === 0) console.log("  (none)");
  for (const p of prefs.rows) {
    console.log(`  ${p.preferred_model} — ${p.people} ${OFFERED.includes(p.preferred_model) ? "(offered)" : "*** NOT OFFERED: becomes an absent rung ***"}`);
  }

  const pins = await client.query(
    `select s.slug, s.level, s.model, count(*)::int as rows
       from echo.skill s where s.model is not null group by 1,2,3 order by 1`,
  );
  console.log("\n── skill model pins ──────────────────────────────────");
  if (pins.rows.length === 0) console.log("  (none)");
  for (const s of pins.rows) {
    console.log(`  ${s.slug} [${s.level}] -> ${s.model} ${OFFERED.includes(s.model) ? "(offered)" : "*** NOT OFFERED ***"}`);
  }

  const runs = await client.query(
    `select model, count(*)::int as runs, max(started_at) as last
       from echo.agent_run where started_at > now() - interval '30 days'
      group by 1 order by 2 desc limit 10`,
  );
  console.log("\n── what actually ran in the last 30 days ─────────────");
  for (const r of runs.rows) {
    console.log(`  ${r.model ?? "(null)"} — ${r.runs} runs, last ${r.last?.toISOString?.() ?? r.last}`);
  }
} finally {
  await client.end();
}
