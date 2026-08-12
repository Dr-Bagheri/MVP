/**
 * Producing an `Identity` — the two sources, both ending at the same shape.
 *
 * M3: "connection factory requiring identity (token OR row-derived)". The api
 * derives it from a verified Supabase JWT; the worker derives it from the job
 * payload, because a pipeline job runs as the call's OWNER, never as a
 * service account (M4).
 *
 * Membership facts (org, role, active) are read from `echo.app_user` rather
 * than trusted from the token: a JWT can be stale about someone disabled or
 * moved orgs a minute ago, and M15's gate has to be current. That read runs
 * with the actor set, so db/0003's policies scope it — a caller can only ever
 * resolve *itself*.
 */
import type { Identity } from "../agent/types.ts";
import { assertUuid, type Db, type SqlTx } from "./identity.ts";

export class UnknownActorError extends Error {}
export class OwnerMismatchError extends Error {}

/**
 * The job's owner exists but may not act — pending, suspended org, disabled.
 *
 * Separate from OwnerMismatchError because the two want opposite handling:
 * this one is **reinstatable** (accept the signup, unsuspend the org) so the
 * job should be requeued when that happens, while a mismatch wants a human
 * to look at why a payload names an owner who cannot see the call.
 *
 * NOT a parameter property — see errors.ts. `readonly x` in a constructor
 * signature is a load-time syntax error under `--experimental-strip-types`,
 * and the whole suite stays green while the process refuses to start.
 */
export class InactiveOwnerError extends Error {
  readonly reason: "pending" | "suspended" | "disabled";

  constructor(message: string, reason: "pending" | "suspended" | "disabled") {
    super(message);
    this.reason = reason;
  }
}

interface AppUserRow {
  id: string;
  org_id: string;
  role: "admin" | "member";
  status: "pending" | "active" | "disabled";
  /** NULL when the org row is invisible to this actor — see SELECT_SELF. */
  org_status: "active" | "suspended" | null;
}

/**
 * LEFT JOIN, and it has to be.
 *
 * This was an inner join, which made the M15 pending state **structurally
 * unreachable**: db/0013's `app_user_read` deliberately lets a person read
 * their OWN row while pending — 0018's note says that is exactly what the UI
 * needs in order to say "awaiting approval" — but `org_read` requires
 * `actor_is_active()`. So a pending user could see themselves and not their
 * org, the inner join produced no row, and `resolveIdentity` threw
 * UnknownActorError. The api answered **401 unauthenticated** to a person
 * with a perfectly valid token, and the 403/`kind: "pending"` branch that the
 * whole M15 waiting-for-approval screen keys off could never be reached.
 *
 * Two RLS policies, each correct on its own, combining into a state no test
 * could see: every unit test fed this a fabricated row where the join had
 * already succeeded. Found by pointing a real pending account at the running
 * api, which was possible for about ten minutes before it was found.
 *
 * A NULL org_status is safe to treat as not-active because it can only mean
 * the actor could not read their org, and BOTH causes of that (the actor is
 * not active, or their org is suspended) are conditions under which the
 * answer is false anyway.
 */
const SELECT_SELF = `
  select u.id, u.org_id, u.role, u.status, o.status as org_status
  from echo.app_user u
  left join echo.org o on o.id = u.org_id
  where u.id = $1
  limit 1
`;

/**
 * WHY this person is inactive — the user's own account state, which the api
 * turns into a distinguishable 403 (steward ruling).
 *
 * The user's own status is checked FIRST. A pending person's org row is
 * invisible to them, so `org_status` is null and an org-first test would
 * report every pending signup as "suspended" — the new wrong answer replacing
 * the old one. Their own row is always visible to them (db/0013's
 * `app_user_read` self-read exception), so `u.status` is the reliable signal
 * and the org is only consulted once the person themselves is fine.
 */
function inactiveReason(row: AppUserRow): "pending" | "suspended" | "disabled" {
  if (row.status === "pending") return "pending";
  if (row.status === "disabled") return "disabled";
  // active person, org not readable or not active
  return "suspended";
}

/**
 * Resolve a user id to the Identity the rest of core/ uses.
 *
 * `isActive` mirrors db/0003's actor_is_active(): the person must be active
 * AND their org active. A pending signup (register-then-admin-accepts)
 * resolves with isActive:false rather than throwing — callers get a legible
 * "not activated yet", and the agent runtime refuses such actors outright.
 */
export async function resolveIdentity(db: Db, userId: string): Promise<Identity> {
  const actor = assertUuid(userId);
  const rows = await db.withActor(actor, (tx: SqlTx) =>
    tx.unsafe<AppUserRow>(SELECT_SELF, [actor]),
  );
  const row = rows[0];
  // Now genuinely means "no app_user row" — signup incomplete — rather than
  // also catching "the org join failed", which is what made a pending person
  // indistinguishable from a stranger.
  if (!row) throw new UnknownActorError("actor not found");
  const isActive = row.status === "active" && row.org_status === "active";
  return {
    userId: row.id,
    orgId: row.org_id,
    role: row.role,
    // A null org_status is not "active", so both a pending person and a
    // member of a suspended org resolve inactive.
    isActive,
    ...(isActive ? {} : { inactiveReason: inactiveReason(row) }),
  };
}

/**
 * Worker path: the job payload carries the call AND the owner it must run as
 * (written at enqueue time, when a real caller was present). We deliberately
 * do NOT look the owner up with an identity-less read — that read would be
 * denied by RLS anyway, and wanting to bypass RLS "just to find the owner" is
 * how service-account creep starts.
 *
 * Fail-closed self-check: after resolving the claimed owner, we read the call
 * AS THAT OWNER. If the call isn't visible to them, the payload is lying or
 * stale and the job fails rather than proceeding with an identity that
 * doesn't actually own the work.
 */
export async function identityForJob(
  db: Db,
  payload: { callId: string; ownerId: string },
): Promise<Identity> {
  const callId = assertUuid(payload.callId, "call id");
  const identity = await resolveIdentity(db, payload.ownerId);

  // An INACTIVE owner is a different fact from a lying payload, and it is
  // knowable here, so it is distinguished here.
  //
  // Both used to surface as OwnerMismatchError, because RLS denies each of
  // them identically: a pending owner sees no calls, and a forged payload
  // names an owner who sees no calls. Identical from outside, opposite in
  // meaning — one is reinstatable and one wants investigating. Backend 2 had
  // built this classification worker-side and correctly guessed it belonged
  // here: the api needs the same distinction the moment it answers "why is
  // this call stuck", and a rule that lives in two packages is a rule that
  // will disagree with itself.
  if (!identity.isActive) {
    throw new InactiveOwnerError(
      `job owner is not active (${identity.inactiveReason ?? "unknown"})`,
      identity.inactiveReason ?? "disabled",
    );
  }

  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string }>(`select id from echo.call where id = $1 limit 1`, [callId]),
  );
  if (!rows[0]) {
    // Reached only for an ACTIVE owner now, which sharpens it: the payload is
    // stale or forged, or the call is gone. Not "the owner was suspended".
    throw new OwnerMismatchError("job owner cannot see the call it was queued for");
  }
  return identity;
}
