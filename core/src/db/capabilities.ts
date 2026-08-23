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

export async function hasAutonomyColumn(db: Db): Promise<boolean> {
  return hasColumn(db, "app_user", "autonomy");
}

export async function hasAutonomyCeiling(db: Db): Promise<boolean> {
  return hasColumn(db, "org", "autonomy_ceiling");
}

const RANK: Record<Autonomy, number> = { watch: 0, assist: 1, act: 2 };

/**
 * The caller's EFFECTIVE dial position, read fresh per ask (a dial change
 * must take effect on the next question, not the next sign-in):
 * min(the person's choice, the org's ceiling — 0075). Columns absent →
 * 'assist', the pre-dial behavior, exactly.
 */
export async function actorAutonomy(
  db: Db,
  identity: { userId: string },
): Promise<Autonomy> {
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
