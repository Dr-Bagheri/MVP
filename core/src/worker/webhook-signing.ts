/**
 * Signing a webhook delivery (M17, steward-ratified).
 *
 * ── What the key is, and why it is not the customer's secret ────────────────
 *
 * The api mints `whsec_…`, shows it to the admin ONCE, and stores only
 *
 *     secret_sha256 = HMAC(key = whsec, message = "echo-webhook")
 *
 * The `whsec_` itself never exists at rest on our side. We sign with the
 * derived value; the integrator derives the identical value from the secret
 * they were shown. Both sides can compute it, and nothing unrecoverable is
 * required.
 *
 * The accepted posture, stated rather than implied: **the signing key sits at
 * rest in an org-scoped, API-invisible table row rather than a secret store.**
 * Any scheme where the database holds verification material is forgeable by a
 * database compromise — at that point the signature's premise is already gone.
 * What the derivation buys is that an integrator who reuses their `whsec_`
 * across services (wrong, and common) leaks nothing of ours: we never hold it.
 * Asymmetric signing is the recorded upgrade seam if a customer ever needs
 * signatures that survive a database compromise — hence the version prefix.
 *
 * ── Why the timestamp is inside the signature ───────────────────────────────
 *
 * A signature over the body alone is replayable forever: capture one delivery,
 * resend it at will, and it verifies every time. "Verify the signature" would
 * then give the integrator false comfort — which is worse than no signature,
 * because they would stop looking. So the signed message is `{t}.{body}` and
 * the receiver checks both the MAC and the age.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Tolerance we DOCUMENT for receivers. We do not enforce it — they do. */
export const REPLAY_TOLERANCE_SECONDS = 300;

export const SIGNATURE_HEADER = "echo-signature";
export const EVENT_HEADER = "echo-event";
export const DELIVERY_HEADER = "echo-delivery";

/**
 * `t=<unix seconds>,v1=<hex hmac>` — the timestamp travels in the same header
 * as the signature it is part of, so a receiver cannot verify one without
 * having seen the other.
 *
 * `v1=` is a version prefix, not decoration: when asymmetric signing arrives it
 * becomes `v2=`, receivers accepting both during a rotation, and nobody's
 * integration breaks on the day we change schemes.
 */
export function signDelivery(
  secretSha256: string,
  body: string,
  atSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const signature = createHmac("sha256", secretSha256)
    .update(`${atSeconds}.${body}`)
    .digest("hex");
  return `t=${atSeconds},v1=${signature}`;
}

export interface ParsedSignature {
  t: number;
  v1: string;
}

export function parseSignature(header: string): ParsedSignature | null {
  const parts = new Map(
    header
      .split(",")
      .map((piece) => piece.trim().split("="))
      .filter((kv): kv is [string, string] => kv.length === 2)
      .map(([k, v]) => [k!, v!]),
  );
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return null;
  return { t, v1 };
}

/**
 * The verification an integrator implements, written here so our own tests
 * exercise the documented algorithm rather than a private one. If this
 * function and the docs ever disagree, the docs are wrong and this is the bug.
 */
export function verifyDelivery(
  secretSha256: string,
  body: string,
  header: string,
  options: { nowSeconds?: number; toleranceSeconds?: number } = {},
): boolean {
  const parsed = parseSignature(header);
  if (!parsed) return false;

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? REPLAY_TOLERANCE_SECONDS;
  // Absolute difference: a timestamp far in the FUTURE is as suspicious as an
  // old one, and only checking the past accepts a forged future-dated replay
  // that stays valid indefinitely.
  if (Math.abs(now - parsed.t) > tolerance) return false;

  const expected = createHmac("sha256", secretSha256).update(`${parsed.t}.${body}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(parsed.v1, "hex");
  } catch {
    return false;
  }
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and a thrown comparison is a comparison that did not run.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
