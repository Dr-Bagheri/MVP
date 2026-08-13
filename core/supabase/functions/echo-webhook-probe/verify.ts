// The verification an INTEGRATOR implements, written from the documented
// algorithm against WebCrypto only.
//
// Deliberately NOT an import of core/'s `verifyDelivery`. Verifying our
// signature with our own verifier proves that our signer agrees with itself,
// which is a tautology; what needs proving is that a stranger following the
// written spec can validate what we send. So this is a second, independent
// implementation — and because it uses only WebCrypto and no Deno APIs, the
// same file runs in the Edge Function and under vitest, which means the
// agreement is checked before anything is ever deployed.
//
// If this file and the published docs disagree, the docs are wrong and this is
// the bug.

/** Documented tolerance. The receiver enforces it; the sender only states it. */
export const TOLERANCE_SECONDS = 300;

export function parseSignature(header: string): { t: number; v1: string } | null {
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const [k, v] = piece.trim().split("=");
    if (k && v) parts.set(k, v);
  }
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return null;
  return { t, v1 };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant time, and length-checked first — a length leak is still a leak. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export type VerifyResult = "ok" | "malformed" | "stale" | "mismatch";

/**
 * @param secretSha256 the stored hex digest, used as the HMAC key BY ITS TEXT.
 *   Not the bytes it decodes to — `createHmac("sha256", secretSha256)` on the
 *   sending side keys on the string's UTF-8 bytes, and decoding the hex here
 *   would fail every valid delivery while looking like a signing bug.
 */
export async function verifyDelivery(
  secretSha256: string,
  rawBody: string,
  header: string,
  options: { nowSeconds?: number; toleranceSeconds?: number } = {},
): Promise<VerifyResult> {
  const parsed = parseSignature(header);
  if (!parsed) return "malformed";

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? TOLERANCE_SECONDS;
  // Absolute difference: a far-FUTURE timestamp is as suspicious as an old
  // one, and accepting it leaves a forged delivery valid indefinitely.
  if (Math.abs(now - parsed.t) > tolerance) return "stale";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretSha256),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parsed.t}.${rawBody}`)),
  );

  const actual = hexToBytes(parsed.v1);
  if (!actual || !equalBytes(actual, expected)) return "mismatch";
  return "ok";
}
