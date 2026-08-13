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
import { createVerifier, type VerifiedClaims } from "./jwt.ts";
import { resolveIdentity, UnknownActorError } from "../db/actor.ts";
import type { Db } from "../db/identity.ts";
import { isAdmin, isOwner, type Identity } from "../agent/types.ts";

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

/**
 * How stale `last_seen_at` may get before we spend a write on it (M24).
 *
 * "Last active" is a human-legible fact on an admin screen, not telemetry —
 * five minutes of imprecision is invisible there, and the alternative is a
 * write on every authenticated request for a column nobody reads in real
 * time.
 */
const LAST_SEEN_STALE_SECONDS = 300;

export function createAuth({ db, jwtSecret, issuer }: AuthOptions) {
  const verify = createVerifier({ secret: jwtSecret, issuer });

  /** Skip the round trip entirely for callers we stamped recently. */
  const stampedAt = new Map<string, number>();

  /**
   * Stamp `last_seen_at` — the ONE place in the product that writes it (M24).
   *
   * Deliberately HERE and not in `resolveIdentity`, which looks like the
   * obvious home and is the wrong one: that resolver is shared with the
   * worker, so a 3am summarizer job running as its owner would mark that
   * person active. Backend 2 caught me proposing exactly that. "Last active"
   * has to mean a human did something, or the column is worse than absent —
   * an admin deciding who to disable would be reading job schedules.
   *
   * For the same reason a gateway key never reaches here: `identify()`
   * returns on the api-key branch above, so an integration polling every
   * minute does not keep its owner looking permanently online. A machine
   * acting as you is not you being active — the 3am problem wearing M17's
   * costume.
   *
   * Throttled twice over. The in-process map skips the statement for callers
   * seen recently; the SQL predicate makes the write a no-op anyway, so
   * correctness does not depend on the memo and several api processes cannot
   * stampede the row.
   *
   * Never fails a request. A refused or failed stamp means an admin screen
   * shows a slightly stale time; turning that into a 500 would take the
   * product down for a cosmetic column.
   */
  async function touchLastSeen(identity: Identity): Promise<void> {
    const now = Date.now();
    const last = stampedAt.get(identity.userId);
    // One number, two clocks. The in-process memo and the SQL predicate must
    // agree, so they are derived from the same constant rather than written
    // twice — `5 * 60 * 1000` here and `'5 minutes'` there is two spellings
    // of one rule, and the one nobody exercises is the one that drifts.
    if (last !== undefined && now - last < LAST_SEEN_STALE_SECONDS * 1000) return;
    stampedAt.set(identity.userId, now);
    try {
      await db.withIdentity(identity, (tx) =>
        tx.unsafe(
          `update echo.app_user
              set last_seen_at = now()
            where id = $1
              and (last_seen_at is null
                   or last_seen_at < now() - make_interval(secs => $2))`,
          [identity.userId, LAST_SEEN_STALE_SECONDS],
        ),
      );
    } catch {
      // Deliberately swallowed — see above. Not even logged at warn: a
      // failure here repeats on every request and would drown the log in
      // noise about a column that does not gate anything.
    }
  }

  /**
   * Verified caller, membership fresh from the DB. Throws for a missing,
   * malformed, expired or unknown-subject token — never returns a partial
   * identity.
   */
  function bearer(request: AuthedRequest): string {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new UnauthenticatedError("missing bearer token");
    return token;
  }

  /**
   * The ONE case where a verified token is useful without an `app_user` row:
   * registration (M15).
   *
   * `identify()` cannot serve it by construction — it resolves membership from
   * the database and a person signing up has no membership yet, which is the
   * whole point. That gap was not theoretical: `echo.register_account()` has
   * existed in db/0015 since it was written, described as "the only way an
   * app_user row is created", and **nothing called it**. A new person got a
   * valid Supabase token, hit 401 "no account for this token", and never
   * appeared in the admin's pending queue either, because nothing created the
   * pending row. M15 was unreachable end to end.
   *
   * Two rules hold this narrow:
   *  - the account id is the token's `sub` and NEVER a body field, so nobody
   *    can register on someone else's behalf;
   *  - an api key is refused outright. A gateway key belongs to an org that
   *    already exists, and must not be a door to creating accounts (M17).
   */
  function verifiedClaims(request: AuthedRequest): VerifiedClaims {
    const token = bearer(request);
    if (isApiKey(token)) {
      throw new UnauthenticatedError("an api key cannot register an account", "no_token");
    }
    try {
      return verify(token);
    } catch (error) {
      throw new UnauthenticatedError(
        error instanceof Error ? error.message : "invalid token",
        "bad_signature",
      );
    }
  }

  async function identify(request: AuthedRequest): Promise<Identity> {
    const token = bearer(request);

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
        "bad_signature",
      );
    }

    try {
      const identity = await resolveIdentity(db, subject);
      await touchLastSeen(identity);
      return identity;
    } catch (error) {
      if (error instanceof UnknownActorError) {
        // Verified token, no app_user row. Since /v1/signup exists this is a
        // person who has not registered yet — NOT the same failure as a token
        // we could not verify, and telling them apart is the whole point of
        // the kind (see UnauthenticatedKind).
        throw new UnauthenticatedError("no account for this token", "unknown_actor");
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

  /**
   * Admin-only routes. Same not-probeable posture as the tool wall.
   *
   * `isAdmin` rather than `role === "admin"`: since M23 the OWNER is the
   * founding admin with more authority, not a different kind of user, so
   * every admin gate must admit them. This line read `role !== "admin"`
   * until the schema-contract check caught `owner` arriving in the enum —
   * which would have locked an org's root out of its own admin routes.
   */
  async function requireAdmin(request: AuthedRequest): Promise<Identity> {
    const identity = await requireActive(request);
    if (!isAdmin(identity)) throw new NotActivatedError("not permitted");
    return identity;
  }

  /**
   * Owner-only routes: M23's org-level irreversibles (member true-delete,
   * org settings, promoting or demoting an admin). An ADMIN is refused here,
   * and gets the same indistinguishable "not permitted" a member gets — the
   * wall does not explain how far up it goes.
   */
  async function requireOwner(request: AuthedRequest): Promise<Identity> {
    const identity = await requireActive(request);
    if (!isOwner(identity)) throw new NotActivatedError("not permitted");
    return identity;
  }

  return { identify, requireActive, requireAdmin, requireOwner, verifiedClaims };
}

export type Auth = ReturnType<typeof createAuth>;
