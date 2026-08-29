/**
 * An admin sets a member's password (user directive, 2026-08-29).
 *
 * Three things have to happen together, and the order is the design:
 *
 *   1. AUTHORIZE, in the database. `echo.actor_outranks` (0077) is the same
 *      rank rule the session doors and the key-minting door speak — strictly
 *      greater rank, same org, both active. There is no self case, and 0137's
 *      header explains why at length: the self path (Settings) requires the
 *      CURRENT password, and that check is the whole security of it. An admin
 *      door does not ask for the current password, so letting someone route
 *      through it at themselves would hand a hijacked session a way to lock
 *      the real owner out.
 *
 *   2. SET IT, through Supabase's admin API. The password never touches our
 *      database, never reaches a log line, and is not returned. Errors are
 *      handled by STATUS only — a GoTrue error body can echo the address and
 *      sometimes the value it rejected.
 *
 *   3. END THEIR SESSIONS, and this is the step that is easy to leave out.
 *      Setting a password does not invalidate refresh tokens, so every device
 *      already signed in stays signed in. An admin resetting a password for a
 *      locked-out colleague loses nothing by that; an admin resetting one
 *      BECAUSE an account may be compromised is doing the single thing they
 *      believe closes the door — and it would not.
 *
 * The audit row is written last, in the same transaction as the session
 * teardown, so a failed reset cannot leave a log entry claiming it happened.
 * It records that it happened, to whom, by whom, and how many sessions ended.
 * Nothing about the password itself: not its length, not a strength score,
 * not a hash prefix.
 */
import { record } from "./admin-actions.ts";
import { ValidationError } from "./errors.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface MemberPasswordConfig {
  supabaseUrl?: string | undefined;
  serviceKey?: string | undefined;
  /** injected in tests; the real one is global fetch */
  fetchImpl?: typeof fetch | undefined;
}

/**
 * The floor, mirrored from Supabase's own default (6) and raised to 8.
 *
 * A LOCAL check, and it is not the wall — GoTrue enforces its own policy and
 * would refuse a weak password anyway. This exists so the refusal is legible:
 * "at least 8 characters" beats a 422 whose body we deliberately do not read.
 */
const MIN_LENGTH = 8;

export function createMemberPasswordRepo(db: Db, config: MemberPasswordConfig) {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    /**
     * @returns how many sessions the reset ended — the number the audit
     * reader and the admin both want, and the only thing this returns.
     */
    async set(identity: Identity, memberId: string, password: string): Promise<{ sessions_ended: number }> {
      const target = assertUuid(memberId, "member id");

      if (typeof password !== "string" || password.length < MIN_LENGTH) {
        throw new ValidationError(`a password must be at least ${MIN_LENGTH} characters`, {
          code: "password_too_short",
          params: { min: String(MIN_LENGTH) },
        });
      }

      /*
       * Asked BEFORE the provider call, so a refused reset never reaches
       * Supabase at all. The database is still the wall — `end_all_member_
       * sessions` re-asks the same question underneath — but a reset that
       * failed authorization after changing the password would have already
       * done the irreversible half.
       */
      const [rank] = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ outranks: boolean | null }>(
          "select echo.actor_outranks($1) as outranks", [target]));
      if (rank?.outranks !== true) {
        /* `ValidationError` with a code, following the key-minting door's
           precedent for the identical rank check — one refusal shape for one
           rule, rather than a second class invented here. */
        throw new ValidationError("a password may be set only for a member you outrank", {
          code: "outrank_required",
        });
      }

      const base = config.supabaseUrl?.trim().replace(/\/+$/, "");
      if (!base || !config.serviceKey) {
        /*
         * Loud, not silent. A deployment without the service key cannot do
         * this at all, and reporting success would leave an admin believing
         * they had handed someone a working password.
         */
        throw new ValidationError("password reset is not configured on this deployment", {
          code: "password_reset_unconfigured",
        });
      }

      const response = await doFetch(`${base}/auth/v1/admin/users/${encodeURIComponent(target)}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${config.serviceKey}`,
          apikey: config.serviceKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        /* STATUS ONLY — an auth-api body can echo the address, and on a
           rejected password it can echo the reason in terms of the value. */
        if (response.status === 422 || response.status === 400) {
          throw new ValidationError("the provider refused that password", {
            code: "password_rejected",
          });
        }
        if (response.status === 404) {
          throw new ValidationError("that member has no sign-in account", {
            code: "no_auth_account",
          });
        }
        throw new Error(`auth admin api refused: ${response.status}`);
      }

      return db.withIdentity(identity, async (tx: SqlTx) => {
        const [ended] = await tx.unsafe<{ n: number }>(
          "select echo.end_all_member_sessions($1) as n", [target]);
        const sessions = Number(ended?.n ?? 0);
        await record(tx, identity, {
          action: "member_password_set",
          targetType: "member",
          targetId: target,
          detail: { sessions_ended: sessions },
        });
        return { sessions_ended: sessions };
      });
    },
  };
}
