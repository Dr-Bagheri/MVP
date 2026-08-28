/**
 * Boot-time schema capability detection (AI-native plan, Phase A+).
 *
 * Deployments and migrations arrive in either order here: code deploys over
 * SSH in minutes, migrations run from the operator's machine with the owner
 * connection. A query that names a column the catalogue doesn't have yet
 * would 500 every request it touches — so features that depend on NEW schema
 * ask the catalogue first, ONCE, and degrade to their safe default with a
 * loud log line until the migration lands (M21: the forfeit is said out
 * loud; rule 12: the degraded state names itself).
 *
 * The check reads information_schema, which is permission-filtered (the
 * rule-11 catalog lesson) — safe HERE because echo_app holds SELECT on
 * echo.app_user, and a table you have any privilege on shows you its
 * columns. A capability check for a table echo_app cannot touch would need
 * pg_catalog instead; don't copy this pattern blindly.
 */
import type { Db, SqlTx } from "./identity.ts";

const cache = new Map<string, boolean>();

async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const rows = await db.withoutIdentity((tx: SqlTx) => tx.unsafe(
      `select 1 from information_schema.columns
        where table_schema = 'echo' and table_name = $1 and column_name = $2`,
      [table, column],
    ));
    const present = rows.length > 0;
    cache.set(key, present);
    return present;
  } catch {
    // an unreadable catalogue is treated as "absent" — the safe default —
    // and NOT cached, so a transient failure doesn't disable the feature
    // for the process's lifetime
    return false;
  }
}

/** tests + post-migration refresh (a restart also clears it) */
export function resetCapabilityCache(): void {
  cache.clear();
}

async function hasTable(db: Db, table: string): Promise<boolean> {
  const key = `table:${table}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const rows = await db.withoutIdentity((tx: SqlTx) => tx.unsafe(
      `select 1 from information_schema.tables
        where table_schema = 'echo' and table_name = $1`,
      [table],
    ));
    const present = rows.length > 0;
    cache.set(key, present);
    return present;
  } catch {
    return false;
  }
}

/** M35 (db/0074): the signals feature's tables — cards + rules together. */
export async function hasSignalTables(db: Db): Promise<boolean> {
  return (await hasTable(db, "agent_card")) && (await hasTable(db, "agent_rule"));
}

export type Autonomy = "watch" | "assist" | "act";

/**
 * db/0080's trio (job_title, about, assistant_context) lands in ONE
 * migration, so one representative column answers for all three — probing
 * each would be three catalogue reads for one fact.
 */
export async function hasProfileContext(db: Db): Promise<boolean> {
  return hasColumn(db, "app_user", "about");
}

/** db/0081 (voice enrollment): the person voiceprint columns. */
export async function hasVoiceprints(db: Db): Promise<boolean> {
  return hasColumn(db, "person", "voiceprint");
}

/** db/0085: the deletion ledger (reasoned product deletions). */
export async function hasDeletionLedger(db: Db): Promise<boolean> {
  return hasTable(db, "deletion_record");
}

/** db/0086: tags on records. */
export async function hasCallTags(db: Db): Promise<boolean> {
  return hasColumn(db, "call", "tags");
}

async function hasFunction(db: Db, qualified: string): Promise<boolean> {
  const key = `fn:${qualified}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    // to_regproc reads pg_catalog, which is not permission-filtered the way
    // information_schema is — existence is the fact; the grant is the
    // migration's own concern
    const rows = await db.withoutIdentity((tx: SqlTx) => tx.unsafe<{ present: boolean }>(
      `select to_regproc($1) is not null as present`,
      [qualified],
    ));
    const present = rows[0]?.present === true;
    cache.set(key, present);
    return present;
  } catch {
    return false;
  }
}

/** db/0091: console sight moved behind definer doors (the policy leak fix). */
export async function hasConsoleSightDoors(db: Db): Promise<boolean> {
  return hasFunction(db, "echo.platform_list_users");
}


/** db/0087: the summary grounding report. */
export async function hasSummaryGrounding(db: Db): Promise<boolean> {
  return hasColumn(db, "summary", "grounding");
}

/** db/0088: the org glossary (STT recognition context). */
export async function hasOrgGlossary(db: Db): Promise<boolean> {
  return hasColumn(db, "org", "glossary");
}

/** db/0102: the organisation's public face — the columns land together. */
export async function hasOrgProfile(db: Db): Promise<boolean> {
  return hasColumn(db, "org", "logo_url");
}

/** db/0112: the assistant's per-person voice (reply prefs + standing
    instructions + the brief switch). */
export async function hasAssistantPrefs(db: Db): Promise<boolean> {
  return hasColumn(db, "app_user", "assistant_instructions");
}

/** db/0112: the org's invitation domain wall. */
export async function hasSignupPolicy(db: Db): Promise<boolean> {
  return hasColumn(db, "org", "allowed_email_domains");
}

/** db/0114-0115: mail drafts and the per-person auto-draft switch. */
export async function hasMailDrafts(db: Db): Promise<boolean> {
  return hasColumn(db, "app_user", "auto_draft_replies");
}

/** db/0117: the calendar poller and its idempotency record. */
export async function hasMeetingPrep(db: Db): Promise<boolean> {
  return hasColumn(db, "app_user", "auto_meeting_prep");
}

/** db/0103: the logo as BYTES (the upload path). */
export async function hasOrgLogoBytes(db: Db): Promise<boolean> {
  return hasColumn(db, "org", "logo_bytes");
}

/** db/0096: person.team + person.voiceprint_samples (they land together). */
export async function hasPersonTeams(db: Db): Promise<boolean> {
  return hasColumn(db, "person", "team");
}

/** db/0094: the version-shaping template's label stored on the summary. */
export async function hasSummaryTemplate(db: Db): Promise<boolean> {
  return hasColumn(db, "summary", "template");
}

/** db/0094: the new-meeting form's template choice riding the call. */
export async function hasCallSummaryPrefs(db: Db): Promise<boolean> {
  return hasColumn(db, "call", "summary_template");
}

/** db/0099: the new-meeting form's MODEL choice riding the call. */
export async function hasCallSummaryModel(db: Db): Promise<boolean> {
  return hasColumn(db, "call", "summary_model");
}

/** db/0089: the provisional (live-caption) transcript on the call. */
export async function hasProvisionalTranscript(db: Db): Promise<boolean> {
  return hasColumn(db, "call", "provisional_transcript");
}

export async function hasAutonomyColumn(db: Db): Promise<boolean> {
  return hasColumn(db, "app_user", "autonomy");
}

export async function hasAutonomyCeiling(db: Db): Promise<boolean> {
  return hasColumn(db, "org", "autonomy_ceiling");
}

const RANK: Record<Autonomy, number> = { watch: 0, assist: 1, act: 2 };

/**
 * [REVISED 2026-08-28, user directive] "remove watch and act from everywhere
 * in the platform. the only thing that must be in the platform is assist" —
 * the M36 dial left the product. This constant is the ONE pin: every reader
 * (the ask path, the worker's auto-apply hold, /v1/me's served field) resolves
 * autonomy through `actorAutonomy` or serves this value directly — a second
 * clamp at a reader would be two spellings of one rule. The columns
 * (`app_user.autonomy`, `org.autonomy_ceiling`) and the wire fields
 * deliberately STAY — removing schema for a UI ruling is churn — so a stored
 * "act" or "watch" simply stops mattering. If the ruling reverses: delete the
 * early return in `actorAutonomy` below (the original resolution is intact
 * under it) and serve the row's value again in members.ts.
 */
export const PINNED_AUTONOMY: Autonomy = "assist";

/**
 * The caller's EFFECTIVE dial position — PINNED to "assist" (see
 * PINNED_AUTONOMY above). The pre-directive resolution (read fresh per ask:
 * min(the person's choice, the org's ceiling — 0075); columns absent →
 * 'assist') is kept intact below the pin so un-pinning is a one-line delete.
 */
export async function actorAutonomy(
  db: Db,
  identity: { userId: string },
): Promise<Autonomy> {
  return PINNED_AUTONOMY;
  if (!(await hasAutonomyColumn(db))) return "assist";
  try {
    const withCeiling = await hasAutonomyCeiling(db);
    const rows = await db.withIdentity(
      identity as never,
      (tx: SqlTx) => tx.unsafe<{ autonomy: string; ceiling?: string }>(
        withCeiling
          ? `select u.autonomy, o.autonomy_ceiling as ceiling
               from echo.app_user u left join echo.org o on o.id = u.org_id
              where u.id = echo.actor_id()`
          : "select autonomy from echo.app_user where id = echo.actor_id()",
      ),
    );
    const chosen = normalize(rows[0]?.autonomy);
    const ceiling = normalize(rows[0]?.ceiling ?? "act");
    return RANK[chosen] <= RANK[ceiling] ? chosen : ceiling;
  } catch {
    return "assist";
  }
}

function normalize(value: unknown): Autonomy {
  return value === "watch" || value === "act" ? value : "assist";
}
