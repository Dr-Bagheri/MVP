/**
 * Members and the pending-approval queue (M15, SPEC §"Settings & admin").
 *
 * Acceptance is the whole point of M15: anyone may register, nobody sees
 * anything until an admin accepts them. This is the surface that admin acts
 * through, and it is deliberately thin — db/0011's trigger stamps
 * `accepted_at`/`accepted_by`, db/0013's `app_user_write` decides who may
 * change whom, and this file neither re-implements nor second-guesses either.
 *
 * The one thing it will NOT do is create a member. Registration goes through
 * `echo.register_account()` (db/0015) — one of only two SECURITY DEFINER
 * doors in the product — which always produces `pending`. An admin-side
 * "add member" that skipped that would be a second way to create an account,
 * and the acceptance gate is exactly the thing that must not have two doors.
 */
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { iso, isoOrNull } from "./vocabulary.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface MemberRecord {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "member";
  status: "pending" | "active" | "disabled";
  accepted_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

const MEMBER_COLUMNS = `
  id, email, display_name, role, status, accepted_at, last_seen_at, created_at
`;

const toMember = (row: Record<string, unknown>): MemberRecord => ({
  id: row.id as string,
  email: String(row.email),
  display_name: (row.display_name as string) ?? "",
  role: row.role as "admin" | "member",
  status: row.status as MemberRecord["status"],
  accepted_at: isoOrNull(row.accepted_at),
  last_seen_at: isoOrNull(row.last_seen_at),
  created_at: iso(row.created_at),
});

export function createMembersRepo(db: Db) {
  return {
    /**
     * The org's people. RLS scopes it (`app_user_read`: own row, or the org
     * if active), so this adds ordering, not a predicate.
     *
     * Pending first, deliberately: the queue is the thing an admin opens this
     * screen to act on, and burying it under an alphabetical list of active
     * members is how someone waits a week for approval.
     */
    async list(identity: Identity): Promise<MemberRecord[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${MEMBER_COLUMNS} from echo.app_user
            order by (status = 'pending') desc, created_at`,
        ),
      );
      return rows.map(toMember);
    },

    /**
     * Accept a pending signup (M15). `accepted_at`/`accepted_by` are stamped
     * by db/0011's trigger, not written here — one writer for that fact.
     *
     * `status = 'pending'` in the WHERE is not just an optimisation: it makes
     * accepting an already-active member affect no rows, which we report as a
     * conflict rather than a cheerful success that re-stamps nothing.
     */
    async accept(identity: Identity, memberId: string): Promise<MemberRecord> {
      const id = assertUuid(memberId, "member id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `update echo.app_user set status = 'active'
            where id = $1 and status = 'pending'
            returning ${MEMBER_COLUMNS}`,
          [id],
        ),
      );
      const row = rows[0];
      // No row = not pending, not visible, or not ours to change. All three
      // are 404 for the same not-probeable reason used everywhere else.
      if (!row) throw new NotFoundError("no pending member with that id");
      return toMember(row);
    },

    /**
     * Role change and disable/enable, the two things an admin actually does
     * to an existing member.
     *
     * The self-demotion guard is the one piece of judgement here: an admin
     * removing their OWN admin role can strand an org with no admin, and
     * nothing in the schema prevents it (db/0013's `app_user_write` allows
     * editing your own row by design, so the profile screen works). Refused
     * with a legible message rather than allowed and regretted.
     */
    async update(
      identity: Identity, memberId: string,
      patch: { role?: "admin" | "member" | undefined; status?: "active" | "disabled" | undefined },
    ): Promise<MemberRecord> {
      const id = assertUuid(memberId, "member id");
      if (patch.role === undefined && patch.status === undefined) {
        throw new ValidationError("nothing to update");
      }
      if (patch.role !== undefined && patch.role !== "admin" && patch.role !== "member") {
        throw new ValidationError("role must be admin or member");
      }
      if (patch.status !== undefined && patch.status !== "active" && patch.status !== "disabled") {
        // 'pending' is not settable: it is where registration puts you, and
        // going back would be a second, quieter way to revoke access than
        // disabling — with different semantics nobody has decided.
        throw new ValidationError("status must be active or disabled");
      }
      if (id === identity.userId && patch.role === "member") {
        throw new ConflictError("an admin cannot remove their own admin role");
      }
      if (id === identity.userId && patch.status === "disabled") {
        throw new ConflictError("an admin cannot disable their own account");
      }

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `update echo.app_user
              set role   = coalesce($2::echo.member_role, role),
                  status = coalesce($3::echo.user_status, status)
            where id = $1 and status <> 'pending'
            returning ${MEMBER_COLUMNS}`,
          [id, patch.role ?? null, patch.status ?? null],
        ),
      );
      const row = rows[0];
      // `status <> 'pending'` keeps acceptance on its own path: promoting a
      // pending person to admin would activate them by a side door.
      if (!row) throw new NotFoundError("member not found");
      return toMember(row);
    },
  };
}

export type MembersRepo = ReturnType<typeof createMembersRepo>;
