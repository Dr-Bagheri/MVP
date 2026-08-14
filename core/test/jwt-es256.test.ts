/**
 * ES256 / JWKS verification (the live sign-in failure).
 *
 * The project issues asymmetric-signed tokens; this file used to pin HS256,
 * so every real token died at `unsupported algorithm`. **Every HS256 test
 * token passed the whole time** — fixtures and verifier were built from one
 * assumption, so nothing in the suite could disagree with it.
 *
 * These tests exist so that stops being true: they mint REAL ES256 tokens
 * with a generated P-256 key and serve a REAL JWKS document, so the crypto
 * path is exercised rather than described. A fake that returned "valid" would
 * reproduce exactly the blindness that caused the outage.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import { describe, expect, it, vi, afterEach } from "vitest";

import { createVerifier, InvalidTokenError } from "../src/api/jwt.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const future = () => Math.floor(Date.now() / 1000) + 600;
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A P-256 keypair, exported as JWK the way a JWKS endpoint serves it. */
function makeKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  return { privateKey, jwk };
}

/**
 * Sign a real ES256 JWT. `ieee-p1363` is not a detail — a JWS signature is the
 * raw r‖s pair, and node's DEFAULT is DER. Getting this wrong on either side
 * produces "bad signature" for every valid token.
 */
function signES256(privateKey: ReturnType<typeof createPrivateKey>, kid: string, claims: object) {
  const header = b64({ alg: "ES256", typ: "JWT", kid });
  const payload = b64(claims);
  const signature = cryptoSign("sha256", Buffer.from(`${header}.${payload}`),
    { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function serveJwks(keys: object[]) {
  const calls = { count: 0 };
  vi.stubGlobal("fetch", async () => {
    calls.count += 1;
    return { ok: true, json: async () => ({ keys }) } as unknown as Response;
  });
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("a real ES256 token verifies", () => {
  it("accepts one signed by a key in the JWKS", async () => {
    const { privateKey, jwk } = makeKey("kid-1");
    serveJwks([jwk]);
    const verify = createVerifier({ jwksUrl: "https://example.test/jwks.json" });
    const claims = await verify(signES256(privateKey, "kid-1", { sub: ALICE, exp: future() }));
    expect(claims.sub).toBe(ALICE);
  });

  it("rejects one signed by a key that is NOT in the JWKS", async () => {
    // The actual security property: possessing *a* P-256 key must not be
    // enough — it has to be one the project published.
    const served = makeKey("kid-1");
    const attacker = makeKey("kid-1");   // same kid, different key
    serveJwks([served.jwk]);
    const verify = createVerifier({ jwksUrl: "https://example.test/jwks.json" });
    await expect(verify(signES256(attacker.privateKey, "kid-1", { sub: ALICE, exp: future() })))
      .rejects.toThrow(/bad signature/);
  });

  it("names the kid when no key matches, rather than blaming the signature", async () => {
    // "bad signature" would send someone hunting a crypto bug when the truth
    // is "we have never seen this key".
    const { privateKey } = makeKey("kid-unknown");
    serveJwks([makeKey("kid-1").jwk]);
    const verify = createVerifier({ jwksUrl: "https://example.test/jwks.json" });
    await expect(verify(signES256(privateKey, "kid-unknown", { sub: ALICE, exp: future() })))
      .rejects.toThrow(/no signing key for kid kid-unknown/);
  });

  it("still enforces expiry on the ES256 path", async () => {
    const { privateKey, jwk } = makeKey("kid-1");
    serveJwks([jwk]);
    const verify = createVerifier({ jwksUrl: "https://example.test/jwks.json" });
    await expect(verify(signES256(privateKey, "kid-1",
      { sub: ALICE, exp: Math.floor(Date.now() / 1000) - 120 })))
      .rejects.toThrow(/expired/);
  });
});

describe("key rotation", () => {
  it("refetches on a kid miss instead of failing until the TTL lapses", async () => {
    // A rotation means the first token arrives signed by a key we have never
    // seen. With only a TTL, that is up to ttlMs of everyone locked out.
    const oldKey = makeKey("kid-old");
    const newKey = makeKey("kid-new");
    let served = [oldKey.jwk];
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return { ok: true, json: async () => ({ keys: served }) } as unknown as Response;
    });

    const verify = createVerifier({ jwksUrl: "https://example.test/jwks.json", jwksTtlMs: 600_000 });
    await verify(signES256(oldKey.privateKey, "kid-old", { sub: ALICE, exp: future() }));
    expect(fetches).toBe(1);

    served = [newKey.jwk];                       // the project rotates
    await new Promise((r) => setTimeout(r, 1100)); // past the refetch guard
    const claims = await verify(signES256(newKey.privateKey, "kid-new", { sub: ALICE, exp: future() }));
    expect(claims.sub).toBe(ALICE);
    expect(fetches).toBe(2);                     // refetched on the miss, TTL untouched
  });
});

describe("algorithm confusion is still refused on both branches", () => {
  it.each(["none", "RS256", "HS512", "ES384"])("refuses alg %s and names it", async (alg) => {
    const { jwk } = makeKey("kid-1");
    serveJwks([jwk]);
    const verify = createVerifier({ secret: "s", jwksUrl: "https://example.test/jwks.json" });
    const token = `${b64({ alg, typ: "JWT", kid: "kid-1" })}.${b64({ sub: ALICE })}.x`;
    await expect(verify(token)).rejects.toThrow(new RegExp(`unsupported algorithm ${alg}`));
  });

  it("will not verify an ES256 token with the shared secret", async () => {
    // The confusion attack in its real shape: an HMAC forged with a key the
    // attacker knows, wearing an asymmetric alg — or vice versa. Each branch
    // uses a key type the other cannot.
    const verify = createVerifier({ secret: "shared-secret" });
    const { privateKey } = makeKey("kid-1");
    await expect(verify(signES256(privateKey, "kid-1", { sub: ALICE, exp: future() })))
      .rejects.toThrow(/no jwks url configured/);
  });

  it("ignores non-EC keys in the JWKS", async () => {
    // An RSA key in the document must not become a candidate: the ES256
    // branch would then have a key to try for a token claiming a different
    // family, which is one step further than it should ever get.
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaJwk = { ...publicKey.export({ format: "jwk" }), kid: "kid-rsa", alg: "RS256" };
    serveJwks([rsaJwk]);
    const verify = createVerifier({ jwksUrl: "https://example.test/jwks.json" });
    const token = `${b64({ alg: "ES256", typ: "JWT", kid: "kid-rsa" })}.${b64({ sub: ALICE })}.x`;
    await expect(verify(token)).rejects.toThrow(/jwks contained no usable ES256 keys/);
  });
});

describe("configuration mistakes fail loudly", () => {
  it("refuses to build a verifier with neither secret nor jwks url", () => {
    expect(() => createVerifier({})).toThrow(/secret \(HS256\) or a jwks url \(ES256\)/);
  });

  it("says so when an ES256 token arrives at an HS256-only instance", async () => {
    // The exact production failure, now with a message that names the cause
    // instead of "unsupported algorithm".
    const verify = createVerifier({ secret: "only-hs256" });
    const { privateKey } = makeKey("kid-1");
    await expect(verify(signES256(privateKey, "kid-1", { sub: ALICE, exp: future() })))
      .rejects.toThrow(/asymmetric signing keys.*no jwks url/);
  });
});

// Referenced so the import is honest about what this file constructs.
void createPublicKey; void createPrivateKey; void InvalidTokenError;
