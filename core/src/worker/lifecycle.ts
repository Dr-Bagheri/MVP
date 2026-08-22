/**
 * Part and call lifecycle — the status column IS the position in the DAG (M7).
 *
 * Two rules do the work here:
 *
 * 1. **A part that cannot be recovered becomes a visible gap, not a lost
 *    call.** `echo.call_part.missing` exists for exactly this, and the schema
 *    says why: "a part we can never recover degrades the call to a visible
 *    gap; it does not fail the whole call." Losing 30 minutes of a meeting
 *    because minute 12 failed is the worst outcome available.
 * 2. **A failed call is visibly failed and resumable.** Never silently stuck:
 *    `failure_reason` is written so a human can see what happened, and the
 *    part keeps its row so a retry has something to resume.
 *
 * Every write here runs under the call owner's identity — RLS applies to the
 * worker exactly as it applies to a person.
 */
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export type PartStatus =
  | "pending"
  | "uploaded"
  | "transcoded"
  | "vad_done"
  | "transcribed"
  | "diarized";

export type CallStatus =
  | "recording"
  | "processing"
  | "linking"
  | "summarizing"
  | "ready"
  | "failed";

export interface PartRow {
  id: string;
  call_id: string;
  idx: number;
  offset_ms: number;
  duration_ms: number | null;
  storage_bucket: string;
  storage_path: string | null;
  audio_sha256: string | null;
  status: PartStatus;
  missing: boolean;
  /** The call's language hint ('fa' | 'en' | 'mixed'), set at creation —
   *  joined in so the transcriber can be steered without a second read. */
  call_language: string;
}

export interface Lifecycle {
  getPart(identity: Identity, partId: string): Promise<PartRow | null>;
  partsOfCall(identity: Identity, callId: string): Promise<PartRow[]>;
  setPartStatus(identity: Identity, partId: string, status: PartStatus): Promise<void>;
  setCallStatus(identity: Identity, callId: string, status: CallStatus): Promise<void>;
  markPartMissing(identity: Identity, partId: string, reason: string): Promise<void>;
  /** Why a `ready` call has no summary (db/0023). Cleared by trigger, not by us. */
  noteSummarySkipped(identity: Identity, callId: string, reason: string): Promise<void>;
  /** Recompute `call.duration_ms` from the parts that have landed. */
  recomputeCallDuration(identity: Identity, callId: string): Promise<void>;
  failCall(identity: Identity, callId: string, reason: string): Promise<void>;
  bumpAttempts(identity: Identity, partId: string): Promise<void>;
}

const PART_COLUMNS = `
  p.id, p.call_id, p.idx, p.offset_ms, p.duration_ms,
  p.storage_bucket, p.storage_path, p.audio_sha256, p.status, p.missing,
  c.language as call_language
`;

export function createLifecycle(db: Db): Lifecycle {
  return {
    async getPart(identity, partId) {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<PartRow>(
          `select ${PART_COLUMNS}
             from echo.call_part p join echo.call c on c.id = p.call_id
            where p.id = $1 limit 1`,
          [partId],
        ),
      );
      return rows[0] ?? null;
    },

    async partsOfCall(identity, callId) {
      return db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<PartRow>(
          `select ${PART_COLUMNS}
             from echo.call_part p join echo.call c on c.id = p.call_id
            where p.call_id = $1 order by p.idx`,
          [callId],
        ),
      );
    },

    async setPartStatus(identity, partId, status) {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(`update echo.call_part set status = $2 where id = $1`, [partId, status]),
      );
    },

    async setCallStatus(identity, callId, status) {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(`update echo.call set status = $2 where id = $1`, [callId, status]),
      );
    },

    /**
     * The gap. The part keeps its row, its offset and its place in the
     * timeline — the player shows a hole where it should have been, and the
     * rest of the call is unaffected.
     */
    async markPartMissing(identity, partId, reason) {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.call_part set missing = true, failure_reason = $2 where id = $1`,
          [partId, reason.slice(0, 500)],
        ),
      );
    },

    /**
     * Why a `ready` call has no summary (db/0023).
     *
     * Its own column, not `failure_reason` — that field means the call FAILED,
     * and a `ready` row carrying one is a lie in the opposite direction from
     * silence. db/0024 will add `check (failure_reason is null or status =
     * 'failed')` to make that unrepresentable.
     *
     * **Never cleared here.** The 0008 pointer trigger clears it the moment any
     * summary version lands, because a summary existing at all makes the excuse
     * false — and a constraint (`current_summary_id is null or
     * summary_skipped_reason is null`) rejects the contradiction at write time
     * rather than trusting us not to write it. Same one-way shape as the
     * word-timing demote: the data may retract the claim, only we may assert it.
     */
    async noteSummarySkipped(identity, callId, reason) {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(`update echo.call set summary_skipped_reason = $2 where id = $1`, [
          callId,
          reason.slice(0, 500),
        ]),
      );
    },

    /**
     * The call's length, from its parts.
     *
     * `max(offset_ms + duration_ms)`, NOT `sum(duration_ms)` — and the
     * difference is not pedantry. Parts sit at explicit offsets on one
     * continuous timeline, so a sum under-reports any call with a gap between
     * parts (a recording paused and resumed comes back short by the length of
     * the pause) and over-reports any overlap. The obvious implementation is
     * the wrong one, which is why this is a named method rather than an inline
     * update someone copies.
     *
     * Recomputed from scratch each time rather than accumulated, so it is
     * idempotent: a re-run of a part produces the same answer, and a part
     * written off as a gap simply stops contributing.
     */
    async recomputeCallDuration(identity, callId) {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.call c
              set duration_ms = (
                    select max(p.offset_ms + p.duration_ms)
                      from echo.call_part p
                     where p.call_id = c.id and p.duration_ms is not null
                  )
            where c.id = $1`,
          [callId],
        ),
      );
    },

    async failCall(identity, callId, reason) {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(`update echo.call set status = 'failed', failure_reason = $2 where id = $1`, [
          callId,
          reason.slice(0, 500),
        ]),
      );
    },

    async bumpAttempts(identity, partId) {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(`update echo.call_part set attempts = attempts + 1 where id = $1`, [partId]),
      );
    },
  };
}

/**
 * Can the call move past its per-part phase?
 *
 * Yes when every part has finished the per-part DAG — where "finished"
 * includes parts marked missing. Waiting for a part that will never arrive is
 * how a call gets stuck forever in `processing`, which is worse than a gap
 * because nobody can see it happening.
 */
export function partsSettled(parts: readonly PartRow[]): boolean {
  return parts.length > 0 && parts.every((p) => p.status === "diarized" || p.missing);
}

/** A call whose every part is missing has nothing left to summarize. */
export function allPartsMissing(parts: readonly PartRow[]): boolean {
  return parts.length > 0 && parts.every((p) => p.missing);
}
