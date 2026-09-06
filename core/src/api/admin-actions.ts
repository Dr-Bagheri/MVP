/**
 * Writing `echo.admin_action` — the audit trail's missing third (M25).
 *
 * The table, its policies and the read surface at `GET /v1/admin/audit` all
 * existed for weeks. Nothing wrote to it. So an admin changed an org setting,
 * accepted a member, revoked an invitation — and the Audit Logs screen showed
 * nothing, while looking complete. FE3 named the hazard precisely: an admin
 * filtering to «کنش مدیر» reads "no events match", which says *no admin ever
 * changed anything* rather than *this is not recorded yet*.
 *
 * The steward ruled: close the writer, never paper over it with copy.
 *
 * ── Same transaction as the thing it records ────────────────────────────────
 *
 * `record()` takes a `tx`, not a `Db`, and that is the whole design. An audit
 * row written in its own transaction can succeed when the change failed, or
 * fail when the change succeeded, and both produce a log that disagrees with
 * the world. Inside the caller's transaction the two commit or roll back
 * together, which is the only version of "the record is true" that survives a
 * crash between two statements.
 *
 * It follows that a failure here FAILS THE OPERATION. That is deliberate: on
 * a surface whose whole promise is completeness, an unrecorded admin action
 * is worse than a refused one, because the refusal is visible and the gap is
 * not.
 *
 * ── Codes and identifiers, never values ─────────────────────────────────────
 *
 * I wrote the read half of this rule — "codes-not-content on the read surface
 * holds only if every writer respects it" — and this is the write half, so it
 * is binding on me first.
 *
 * `detail` is forwarded verbatim to every admin in the org. So it carries
 * WHICH fields changed and never what they changed to: `{"fields":["name"]}`,
 * not `{"name":"…"}`. A setting's value can be a person's name, an org's
 * private configuration, or an email address. `target_id` is how a reader
 * reaches the actual object, through a surface that does its own access
 * check — which is where that disclosure belongs, not here.
 *
 * B3 rewrote db/0010's column comment for the same reason: it used to say
 * "identifiers, before/after states, reasons", and *states* reads as
 * permission to store an old and new VALUE.
 */
import { toJsonb, JSONB_PARAM } from "../db/jsonb.ts";
import type { SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { ADMIN_ACTIONS, type AdminAction } from "./vocabulary.ts";

/* the list itself moved to vocabulary.ts on 2026-09-06 (the web reads it
   through @echo/core/vocabulary); re-exported so this stays its home for
   every caller that learned it here */
export { ADMIN_ACTIONS, type AdminAction };

/**
 * The closed set of things an admin can be recorded doing.
 */

export interface AdminActionRecord {
  action: AdminAction;
  /** What kind of thing was acted on — `org`, `member`, `invitation`. */
  targetType: "org" | "member" | "invitation";
  targetId: string | null;
  /** Codes and identifiers ONLY. See the header. */
  detail?: Record<string, unknown> | undefined;
}

/**
 * Record one admin action, in the caller's transaction.
 *
 * Call it AFTER the mutation succeeds and inside the same `withIdentity`
 * callback, so a refused or zero-row change never leaves a log entry claiming
 * it happened.
 */
export async function record(
  tx: SqlTx, identity: Identity, entry: AdminActionRecord,
): Promise<void> {
  await tx.unsafe(
    `insert into echo.admin_action
       (org_id, actor_id, action, target_type, target_id, detail)
     values ($1, $2, $3, $4, $5::uuid, ${JSONB_PARAM(6)})`,
    [
      identity.orgId, identity.userId, entry.action, entry.targetType,
      entry.targetId, toJsonb(entry.detail ?? {}),
    ],
  );
}

/**
 * Which fields a patch actually set — the detail shape for an update.
 *
 * Names only. `{"fields":["name","locale"]}` says an admin renamed the org
 * and changed its language without saying what to, which is the most an
 * audit reader can be given without the log becoming a copy of the data it
 * is auditing.
 */
export function changedFields(patch: Record<string, unknown>): { fields: string[] } {
  return { fields: Object.keys(patch).filter((key) => patch[key] !== undefined).sort() };
}
