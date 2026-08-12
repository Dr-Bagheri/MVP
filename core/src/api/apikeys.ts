/**
 * The inbound half of the gateway (M17): per-org API keys.
 *
 * The one thing to understand about this file is what a key is NOT. It does
 * not authenticate "the org", and it grants nothing of its own. It names a
 * member, and a request carrying it proceeds **as that member** and meets the
 * identical RLS wall a browser request meets. db/0009 says it in the schema
 * (`api_key.actor_id` is a FK to a member of the same org) and db/0015 says
 * it in the resolver; this file is the third place it has to stay true, and
 * the tempting shortcut — resolve the key straight to an org-wide identity —
 * is exactly the bypass invariant 2 has no exception for.
 *
 * Secret handling, all three rules in one place:
 *   1. The token is generated here, returned to the caller ONCE, and never
 *      stored. The database holds sha256 and a display prefix.
 *   2. core/ hashes BEFORE it calls the database, so the token never reaches
 *      the server, its query log, or a slow-query trace (invariant 7).
 *   3. Nothing here logs, and no error carries the token or the hash.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { NotFoundError, UnauthenticatedError, ValidationError } from "./errors.ts";
import { iso, isoOrNull } from "./vocabulary.ts";
import { resolveIdentity, UnknownActorError } from "../db/actor.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

/**
 * Distinguishes a key from a JWT in the same `Authorization: Bearer` slot
 * without guessing from shape. Also makes a leaked key greppable in a
 * customer's codebase, which is what secret scanners key off.
 */
export const KEY_PREFIX = "echo_sk_";
const TOKEN_BYTES = 32;
/** Enough to identify a key in a list, far too little to guess it. */
const DISPLAY_PREFIX_LEN = KEY_PREFIX.length + 6;

export interface ApiKeyRecord {
  id: string;
  name: string;
  token_prefix: string;
  actor_id: string;
  /**
   * May this key reach the assistant (db/0022)? Decided at mint and NOT
   * changeable afterwards — there is deliberately no PATCH on a key.
   *
   * A key's capabilities are a property of the issued credential, like its
   * actor: an integration deployed on a customer's side with a read-only key
   * should not silently gain the ability to spend a model budget because an
   * admin flipped a toggle. Changing what a key may do means revoking it and
   * minting another, which leaves the audit trail saying exactly that — one
   * credential ended, a different one began — instead of a key whose meaning
   * depends on when you looked at it.
   */
  allow_assistant: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface MintedApiKey extends ApiKeyRecord {
  /** Shown once. Not stored, not recoverable, not logged. */
  token: string;
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export function isApiKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

function mintToken(): { token: string; sha256: string; prefix: string } {
  const token = `${KEY_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return {
    token,
    sha256: hashToken(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LEN),
  };
}

/**
 * Token → the identity it acts as.
 *
 * Two steps on purpose. `echo.resolve_api_key` (db/0015) is SECURITY DEFINER
 * because there is genuinely no identity yet — it is one of the only two
 * doors in the product that run before one exists — and it answers exactly
 * one question: which member does this hash name. It returns nothing for a
 * revoked or expired key, or for a member or org that is no longer active,
 * so a disabled employee's integration stops working the moment they are
 * disabled rather than whenever someone remembers to rotate the key.
 *
 * Then `resolveIdentity` re-derives role and status from `app_user` under the
 * normal wall. The resolver's `org_id` is deliberately NOT trusted for that:
 * membership has one source in this codebase, and a second one that agrees
 * today is a second one that can disagree later.
 */
export async function identityFromApiKey(db: Db, token: string): Promise<GatewayIdentity> {
  if (!isApiKey(token)) throw new UnauthenticatedError("not an api key");
  const sha256 = hashToken(token);

  // No identity exists yet — this is the bootstrap moment the function was
  // written for, and the only call in the api process that may run without
  // one. It reads no product table; it maps a hash to a member id.
  //
  // `allow_assistant` comes back FROM THE RESOLUTION (db/0022), and it has to.
  // Reading it afterwards from `echo.api_key` would return zero rows — that
  // table's policies require an active admin, and at this moment there is no
  // identity at all — which reads as `false` and is indistinguishable from a
  // correctly-closed key. A check that cannot fail open is worth less than no
  // check, because it looks like enforcement.
  const rows = await db.withoutIdentity((tx: SqlTx) =>
    tx.unsafe<{ actor_id: string; allow_assistant: boolean }>(
      `select actor_id, allow_assistant from echo.resolve_api_key($1)`,
      [sha256],
    ),
  );
  const row = rows[0];
  // Unknown, revoked, expired, and belonging-to-a-disabled-member are one
  // answer. Distinguishing them would turn this into an oracle for which
  // keys exist.
  if (!row?.actor_id) throw new UnauthenticatedError("invalid api key");

  try {
    const identity = await resolveIdentity(db, row.actor_id);
    // Default closed on anything but an explicit true: a null from an older
    // row, or a column that vanished in a refactor, must not read as "open".
    return { ...identity, viaApiKey: true, allowAssistant: row.allow_assistant === true };
  } catch (error) {
    if (error instanceof UnknownActorError) throw new UnauthenticatedError("invalid api key");
    throw error;
  }
}

/**
 * An identity that arrived through the gateway, carrying the one capability
 * that is a property of the KEY rather than of the member (M17 amendment).
 *
 * Deliberately an extension of `Identity` rather than a field on it: a
 * browser session has no such flag, and `allowAssistant === undefined` for a
 * session must never be read as a restriction. `assistantAllowed()` below is
 * the only place that distinction is interpreted.
 */
export interface GatewayIdentity extends Identity {
  viaApiKey: true;
  allowAssistant: boolean;
}

/**
 * May this caller reach the assistant?
 *
 * A browser session: yes — that is the product. A gateway key: only if an
 * admin deliberately opened it (db/0022, default false). The steward's
 * framing is scope-not-throttle: a leaked or runaway key can read transcripts
 * but cannot drain a model budget unless someone granted it answers. It is
 * not a rate limiter and does not pretend to be one; an enthusiastic
 * authorized integration is the admin's accepted risk.
 */
export function assistantAllowed(identity: Identity): boolean {
  const gateway = identity as Partial<GatewayIdentity>;
  if (gateway.viaApiKey !== true) return true;   // a session, not a key
  return gateway.allowAssistant === true;
}

/**
 * Constant-time compare, exported because the gateway's webhook verification
 * documentation tells integrators to use one and it should be the same
 * function we use.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;   // length is not a secret
  return timingSafeEqual(left, right);
}

const KEY_COLUMNS = `
  id, name, token_prefix, actor_id, allow_assistant, last_used_at,
  expires_at, revoked_at, created_at
`;

const toRecord = (row: Record<string, unknown>): ApiKeyRecord => ({
  id: row.id as string,
  name: row.name as string,
  token_prefix: row.token_prefix as string,
  actor_id: row.actor_id as string,
  // `=== true`, not truthy: a null from a row written before db/0022 must
  // read as closed, and so must anything else unexpected.
  allow_assistant: row.allow_assistant === true,
  last_used_at: isoOrNull(row.last_used_at),
  expires_at: isoOrNull(row.expires_at),
  revoked_at: isoOrNull(row.revoked_at),
  created_at: iso(row.created_at),
});

export function createApiKeysRepo(db: Db) {
  return {
    /**
     * Admin-only by RLS (db/0013 `api_key_admin`), so this does not re-check
     * the role — one rule, in SQL, where it enforces.
     *
     * `actorId` defaults to the creating admin. Naming another member is
     * allowed and is the useful case (a service integration acting as a
     * dedicated account), but it is bounded by the schema: db/0009's
     * composite FK refuses an actor from another org, so an admin cannot mint
     * a key that borrows a stranger's authority even by uuid.
     */
    async create(
      identity: Identity,
      input: {
        name: string;
        actorId?: string | undefined;
        expiresAt?: string | undefined;
        allowAssistant?: boolean | undefined;
      },
    ): Promise<MintedApiKey> {
      const name = (input.name ?? "").trim();
      if (name === "") throw new ValidationError("name is required");
      const actorId = input.actorId ? assertUuid(input.actorId, "actor id") : identity.userId;
      const expiresAt = input.expiresAt ?? null;
      if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) {
        throw new ValidationError("expires_at must be an ISO timestamp");
      }
      // Mint-time only, and closed unless asked for explicitly. `=== true`
      // rather than a default parameter so that a stray "false" string or a
      // missing field can never open it.
      const allowAssistant = input.allowAssistant === true;

      const { token, sha256, prefix } = mintToken();
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `insert into echo.api_key
             (org_id, actor_id, name, token_sha256, token_prefix, expires_at,
              allow_assistant, created_by)
           values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)
           returning ${KEY_COLUMNS}`,
          [identity.orgId, actorId, name, sha256, prefix, expiresAt, allowAssistant, identity.userId],
        ),
      );
      const row = rows[0];
      // RLS refused (not an admin, or an actor outside the org): no row, and
      // the same answer either way.
      if (!row) throw new NotFoundError("could not create key");
      return { ...toRecord(row), token };
    },

    /** Never returns a token or a hash — there is nothing here to leak. */
    async list(identity: Identity): Promise<ApiKeyRecord[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${KEY_COLUMNS} from echo.api_key
            order by revoked_at nulls first, created_at desc`,
        ),
      );
      return rows.map(toRecord);
    },

    /**
     * Revocation is a stamp, not a delete: which key was used, by whom, and
     * when it was withdrawn is exactly the record an incident needs, and
     * `echo_app` holds no DELETE grant anywhere in any case.
     *
     * Re-revoking is a 404 rather than a silent success, so a script that
     * thinks it revoked something can tell that it did.
     */
    async revoke(identity: Identity, keyId: string): Promise<void> {
      const id = assertUuid(keyId, "key id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.api_key
              set revoked_at = now(), revoked_by = $2
            where id = $1 and revoked_at is null
            returning id`,
          [id, identity.userId],
        ),
      );
      if (!rows[0]) throw new NotFoundError("key not found");
    },
  };
}

export type ApiKeysRepo = ReturnType<typeof createApiKeysRepo>;
