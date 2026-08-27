import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { isAdmin, isOwner } from "../agent/types.ts";
import { NotActivatedError, ValidationError } from "./errors.ts";

/**
 * MEMBER PRIVILEGES (db/0101) — the capability layer.
 *
 * What it is, stated once so no caller has to infer it: a capability can
 * only NARROW what a role may do. RLS decides which rows exist for a
 * caller; this decides whether the api offers an action the database would
 * already have allowed. Nothing here can widen anything — if the database
 * refuses, a switch turned on changes nothing at all.
 *
 * That asymmetry is why the vocabulary is closed and every entry names a
 * real enforcement point. A capability with no route behind it would read
 * as a promise on screen and do nothing on press, which is the worst thing
 * a security surface can be.
 */

/** the roles that can be restricted at all — the owner is the exit (0101) */
export const CAPABILITY_ROLES = ["member", "admin"] as const;
export type CapabilityRole = (typeof CAPABILITY_ROLES)[number];

export interface CapabilityDef {
  key: string;
  /** whose privilege this is; also who may CHANGE it (0101's hierarchy) */
  role: CapabilityRole;
}

/**
 * The closed vocabulary. Every key is enforced by a route — the guard call
 * is the second half of each line, and core/test/capabilities.test.ts fails
 * if a key here has no `requireCapability` behind it.
 */
export const CAPABILITIES: readonly CapabilityDef[] = [
  /* --- what a MEMBER may do; an admin or the owner may take these away -- */
  { key: "records.delete", role: "member" },   // DELETE /v1/calls/:id
  { key: "records.share", role: "member" },    // PATCH  /v1/calls/:id/scope
  { key: "records.upload", role: "member" },   // POST   /v1/calls
  { key: "assistant.ask", role: "member" },    // POST   /v1/ask
  { key: "directory.edit", role: "member" },   // POST   /v1/directory
  /* --- what an ADMIN may do; only the OWNER may take these away --------- */
  { key: "members.manage", role: "admin" },    // PATCH  /v1/admin/members/:id
  { key: "invitations.send", role: "admin" },  // POST   /v1/invitations
  { key: "org.settings", role: "admin" },      // PATCH  /v1/admin/org
];

const KEYS = new Set(CAPABILITIES.map((c) => c.key));
const ROLE_OF = new Map(CAPABILITIES.map((c) => [c.key, c.role] as const));

export interface CapabilityRow {
  role: CapabilityRole;
  capability: string;
  allowed: boolean;
}

export function createCapabilitiesRepo(db: Db) {
  /**
   * The org's written decisions. ABSENT means allowed: a fresh org has no
   * rows and behaves exactly as the product did before this table existed,
   * so the feature cannot lock anybody out by arriving.
   */
  async function list(identity: Identity): Promise<CapabilityRow[]> {
    const rows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ role: string; capability: string; allowed: boolean }>(
        `select role, capability, allowed from echo.role_capability
          where org_id = $1`,
        [identity.orgId],
      ));
    return rows
      .filter((row) => KEYS.has(row.capability))
      .map((row) => ({
        role: row.role as CapabilityRole,
        capability: row.capability,
        allowed: row.allowed,
      }));
  }

  /**
   * Is this caller allowed to do `capability`?
   *
   * The OWNER is always allowed — 0101 refuses to store a row for them, and
   * this mirrors that in one line rather than trusting the table to be
   * empty. An ADMIN is bound only by admin-role capabilities; a member only
   * by member-role ones. A caller whose role outranks the capability's role
   * is not restricted by it: taking "members may delete records" away must
   * not disarm the admin who took it away.
   */
  async function allows(identity: Identity, capability: string): Promise<boolean> {
    if (!KEYS.has(capability)) {
      // an unknown key restricts nothing: a typo must never become a lock
      return true;
    }
    if (isOwner(identity)) return true;
    const scope = ROLE_OF.get(capability)!;
    if (scope === "member" && isAdmin(identity)) return true;
    if (scope === "admin" && !isAdmin(identity)) return true;
    const rows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ allowed: boolean }>(
        `select allowed from echo.role_capability
          where org_id = $1 and role = $2 and capability = $3`,
        [identity.orgId, scope, capability],
      ));
    return rows[0]?.allowed ?? true;
  }

  /** the guard routes call; refuses with the same sentence every wall uses */
  async function require(identity: Identity, capability: string): Promise<void> {
    if (await allows(identity, capability)) return;
    /* the SAME refusal as every other wall in this api: a caller learns
       that they may not, never how the decision was configured */
    throw new NotActivatedError("not permitted");
  }

  /**
   * Write one decision. The HIERARCHY is enforced by 0101's policy — an
   * admin writing an admin row is refused by the database, not by this
   * function — and the check here exists to turn that refusal into a
   * sentence rather than a 42501. Both layers, deliberately: the policy is
   * the wall, this is the manners.
   */
  async function set(
    identity: Identity,
    input: { role: string; capability: string; allowed: boolean },
  ): Promise<CapabilityRow[]> {
    if (!KEYS.has(input.capability)) {
      throw new ValidationError("unknown capability", { code: "unknown_capability" });
    }
    const scope = ROLE_OF.get(input.capability)!;
    if (input.role !== scope) {
      throw new ValidationError("that capability belongs to the other role",
        { code: "wrong_role" });
    }
    if (scope === "admin" && !isOwner(identity)) {
      // only the owner may bind admins — the exit stays open (D27)
      throw new NotActivatedError("not permitted");
    }
    await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe(
        `insert into echo.role_capability (org_id, role, capability, allowed, updated_by)
         values ($1, $2, $3, $4, $5)
         on conflict (org_id, role, capability)
           do update set allowed = excluded.allowed,
                         updated_by = excluded.updated_by,
                         updated_at = now()`,
        [identity.orgId, input.role, input.capability, input.allowed, identity.userId],
      ));
    return list(identity);
  }

  return { list, allows, require, set };
}

export type CapabilitiesRepo = ReturnType<typeof createCapabilitiesRepo>;
