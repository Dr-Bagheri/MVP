/**
 * Minimal HS256 JWT verification (Supabase issues these).
 *
 * Hand-rolled rather than pulled in as a dependency because the surface we
 * need is small and the failure modes are the ones worth owning explicitly:
 * algorithm confusion, unsigned tokens, expiry, and timing-safe comparison.
 *
 * ── The prediction, and the day it came true ────────────────────────────────
 *
 * This file used to verify HS256 only, and its own comment warned: Supabase is
 * migrating projects to asymmetric signing keys, and a project switched to
 * those "issues tokens this file cannot verify — the symptom is every user
 * 401ing at once, with no code change to blame".
 *
 * That is exactly what happened, on the first real sign-in this product ever
 * had. The project issues **ES256** with a `kid`; this pinned HS256; every
 * live token died at `unsupported algorithm` and the user saw
 * «نشست برقرار نشد».
 *
 * **Every HS256 test token I minted passed the whole time.** They had to —
 * the fixtures and the verifier were built from the same assumption, so no
 * test could disagree with it. The first token this codebase did not
 * manufacture was the only thing that could expose it, which is the sharpest
 * case of the day's pattern: a thing that is wrong and unobservable because
 * nothing real ever touched it.
 *
 * Both branches now exist. HS256 stays for the shared-secret path (the test
 * suite mints those, and a project on legacy signing still uses it); ES256
 * verifies against the project's JWKS, selected by `kid`.
 */
import crypto, { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifiedClaims {
  sub: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  [claim: string]: unknown;
}

export interface VerifierOptions {
  /**
   * Shared secret for the HS256 branch. Optional now — a project on
   * asymmetric keys has none, and the test suite mints its own.
   */
  secret?: string | undefined;
  /**
   * The project's JWKS endpoint, enabling the ES256 branch.
   * `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`
   */
  jwksUrl?: string | undefined;
  /** How long a fetched key set is trusted before a refresh. */
  jwksTtlMs?: number | undefined;
  issuer?: string | undefined;
  /**
   * Expected `aud`. Supabase issues `"authenticated"` for a signed-in user
   * and `"anon"` for the anonymous key — so pinning this is what stops an
   * anon-key token being accepted as a person.
   *
   * Implemented because the surrounding comment promised audience pinning and
   * only issuer was checked (steward nit): a doc-comment that describes a
   * control nobody wrote is worse than silence, because a reviewer reads it
   * and moves on.
   */
  audience?: string | undefined;
  /** Tolerance for clock skew, seconds. */
  leewaySeconds?: number;
}

export class InvalidTokenError extends Error {}

function base64UrlDecode(part: string): Buffer {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
}

/**
 * The project's public signing keys, cached.
 *
 * Two refresh triggers, and the second is the one that matters: a TTL, and a
 * **kid miss**. Supabase rotates signing keys, and after a rotation the first
 * token arrives signed by a key we have never seen — with only a TTL that is
 * up to `ttlMs` of every user failing to sign in. A kid miss is the signal
 * that our copy is stale, so it refetches once and tries again.
 *
 * The single-flight promise matters for the same reason: on a rotation every
 * in-flight request misses at once, and without it they would each open their
 * own fetch to the auth server at the exact moment it is least welcome.
 */
function createJwksCache(url: string, ttlMs: number) {
  let keys = new Map<string, crypto.KeyObject>();
  let fetchedAt = 0;
  let inFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new InvalidTokenError(`jwks unavailable (${response.status})`);
      const body = await response.json() as { keys?: unknown[] };
      const next = new Map<string, crypto.KeyObject>();
      for (const jwk of body.keys ?? []) {
        const entry = jwk as { kid?: string; kty?: string; alg?: string; crv?: string };
        if (typeof entry.kid !== "string") continue;
        // Only EC P-256 keys are usable by the ES256 branch. Importing an RSA
        // key here would let a token claiming RS256 find a key and get one
        // step further than it should.
        if (entry.kty !== "EC" || entry.crv !== "P-256") continue;
        try {
          next.set(entry.kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" }));
        } catch {
          // A key we cannot import is a key we cannot verify with. Skipping it
          // beats failing the whole set, or the next rotation takes sign-in
          // down for one malformed entry.
        }
      }
      if (next.size === 0) throw new InvalidTokenError("jwks contained no usable ES256 keys");
      keys = next;
      fetchedAt = Date.now();
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    async get(kid: string): Promise<crypto.KeyObject | undefined> {
      if (keys.size === 0 || Date.now() - fetchedAt > ttlMs) await refresh();
      const hit = keys.get(kid);
      if (hit) return hit;
      // Miss on a cache we did not just build: assume rotation, refetch once.
      if (Date.now() - fetchedAt > 1_000) {
        await refresh();
        return keys.get(kid);
      }
      return undefined;
    },
  };
}

export function createVerifier({
  secret, issuer, audience, leewaySeconds = 30, jwksUrl, jwksTtlMs = 10 * 60_000,
}: VerifierOptions) {
  if (!secret && !jwksUrl) {
    throw new Error("jwt verification needs a secret (HS256) or a jwks url (ES256)");
  }
  const key = secret ? Buffer.from(secret, "utf8") : undefined;
  const jwks = jwksUrl ? createJwksCache(jwksUrl, jwksTtlMs) : undefined;

  return async function verify(token: string): Promise<VerifiedClaims> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new InvalidTokenError("malformed token");
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    let header: { alg?: string; typ?: string; kid?: string };
    let claims: VerifiedClaims;
    try {
      header = JSON.parse(base64UrlDecode(headerPart).toString("utf8"));
      claims = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
    } catch {
      throw new InvalidTokenError("malformed token");
    }

    const signed = `${headerPart}.${payloadPart}`;
    const provided = base64UrlDecode(signaturePart);

    /**
     * Two branches, each pinned to ONE algorithm. `none` and RS* still reach
     * neither: the fall-through below refuses anything that is not exactly
     * HS256 or ES256, and each branch verifies with a key type that cannot be
     * used by the other. Widening this to "any alg the token names" is the
     * algorithm-confusion attack, and it is why the check is a pin per branch
     * rather than a lookup keyed on the header.
     */
    if (header.alg === "ES256") {
      if (!jwks) {
        throw new InvalidTokenError(
          "token is ES256 (asymmetric signing keys) but this instance has no jwks url configured");
      }
      if (typeof header.kid !== "string" || !header.kid) {
        throw new InvalidTokenError("ES256 token has no kid");
      }
      const publicKey = await jwks.get(header.kid);
      if (!publicKey) {
        // Named loudly: "bad signature" would send someone hunting a crypto
        // problem when the real answer is "we have never seen this key".
        throw new InvalidTokenError(`no signing key for kid ${header.kid}`);
      }
      /**
       * `dsaEncoding: "ieee-p1363"` is the whole trap.
       *
       * A JWS ES256 signature is the raw 64-byte r‖s pair. Node's default for
       * EC verification is DER, and a DER parse of a raw pair simply fails —
       * so without this line EVERY valid token is rejected as a bad
       * signature, which looks exactly like a key mismatch and is the single
       * most likely way to "finish" this work while it does not function.
       */
      const ok = crypto.verify(
        "sha256", Buffer.from(signed),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        provided,
      );
      if (!ok) throw new InvalidTokenError("bad signature");
    } else if (header.alg === "HS256") {
      if (!key) {
        throw new InvalidTokenError("token is HS256 but this instance has no shared secret");
      }
      const expected = createHmac("sha256", key).update(signed).digest();
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        throw new InvalidTokenError("bad signature");
      }
    } else {
      // The diagnosis names what arrived, because "unsupported algorithm" with
      // no value is what cost this project a live sign-in: the token said
      // ES256, the file pinned HS256, and the message said neither.
      throw new InvalidTokenError(
        `unsupported algorithm ${header.alg ?? "(none)"}${header.kid ? ` (kid ${header.kid})` : ""}`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === "number" && now > claims.exp + leewaySeconds) {
      throw new InvalidTokenError("token expired");
    }
    if (typeof claims.nbf === "number" && now + leewaySeconds < (claims.nbf as number)) {
      throw new InvalidTokenError("token not yet valid");
    }
    if (issuer && claims.iss !== issuer) throw new InvalidTokenError("bad issuer");
    if (audience) {
      // `aud` may be a string or an array — a token carrying an array that
      // merely CONTAINS our audience is valid, and treating the array case as
      // a mismatch would reject legitimate tokens.
      const claimed = claims.aud;
      const matches = Array.isArray(claimed) ? claimed.includes(audience) : claimed === audience;
      if (!matches) throw new InvalidTokenError("bad audience");
    }
    if (typeof claims.sub !== "string" || !claims.sub) {
      throw new InvalidTokenError("no subject");
    }
    return claims;
  };
}
