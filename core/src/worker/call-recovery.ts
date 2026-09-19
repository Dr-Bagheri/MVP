/**
 * THE STALL RECOVERY: a call that stopped moving is driven again.
 *
 * The report (user, 2026-09-19): a meeting sat at «در حال پردازش» and never
 * left. Measured on production before this was written — the call had ZERO
 * parts, zero transcript segments, and no message naming it in any queue,
 * live or archived. Nothing had failed; nothing was going to happen either.
 * A call waiting for work that does not exist is the worst member of the
 * kinds-of-nothing family, because the screen renders it identically to a
 * call the platform is busy with.
 *
 * Two halves, and they are different answers to different facts:
 *
 *   · a call that CAN be resumed is resumed, from the artifacts
 *   · a call that CANNOT be is FAILED, visibly, with its reason — which is
 *     also what makes the existing retry door reachable (uploads.retry)
 *
 * Every write runs as the CALL'S OWNER (M3, invariant 2). The discovery read
 * is the one privileged step and it is a narrow door returning ids and counts
 * (db/0235 `stalled_calls`), exactly as the mail poller's `due_mail_polls`
 * does: reading an envelope is not reading a call.
 */
import { resolveIdentity } from "../db/actor.ts";
import { hasCallRecovery } from "../db/capabilities.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Lifecycle } from "./lifecycle.ts";
import { Q_LINK_SPEAKERS, Q_PROCESS_PART, type Queue } from "./queue.ts";
import type { StepLogger } from "./runner.ts";

/**
 * How long a call must have been still before it counts as stalled, and the
 * recovery's own cooldown. Fifteen minutes is NOT an estimate of how long a
 * step takes — a part may legitimately run for an hour on the long-file lane.
 * It covers the millisecond window between a status write and its enqueue,
 * which steps.ts keeps deliberately apart (see its note on the settle race).
 *
 * What actually decides "nothing is working on this" is the QUEUE: db/0235
 * excludes any call named by a live message, and pgmq keeps a claimed
 * message's row while it is invisible. One number in two places would be a
 * lie waiting to happen, so the door clamps its own floor to the same five
 * minutes and this constant is passed to both the read and the claim.
 */
export const STALL_MINUTES = 15;

/**
 * Why a call with no audio failed, in the `errorType: sentence` shape every
 * other `failure_reason` in the pipeline uses (dead-letter.ts writes the
 * same). ONE spelling, because two writers reach this state — the finish
 * door refuses an empty take up front, and this sweep catches the ones that
 * were already through before the door existed.
 */
export const NOTHING_RECORDED =
  "nothing_recorded: no audio reached the pipeline before the take was finished";

/** Where a stalled or failed call re-enters the pipeline — read from the
 *  ARTIFACTS, never from a flag (the retry door's rule since 2026-08-22). */
export type ResumeAt = "nothing" | "parts" | "summary" | "ready";

export interface CallArtifacts {
  /** parts that carry audio and have not been written off as gaps */
  usableParts: number;
  /** of those, the ones that never produced a transcript */
  bareParts: number;
  /** a summary version already exists for this call */
  hasSummary: boolean;
}

/**
 * The decision, as a pure function, because this is the logic that says
 * whether a customer's recording is re-run, completed or written off — and
 * it should be readable in one place rather than inferred from two call
 * sites. Both doors (the manual retry and the automatic sweep) ask it, so
 * they cannot come to disagree about what "resumable" means.
 *
 * ORDER IS LOAD-BEARING. "nothing" is asked first: a call with no usable
 * parts also has no bare parts, so without that rule it falls through to
 * "summary" and the pipeline summarizes an empty transcript — inventing a
 * record of a meeting nobody recorded, which is the one failure the
 * anti-fabrication rules exist to prevent.
 */
export function planResume(a: CallArtifacts): ResumeAt {
  if (a.usableParts === 0) return "nothing";
  if (a.bareParts > 0) return "parts";
  // Every surviving part has its transcript. If the summary also landed, the
  // call simply never got its last status write — the artifacts say `ready`,
  // and re-summarizing would spend a provider call to append a second version
  // of a summary that already exists.
  if (a.hasSummary) return "ready";
  return "summary";
}

export interface StalledCall {
  call_id: string;
  owner_id: string;
  org_id: string;
  status: string;
  usable_parts: number;
  bare_parts: number;
  has_summary: boolean;
}

export interface RecoveryOptions {
  db: Db;
  queue: Queue;
  lifecycle: Lifecycle;
  /** the floor and the cooldown; the door clamps it to five minutes */
  minutes?: number;
  limit?: number;
}

/**
 * One pass. Loud by construction: every call it touches produces a line
 * naming the call, what it found and what it did — that is the condition
 * B3's 2026-08-13 no-sweeper ruling set for a sweeper that earns its place
 * ("a named operation, explicit actor, never a silent background writer").
 */
export async function sweepStalledCalls(
  { db, queue, lifecycle, minutes = STALL_MINUTES, limit = 20 }: RecoveryOptions,
  log: StepLogger,
): Promise<void> {
  if (!(await hasCallRecovery(db))) return;

  let stalled: StalledCall[];
  try {
    stalled = await db.withoutIdentity((tx: SqlTx) =>
      tx.unsafe<StalledCall>(
        `select call_id, owner_id, org_id, status, usable_parts, bare_parts, has_summary
           from echo.stalled_calls($1::integer, $2::integer)`,
        [minutes, limit],
      ),
    );
  } catch (error) {
    log.warn(
      { event: "stall_sweep_failed", error_type: (error as Error).name },
      "the stalled-call sweep did not run this round",
    );
    return;
  }
  if (stalled.length === 0) return;

  for (const row of stalled) {
    // The claim IS the compare-and-set (db/0235). Two workers reading the
    // same list in the same second both see this call; exactly one wins.
    let claimed = false;
    try {
      const rows = await db.withoutIdentity((tx: SqlTx) =>
        tx.unsafe<{ ok: boolean | null }>(
          `select echo.claim_call_recovery($1::uuid, $2::integer) as ok`,
          [row.call_id, minutes],
        ),
      );
      claimed = rows[0]?.ok === true;
    } catch (error) {
      log.warn(
        { call_id: row.call_id, event: "stall_claim_failed", error_type: (error as Error).name },
        "could not claim the stalled call; leaving it for the next pass",
      );
      continue;
    }
    if (!claimed) continue;

    let identity;
    try {
      identity = await resolveIdentity(db, row.owner_id);
    } catch {
      // Invariant 2 keeps no convenience exception: no owner, no product
      // write. The door already excludes inactive owners, so reaching here
      // means the row changed underneath us — the line is the whole trace.
      log.error(
        { call_id: row.call_id, owner_id: row.owner_id, event: "stall_owner_unresolved" },
        "a stalled call's owner could not be resolved; nothing written",
      );
      continue;
    }

    const at = planResume({
      usableParts: row.usable_parts,
      bareParts: row.bare_parts,
      hasSummary: row.has_summary,
    });

    try {
      if (at === "nothing") {
        // No audio ever reached the pipeline — there is nothing to run, and
        // saying "still processing" about it forever is the lie this whole
        // file exists to end. Failed is both honest and RESUMABLE: the
        // record's own retry door opens on exactly this state.
        await lifecycle.failCall(identity, row.call_id, NOTHING_RECORDED);
      } else if (at === "parts") {
        // Re-enqueue the parts that never produced a transcript. The step
        // re-checks its artifact on arrival, so a part that quietly finished
        // between the read and here costs a no-op rather than a duplicate.
        const bare = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ id: string }>(
            `select p.id from echo.call_part p
              where p.call_id = $1
                and p.missing = false
                and p.storage_path is not null
                and not exists (
                  select 1 from echo.transcript_segment s where s.part_id = p.id)`,
            [row.call_id],
          ),
        );
        for (const part of bare) {
          await queue.send(Q_PROCESS_PART, {
            callId: row.call_id, ownerId: row.owner_id, partId: part.id,
          });
        }
      } else if (at === "summary") {
        await queue.send(Q_LINK_SPEAKERS, { callId: row.call_id, ownerId: row.owner_id });
      } else {
        // Every artifact is present; only the status write was lost.
        await lifecycle.setCallStatus(identity, row.call_id, "ready");
      }
    } catch (error) {
      log.error(
        { call_id: row.call_id, resumed_at: at, event: "stall_recovery_failed",
          error_type: (error as Error).name },
        "the stalled call could not be driven again this round",
      );
      continue;
    }

    log.warn(
      {
        call_id: row.call_id,
        org_id: row.org_id,
        was: row.status,
        resumed_at: at,
        usable_parts: row.usable_parts,
        bare_parts: row.bare_parts,
        event: "stalled_call_recovered",
      },
      at === "nothing"
        ? "a stalled call had no audio at all; failed with its reason"
        : "a stalled call was driven again",
    );
  }
}
