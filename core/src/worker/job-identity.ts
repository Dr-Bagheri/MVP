/**
 * Resolving the identity a job runs as, with a dead-letter reason an operator
 * can act on.
 *
 * The three ways this fails need three different human responses, and left
 * undistinguished they all dead-letter as "the owner cannot see the call" —
 * which tells an operator nothing about whether waiting will fix it.
 * "Requeue once the org is reinstated" is a path someone actually walks
 * (steward ruling), so it has to be legible from the dead letter alone.
 *
 * The classification itself now lives in `db/actor.ts`, where it belongs: the
 * api needs the same distinction the moment it answers "why is this call
 * stuck", and a rule living in two packages is a rule that will eventually
 * disagree with itself. This file only maps those errors onto the worker's
 * `error_type` vocabulary and its retry policy — which IS worker-shaped,
 * because the dead letter is the consumer.
 */
import { InactiveOwnerError, identityForJob, OwnerMismatchError, UnknownActorError } from "../db/actor.ts";
import type { Db } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import type { JobPayload } from "./queue.ts";
import { StepError } from "./runner.ts";

export async function resolveJobIdentity(db: Db, payload: JobPayload): Promise<Identity> {
  try {
    return await identityForJob(db, payload);
  } catch (error) {
    // Pending / suspended / disabled. The reason arrives ON the error, so
    // there is no second lookup — and it names WHICH, because accepting a
    // signup, re-enabling a person and unsuspending an org are three different
    // actions by three different people.
    //
    // Retryable: this heals the moment someone performs that action, with no
    // manual replay of anything already queued.
    if (error instanceof InactiveOwnerError) {
      throw new StepError(
        "owner_inactive",
        `the call owner is ${error.reason} — requeue once reinstated`,
        true,
      );
    }

    // An ACTIVE owner who still cannot see their own call: a stale or forged
    // payload, or the call is gone. Waiting fixes nothing, but the attempt
    // count is the evidence, so it stays retryable and dead-letters by name.
    if (error instanceof OwnerMismatchError) {
      throw new StepError(
        "owner_cannot_see_call",
        "the job's owner cannot see the call it was queued for — stale or forged payload",
        true,
      );
    }

    // No `app_user` row at all. Nothing changes that on its own, so fail now
    // rather than spending five attempts to reach the same answer.
    if (error instanceof UnknownActorError) {
      throw new StepError("owner_not_found", "the job's owner does not exist", false);
    }

    throw error;
  }
}
