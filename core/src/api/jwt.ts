/**
 * Minimal HS256 JWT verification (Supabase issues these).
 *
 * Hand-rolled rather than pulled in as a dependency because the surface we
 * need is small and the failure modes are the ones worth owning explicitly:
 * algorithm confusion, unsigned tokens, expiry, and timing-safe comparison.
 * If we ever need RS256/JWKS this file is the single place that changes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifiedClaims {
  sub: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  [claim: string]: unknown;
}

export interface VerifierOptions {
  secret: string;
  issuer?: string | undefined;
  /** Tolerance for clock skew, seconds. */
  leewaySeconds?: number;
}

export class InvalidTokenError extends Error {}

function base64UrlDecode(part: string): Buffer {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
}

export function createVerifier({ secret, issuer, leewaySeconds = 30 }: VerifierOptions) {
  if (!secret) throw new Error("jwt secret is required");
  const key = Buffer.from(secret, "utf8");

  return function verify(token: string): VerifiedClaims {
    const parts = token.split(".");
    if (parts.length !== 3) throw new InvalidTokenError("malformed token");
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    let header: { alg?: string; typ?: string };
    let claims: VerifiedClaims;
    try {
      header = JSON.parse(base64UrlDecode(headerPart).toString("utf8"));
      claims = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
    } catch {
      throw new InvalidTokenError("malformed token");
    }

    // Algorithm confusion: pin HS256. "none" and RS* must never be accepted
    // just because the token says so.
    if (header.alg !== "HS256") throw new InvalidTokenError("unsupported algorithm");

    const expected = createHmac("sha256", key)
      .update(`${headerPart}.${payloadPart}`)
      .digest();
    const provided = base64UrlDecode(signaturePart);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new InvalidTokenError("bad signature");
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === "number" && now > claims.exp + leewaySeconds) {
      throw new InvalidTokenError("token expired");
    }
    if (typeof claims.nbf === "number" && now + leewaySeconds < (claims.nbf as number)) {
      throw new InvalidTokenError("token not yet valid");
    }
    if (issuer && claims.iss !== issuer) throw new InvalidTokenError("bad issuer");
    if (typeof claims.sub !== "string" || !claims.sub) {
      throw new InvalidTokenError("no subject");
    }
    return claims;
  };
}
