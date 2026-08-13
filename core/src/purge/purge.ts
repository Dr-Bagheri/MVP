/**
 * The 30-day hard purge (M11) — the third process, and the only one that can
 * physically delete anything.
 *
 * ── What makes this different from the worker ───────────────────────────────
 *
 * `echo_purge` carries **no identity**. Every other database path in this
 * product resolves an actor first (invariant 2), because every other path acts
 * on someone's behalf. This one does not: it is maintenance, and its policies
 * (db/0013) are written against the WINDOW rather than against an actor —
 * `deleted_at is not null and purge_after <= now()`. So a purge job with a bad
 * WHERE clause still cannot touch a live call. The wall is the predicate.
 *
 * That is also why this is its own process rather than a mode of the worker.
 * `echo_purge` holds the only DELETE grant in the database; it belongs
 * somewhere that can do nothing else.
 *
 * ── Order, and why it is not merely foreign keys ────────────────────────────
 *
 * Rows: summary → agent_run → transcript_segment → call_speaker → call_part →
 * call (db/0014, and executed against the live schema in db/test/40_purge.sql).
 *
 * Objects BEFORE rows, which is the decision that actually matters. The ROW IS
 * THE RETRY TOKEN: `call_part.storage_path` is the only pointer to the audio.
 * Delete rows first and a crash leaves an object nothing can find and nobody
 * knows to look for — the recording still exists after the user was told it was
 * purged. Delete objects first and a crash leaves a row that still says *purge
 * me*, so the next run finishes the job. Unfinished bookkeeping is
 * recoverable; an unkept privacy promise is not.
 *
 * ── What the policies deliberately do not cover ─────────────────────────────
 *
 * They bound WHICH rows, never HOW MANY. A clock problem or a bad `purge_after`
 * write could legitimately expire everything at once, and the predicate would
 * be satisfied the whole way down. The blast-radius ceiling below is a
 * different property, not a second copy of the rule — a duplicated predicate
 * is what drifts.
 */
import type { SqlTx } from "../db/identity.ts";

export interface PurgeStorage {
  /**
   * Remove one stored object. MUST tolerate an object that is already gone —
   * a retry after partial success is normal operation here, not an error, and
   * parts marked `missing` never had an object at all.
   *
   * Returns whether this call is what removed it: `true` for a real deletion,
   * `false` for "it was not there". Both are success, and they are counted
   * separately on purpose — a run reporting a hundred deletions and a run
   * reporting a hundred already-absent objects describe very different days,
   * and collapsing them into one number is how the second one gets read as
   * the first.
   */
  remove(bucket: string, path: string): Promise<boolean>;
}

export interface PurgeLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface PurgeOptions {
  /** Refuse a run larger than this and say so. See the header. */
  maxCallsPerRun: number;
  /** Calls per transaction. Small batches keep a failure's blast radius small. */
  batchSize: number;
}

export interface PurgeResult {
  callsPurged: number;
  objectsDeleted: number;
  objectsMissing: number;
  refused: string | null;
}

interface ExpiredCall {
  id: string;
}

interface PartObject {
  storage_bucket: string;
  storage_path: string | null;
}

/** Rows the window has expired. RLS already guarantees it; the ORDER is ours. */
const SELECT_EXPIRED = `select id from echo.call order by purge_after limit $1`;

const SELECT_OBJECTS = `
  select storage_bucket, storage_path
    from echo.call_part
   where call_id = $1 and storage_path is not null
`;

/**
 * Delete one call completely. Objects first, then rows in dependency order.
 *
 * `deleteRows` runs inside ONE transaction so a call is never half-deleted in
 * the database; the object deletes cannot join that transaction, which is
 * exactly why they go first.
 */
export async function purgeCall(
  tx: SqlTx,
  storage: PurgeStorage,
  callId: string,
  log: PurgeLogger,
): Promise<{ objectsDeleted: number; objectsMissing: number }> {
  const parts = await tx.unsafe<PartObject>(SELECT_OBJECTS, [callId]);

  let objectsDeleted = 0;
  let objectsMissing = 0;

  for (const part of parts) {
    if (!part.storage_path) continue;
    try {
      // Already gone is success — the storage adapter decides which failures
      // mean that, because only it knows how its provider spells "absent".
      // (Supabase spells it as a 400 whose body says 404, which is why this
      // decision does NOT live here as a status comparison.)
      if (await storage.remove(part.storage_bucket, part.storage_path)) {
        objectsDeleted++;
      } else {
        objectsMissing++;
      }
    } catch (error) {
      // A real failure STOPS this call. Deleting the rows now would strand the
      // object with nothing pointing at it — the failure this ordering exists
      // to prevent. The row stays, still saying "purge me", for the next run.
      log.error(
        { call_id: callId, bucket: part.storage_bucket, err: (error as Error).message },
        "storage delete failed; leaving the row so the next run retries",
      );
      throw error;
    }
  }

  // Rows, in dependency order. Deleting summaries fires
  // `call.current_summary_id`'s ON DELETE SET NULL, which updates `echo.call` —
  // a table this role holds no privilege on. That works because referential
  // actions run as the table owner rather than as the caller; do not "fix" it
  // by requesting an UPDATE grant.
  await tx.unsafe(`delete from echo.summary            where call_id = $1`, [callId]);
  await tx.unsafe(`delete from echo.agent_run          where call_id = $1`, [callId]);
  await tx.unsafe(`delete from echo.transcript_segment where call_id = $1`, [callId]);
  await tx.unsafe(`delete from echo.call_speaker       where call_id = $1`, [callId]);
  await tx.unsafe(`delete from echo.call_part          where call_id = $1`, [callId]);
  await tx.unsafe(`delete from echo.call               where id      = $1`, [callId]);

  return { objectsDeleted, objectsMissing };
}

/**
 * One pass. Returns what it did, including a refusal — a purge that declines to
 * run must say so loudly, because the alternative reading of a quiet zero is
 * "nothing was expired", and those need opposite responses.
 */
export async function runPurge(
  begin: <T>(fn: (tx: SqlTx) => Promise<T>) => Promise<T>,
  storage: PurgeStorage,
  options: PurgeOptions,
  log: PurgeLogger,
): Promise<PurgeResult> {
  const expired = await begin((tx) =>
    tx.unsafe<ExpiredCall>(SELECT_EXPIRED, [options.maxCallsPerRun + 1]),
  );

  if (expired.length > options.maxCallsPerRun) {
    // Refuse rather than proceed. Everything expiring at once is far more
    // likely to be a clock or a `purge_after` bug than a real backlog, and a
    // purge is the one operation with no undo.
    const refused =
      `refusing to purge: ${expired.length}+ calls are expired, above the ceiling of ` +
      `${options.maxCallsPerRun}. This is more likely a clock or purge_after fault ` +
      `than a real backlog; raise PURGE_MAX_CALLS deliberately to proceed.`;
    log.error({ expired: expired.length, ceiling: options.maxCallsPerRun }, refused);
    return { callsPurged: 0, objectsDeleted: 0, objectsMissing: 0, refused };
  }

  let callsPurged = 0;
  let objectsDeleted = 0;
  let objectsMissing = 0;

  for (const call of expired) {
    try {
      // One transaction per call: a failure costs this call, not the batch.
      const counts = await begin((tx) => purgeCall(tx, storage, call.id, log));
      callsPurged++;
      objectsDeleted += counts.objectsDeleted;
      objectsMissing += counts.objectsMissing;
      log.info({ call_id: call.id, ...counts }, "call purged");
    } catch (error) {
      // Loud, and the loop continues: one unreachable object must not hold
      // every other expired call hostage.
      log.error({ call_id: call.id, err: (error as Error).message }, "call not purged; will retry next run");
    }
  }

  return { callsPurged, objectsDeleted, objectsMissing, refused: null };
}
