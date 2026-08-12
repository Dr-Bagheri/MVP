/**
 * Auth for the api process (M3/M15).
 *
 * Supabase issues the JWT; we verify it and then **re-derive membership from
 * the database** (see db/actor.ts). The token proves *who* the caller is; it
 * is never trusted for *what they may do* — a token minted a minute ago can
 * be stale about someone disabled, moved orgs, or still pending.
 *
 * M15 signup-pending: a verified token whose user row is `pending` resolves
 * to an Identity with isActive:false. Such a caller can read their own
 * status (so the UI can say "waiting for an admin") and nothing else —
 * `requireActive` is the guard every product route uses.
 */
import { identityFromApiKey, isApiKey } from "./apikeys.ts";
import { NotActivatedError, UnauthenticatedError } from "./errors.ts";
import { createVerifier } from "./jwt.ts";
import { resolveIdentity, UnknownActorError } from "../db/actor.ts";
import type { Db } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

/**
 * Defined in errors.ts (next to the mapping that gives them meaning) and
 * re-exported here, because M17's gateway path makes auth.ts ↔ apikeys.ts ↔
 * errors.ts a cycle otherwise. Every existing importer keeps working.
 */
export { NotActivatedError, UnauthenticatedError } from "./errors.ts";

export interface AuthOptions {
  db: Db;
  /** Supabase JWT secret (HS256) — from env, never a literal (invariant 7). */
  jwtSecret: string;
  /** Optional issuer/audience pinning. */
  issuer?: string | undefined;
}

export interface AuthedRequest {
  headers: { authorization?: string | undefined };
}

export function createAuth({ db, jwtSecret, issuer }: AuthOptions) {
  const verify = createVerifier({ secret: jwtSecret, issuer });

  /**
   * Verified caller, membership fresh from the DB. Throws for a missing,
   * malformed, expired or unknown-subject token — never returns a partial
   * identity.
   */
  async function identify(request: AuthedRequest): Promise<Identity> {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new UnauthenticatedError("missing bearer token");

    // M17: a gateway key arrives in the same slot and resolves to the member
    // it acts as, then continues down the identical path. That is the point —
    // "the internal BFF hop and the public gateway must not diverge" is only
    // true if there is one identify(), one requireActive(), one wall. A
    // separate gateway auth path is how the two drift until one of them is
    // missing a check the other has.
    if (isApiKey(token)) return identityFromApiKey(db, token);

    let subject: string;
    try {
      subject = verify(token).sub;
    } catch (error) {
      throw new UnauthenticatedError(
        error instanceof Error ? error.message : "invalid token",
      );
    }

    try {
      return await resolveIdentity(db, subject);
    } catch (error) {
      if (error instanceof UnknownActorError) {
        // verified token, but no app_user row: signup incomplete
        throw new UnauthenticatedError("no account for this token");
      }
      throw error;
    }
  }

  /** Product routes: identified AND activated (M15). */
  async function requireActive(request: AuthedRequest): Promise<Identity> {
    const identity = await identify(request);
    if (!identity.isActive) {
      // "disabled" deliberately maps to the generic `forbidden`, NOT to a
      // fourth wire value. The steward ruled `suspended` (an org switched
      // off, resolved with us); a disabled individual is an org-admin action
      // and the copy for it isn't ruled. Sending an unruled kind would put a
      // string on the wire that no screen is designed for — the caller still
      // gets a truthful 403, just without a claim we haven't decided.
      throw new NotActivatedError(
        "account is not active",
        identity.inactiveReason === "pending" ? "pending"
          : identity.inactiveReason === "suspended" ? "suspended"
            : "forbidden",
      );
    }
    return identity;
  }

  /** Admin-only routes. Same not-probeable posture as the tool wall. */
  async function requireAdmin(request: AuthedRequest): Promise<Identity> {
    const identity = await requireActive(request);
    if (identity.role !== "admin") throw new NotActivatedError("not permitted");
    return identity;
  }

  return { identify, requireActive, requireAdmin };
}

export type Auth = ReturnType<typeof createAuth>;
