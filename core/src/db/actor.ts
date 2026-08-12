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

interface AppUserRow {
  id: string;
  org_id: string;
  role: "admin" | "member";
  status: "pending" | "active" | "disabled";
  org_status: "active" | "suspended";
}

const SELECT_SELF = `
  select u.id, u.org_id, u.role, u.status, o.status as org_status
  from echo.app_user u
  join echo.org o on o.id = u.org_id
  where u.id = $1
  limit 1
`;

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
  if (!row) throw new UnknownActorError("actor not found");
  return {
    userId: row.id,
    orgId: row.org_id,
    role: row.role,
    isActive: row.status === "active" && row.org_status === "active",
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

  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string }>(`select id from echo.call where id = $1 limit 1`, [callId]),
  );
  if (!rows[0]) {
    throw new OwnerMismatchError("job owner cannot see the call it was queued for");
  }
  return identity;
}
