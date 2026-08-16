/**
 * Invitations (M24, D25) and true delete (`tombstone_user`).
 *
 * Both halves of "add a person" and "remove a person" that the acceptance
 * queue could not express: an invite is a vouched arrival, and a tombstone is
 * the end that an append-only audit has to survive.
 *
 * ── The token, and why it looks exactly like an api key ─────────────────────
 *
 * Shown once, stored as sha256, with a short `token_prefix` kept in the clear
 * so a list can say WHICH invite without being able to reconstruct it. That
 * is the M17 api-key pattern, deliberately reused rather than reinvented: two
 * token schemes in one product means two places to get constant-time
 * comparison, storage and display wrong, and only one of them gets reviewed.
 *
 * ── The refusals that must stay identical ───────────────────────────────────
 *
 * `redeem_invitation` refuses expired, revoked, already-used, unknown, and
 * wrong-address the SAME way, and this file preserves that. It is tempting to
 * be helpful — "this invite expired" is friendlier than "no". But the caller
 * of a redeem endpoint is not necessarily the invitee: a forwarded link plus
 * a differentiated refusal turns the endpoint into an oracle for which
 * addresses have been invited to which org, which is org-membership
 * disclosure to whoever holds a stale link.
 *
 * The address match exists for the same reason. A forwarded link is not a
 * bearer token, and D8's fifth door is the place that rule is enforced.
 */
import { createHash, randomBytes } from "node:crypto";

import { record } from "./admin-actions.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { iso, isoOrNull, MEMBER_ROLES, type MemberRole } from "./vocabulary.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import { isOwner, type Identity } from "../agent/types.ts";

/** Distinct from the api-key prefix so the two can never be confused. */
const INVITE_PREFIX = "echo_inv_";
const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LEN = INVITE_PREFIX.length + 6;

export interface InvitationRecord {
  id: string;
  email: string;
  role: MemberRole;
  /** Enough to identify the invite in a list; never enough to redeem it. */
  token_prefix: string;
  expires_at: string;
  redeemed_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface MintedInvitation extends InvitationRecord {
  /** Shown once. Not stored, not recoverable, not logged. */
  token: string;
  /**
   * Whether the platform emailed the invitation itself (db/0060's flow:
   * the recipient clicks, sets a password, and arrives active — no token
   * ever shown to anyone). `false` carries a reason so the UI can offer
   * the token link as the RESCUE, not the default.
   */
  emailed: boolean;
  email_status: "sent" | "already_registered" | "send_failed" | "unconfigured";
}

const INVITATION_COLUMNS = `
  id, email, role, token_prefix, expires_at, redeemed_at, revoked_at, created_at
`;

const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const toInvitation = (row: Record<string, unknown>): InvitationRecord => ({
  id: row.id as string,
  email: String(row.email),
  role: row.role as MemberRole,
  token_prefix: String(row.token_prefix),
  expires_at: iso(row.expires_at),
  redeemed_at: isoOrNull(row.redeemed_at),
  revoked_at: isoOrNull(row.revoked_at),
  created_at: iso(row.created_at),
});

/** Default validity. Long enough to survive a weekend, short enough to expire. */
const DEFAULT_TTL_DAYS = 14;

export interface InvitationsConfig {
  /** Absent = invitations still mint, `email_status: "unconfigured"`. */
  supabaseUrl?: string | undefined;
  serviceKey?: string | undefined;
}

/**
 * Ask the auth provider to SEND the invitation email (user directive,
 * 2026-08-16: "invitation email does not send — make it simple, no token").
 *
 * GoTrue's admin invite creates the auth identity and emails a set-password
 * link; when the person completes it and registers, db/0060 redeems the
 * invitation on their verified address. "Already registered" is a distinct,
 * NON-failure answer: the person has an auth account — the moment they next
 * sign in without an app_user row, the same door catches them.
 *
 * Status-only error handling: an auth-api body can echo the address.
 */
async function sendInviteEmail(
  config: InvitationsConfig,
  email: string,
): Promise<MintedInvitation["email_status"]> {
  const base = config.supabaseUrl?.trim().replace(/\/+$/, "");
  if (!base || !config.serviceKey) return "unconfigured";
  try {
    const response = await fetch(`${base}/auth/v1/invite`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.serviceKey}`,
        apikey: config.serviceKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    if (response.ok) return "sent";
    // GoTrue answers 422 for an address that already has an identity
    if (response.status === 422) return "already_registered";
    return "send_failed";
  } catch {
    return "send_failed";
  }
}

export function createInvitationsRepo(db: Db, config: InvitationsConfig = {}) {
  return {
    async list(identity: Identity): Promise<InvitationRecord[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          // Live ones first: an admin opens this to see who is outstanding,
          // not to browse history.
          `select ${INVITATION_COLUMNS} from echo.invitation
            order by (redeemed_at is null and revoked_at is null) desc, created_at desc`,
        ),
      );
      return rows.map(toInvitation);
    },

    /**
     * Issue one. The token is returned ONCE and never again.
     *
     * The role ceiling is checked here because it is an authorization rule
     * about the ISSUER, not about the row: only an owner may invite an admin,
     * and nobody invites an owner (an org has exactly one, and it arrives by
     * transfer, not by email). `invitation_role_not_owner` is the wall behind
     * the second half; the first is ours because the database cannot see who
     * is asking beyond what RLS already scoped.
     */
    async issue(
      identity: Identity,
      input: { email: string; role?: string | undefined; ttlDays?: number | undefined },
    ): Promise<MintedInvitation> {
      const email = input.email.trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new ValidationError("a valid email address is required");
      }
      const role = (input.role ?? "member") as MemberRole;
      if (!MEMBER_ROLES.includes(role)) {
        throw new ValidationError(`role must be one of: ${MEMBER_ROLES.join(", ")}`);
      }
      if (role === "owner") {
        throw new ValidationError("an organization has one owner, and it arrives by transfer, not by invitation");
      }
      if (role === "admin" && !isOwner(identity)) {
        throw new ValidationError("only the owner may invite an admin");
      }
      const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
      if (!Number.isFinite(ttlDays) || ttlDays <= 0 || ttlDays > 90) {
        throw new ValidationError("ttl_days must be between 1 and 90");
      }

      const token = `${INVITE_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
      try {
        const rows = await db.withIdentity(identity, async (tx: SqlTx) => {
          const issued = await tx.unsafe<Record<string, unknown>>(
            `insert into echo.invitation
               (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
             values ($1, $2::citext, $3::echo.member_role, $4, $5, $6,
                     now() + make_interval(days => $7))
             returning ${INVITATION_COLUMNS}`,
            [
              identity.orgId, email, role, identity.userId,
              hashToken(token), token.slice(0, DISPLAY_PREFIX_LEN), ttlDays,
            ],
          );
          /**
           * The ROLE is recorded and the EMAIL is not.
           *
           * A role is a code from a closed vocabulary; an email address is a
           * person. `target_id` points at the invitation, and an admin who
           * needs the address reads it from the invitations surface, which
           * does its own access check. Copying it here would duplicate
           * personal data into a log that outlives the invitation.
           */
          if (issued[0]) {
            await record(tx, identity, {
              action: "invitation_issued",
              targetType: "invitation",
              targetId: issued[0].id as string,
              detail: { role },
            });
          }
          return issued;
        });
        const row = rows[0];
        if (!row) throw new NotFoundError("could not issue an invitation");
        // AFTER the row exists: an emailed link with no invitation behind it
        // would invite someone into nothing; a row whose email failed still
        // has the token as the rescue
        const emailStatus = await sendInviteEmail(config, email);
        return {
          ...toInvitation(row),
          token,
          emailed: emailStatus === "sent",
          email_status: emailStatus,
        };
      } catch (error) {
        const pg = error as { code?: string; constraint_name?: string };
        if (pg.code === "23505" && pg.constraint_name === "invitation_one_live_per_email") {
          // Terms are immutable after issue, so re-inviting is revoke-then-
          // reissue rather than an update. Saying so is the difference
          // between a dead end and an instruction.
          throw new ConflictError(
            "an invitation for this address is already live — revoke it first to change the terms",
          );
        }
        throw error;
      }
    },

    /** Revoke a live invitation. Never a delete — the audit keeps the attempt. */
    async revoke(identity: Identity, invitationId: string): Promise<InvitationRecord> {
      const id = assertUuid(invitationId, "invitation id");
      const rows = await db.withIdentity(identity, async (tx: SqlTx) => {
        const revoked = await tx.unsafe<Record<string, unknown>>(
          `update echo.invitation
              set revoked_at = now(), revoked_by = $2
            where id = $1 and revoked_at is null and redeemed_at is null
            returning ${INVITATION_COLUMNS}`,
          [id, identity.userId],
        );
        if (revoked[0]) {
          await record(tx, identity, {
            action: "invitation_revoked", targetType: "invitation", targetId: id,
          });
        }
        return revoked;
      });
      const row = rows[0];
      // Already revoked, already redeemed, or not visible: one answer. A
      // redeemed invite is not revocable and saying which it was would
      // disclose whether the person accepted.
      if (!row) throw new NotFoundError("no live invitation with that id");
      return toInvitation(row);
    },

    /**
     * Redeem (D8's fifth door). The caller proves the token AND the address.
     *
     * Every failure mode is one refusal. See the header — differentiating
     * them turns a forwarded link into a membership oracle.
     */
    async redeem(
      // Just the subject: a redeemer has no org yet — joining one is what
      // this does. Asking for an `orgId` here would force the caller to
      // invent a value the function never reads.
      userId: string,
      input: { token: string; email: string },
    ): Promise<void> {
      const token = input.token.trim();
      const email = input.email.trim().toLowerCase();
      if (!token || !email) throw new NotFoundError("this invitation cannot be redeemed");
      const rows = await db.withoutIdentity((tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select * from echo.redeem_invitation($1::text, $2::uuid, $3::citext)`,
          [hashToken(token), userId, email],
        ),
      ).catch((error: unknown) => {
        // The function refuses by raising; the api's job is to make every
        // raise look the same from outside.
        const pg = error as { code?: string };
        if (pg?.code === "42501" || pg?.code === "23514" || pg?.code === "P0002") {
          throw new NotFoundError("this invitation cannot be redeemed");
        }
        throw error;
      });
      if (!rows[0]) throw new NotFoundError("this invitation cannot be redeemed");
    },

    /**
     * True delete (M24), owner-only, via `echo.tombstone_user`.
     *
     * The warning and the explicit confirmation live in the UI by user
     * directive; the api exposes the named operation and nothing softer. It
     * empties the person, replaces the email, disables the account, and
     * soft-deletes their calls attributed to the deleter — so the audit
     * trail survives a person's removal, which is the whole point of doing it
     * this way rather than with a DELETE.
     */
    async tombstone(identity: Identity, memberId: string): Promise<void> {
      const id = assertUuid(memberId, "member id");
      if (id === identity.userId) {
        // The database would likely refuse too, but the message matters: an
        // owner deleting themselves would leave an org with no owner and no
        // way to appoint one.
        throw new ValidationError("an owner cannot delete their own account");
      }
      const rows = await db.withIdentity(identity, async (tx: SqlTx) => {
        const done = await tx.unsafe<{ tombstone_user: boolean }>(
          `select echo.tombstone_user($1::uuid) as tombstone_user`, [id],
        );
        /**
         * Only on a REAL deletion. `false` means already tombstoned, and a
         * second log entry for a repeated call would make the audit read as
         * two deletions of one person.
         *
         * This is the entry that matters most on the whole surface: it is the
         * one irreversible act, and after it runs the person's name is gone
         * from `app_user` — so `actor_name` resolves for the admin who did it
         * while the target resolves only by id. That asymmetry is correct;
         * the tombstone exists so references survive the person.
         */
        if (done[0]?.tombstone_user === true) {
          await record(tx, identity, {
            action: "member_deleted", targetType: "member", targetId: id,
          });
        }
        return done;
      }).catch((error: unknown) => {
        const pg = error as { code?: string };
        if (pg?.code === "42501") throw new NotFoundError("member not found");
        throw error;
      });
      // `false` = already tombstoned. Idempotent, like every other named
      // operation in this product: the caller wanted them gone, they are.
      if (!rows[0]) throw new NotFoundError("member not found");
    },
  };
}

export type InvitationsRepo = ReturnType<typeof createInvitationsRepo>;
