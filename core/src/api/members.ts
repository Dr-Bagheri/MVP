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

export interface MeRecord extends MemberRecord {
  org_id: string;
  org_name: string | null;
  /** NULL = has not chosen. M5 imposes no default (see api/models.ts). */
  preferred_model: string | null;
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

export interface RegisterInput {
  /** From the verified token's `sub`. NEVER from the request body. */
  userId: string;
  /** From the token's `email` claim — Supabase owns the address, not us. */
  email: string;
  displayName: string;
  /** Create a new org and become its admin. Mutually exclusive with joinOrg. */
  orgName?: string | undefined;
  /** Join an existing org as a pending member. */
  joinOrg?: string | undefined;
}

export function createMembersRepo(db: Db) {
  return {
    /**
     * Registration (M15) — the only door, and until now an unopened one.
     *
     * All this does is call `echo.register_account()`, which is deliberate:
     * that function decides org-vs-join, stamps `pending`, and is one of the
     * product's two SECURITY DEFINER doors. Re-implementing any of it here
     * would be the second way to create an account, and a gate with two doors
     * is not a gate.
     *
     * `withoutIdentity` is right here and nowhere else in this file: the
     * caller is verified but has no `app_user` row yet, so there is no actor
     * to scope by. It is safe only because the function takes the id as an
     * explicit argument rather than reading `echo.actor_id()` — and because
     * the caller cannot choose that id (it is the token's `sub`).
     */
    async register(input: RegisterInput): Promise<MemberRecord & { org_id: string }> {
      assertUuid(input.userId, "user id");
      if (input.orgName && input.joinOrg) {
        // Ambiguous rather than harmless: the db would silently prefer the
        // join and quietly ignore the name someone typed for their new org.
        throw new ValidationError("provide either org_name or join_org, not both");
      }
      if (input.joinOrg) assertUuid(input.joinOrg, "organization id");
      const email = input.email.trim();
      if (!email) throw new ValidationError("token has no email claim");

      try {
        // Explicit casts: with bare placeholders Postgres cannot resolve the
        // (uuid, citext, text, text, uuid) signature and answers 42P18
        // "could not determine data type of parameter" — which reads like a
        // missing function rather than a missing cast.
        const rows = await db.withoutIdentity((tx: SqlTx) =>
          tx.unsafe<Record<string, unknown>>(
            `select * from echo.register_account($1::uuid, $2::citext, $3::text, $4::text, $5::uuid)`,
            [input.userId, email, input.displayName.trim(), input.orgName ?? null, input.joinOrg ?? null],
          ),
        );
        const row = rows[0];
        if (!row) throw new ConflictError("registration produced no account");
        return { ...toMember(row), org_id: row.org_id as string };
      } catch (error) {
        const pg = error as { code?: string; constraint_name?: string };
        if (pg.code === "23505") {
          // Already registered. A conflict, not a fault — and NOT a hint that
          // the address exists: the caller already proved they hold this token.
          throw new ConflictError("this account is already registered");
        }
        if (pg.code === "23503") {
          // Two different causes, and they must not be conflated (rule 12):
          // the org they asked to join does not exist, OR there is no
          // auth.users row for this token's subject (db/0002's FK). The
          // second means the identity itself is unknown to Supabase.
          throw pg.constraint_name
            ? new ValidationError("no auth identity for this token")
            : new ValidationError("no such organization");
        }
        throw error;
      }
    },

    /**
     * The caller's own profile — who am I, and what may I do.
     *
     * BLOCKING for the web client and it has no fallback: M1 keeps the token
     * server-side, so the browser never sees the JWT and cannot read its own
     * claims. Without this route the shell cannot know the signed-in person's
     * name or role, which gates the profile screen and every admin surface.
     * The frontend found it the moment mocks came off.
     *
     * Role and status come from `resolveIdentity` (the database), never from
     * the token — a token minted a minute ago can be stale about someone
     * whose role just changed.
     */
    async me(identity: Identity): Promise<MeRecord> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          // The org join is LEFT for the same reason resolveIdentity's is: an
          // inactive person cannot read their org row, and an inner join
          // would turn "you are suspended" into "you do not exist" — the M15
          // bug, one layer up. requireActive gates this route today, so it
          // cannot bite here; it is left this way so it still cannot if a
          // future surface serves /me to a pending person to explain why.
          // Written out rather than derived from MEMBER_COLUMNS by string
          // surgery: a regex that rewrites a column list is unreadable at the
          // call site and breaks silently when someone adds a column with a
          // comment or a cast. Two lists that must agree is the smaller risk
          // here than one list nobody can see the output of.
          `select u.id, u.email, u.display_name, u.role, u.status,
                  u.accepted_at, u.last_seen_at, u.created_at,
                  u.preferred_model, o.name as org_name
             from echo.app_user u
             left join echo.org o on o.id = u.org_id
            where u.id = $1
            limit 1`,
          [identity.userId],
        ),
      );
      const row = rows[0];
      // An authenticated caller can always read their own row (db/0013's
      // self-read exception), so no row here is a fault, not a refusal.
      if (!row) throw new NotFoundError("member not found");
      return {
        ...toMember(row),
        org_id: identity.orgId,
        org_name: (row.org_name as string | null) ?? null,
        // Carried here so the shell need not call /v1/models just to know
        // whether a model has been chosen. NULL is a real state (M5).
        preferred_model: (row.preferred_model as string | null) ?? null,
      };
    },

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
