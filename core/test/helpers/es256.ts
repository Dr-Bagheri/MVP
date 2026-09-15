/**
 * ES256 test tokens, and a REAL JWKS listener (review F1).
 *
 * Lifted out of `jwt-es256.test.ts` so every suite mints tokens the way the
 * product does. Before F1, `jwt-es256.test.ts` was the only file in
 * `core/test` that touched ES256 at all, and it tested `createVerifier` in
 * isolation — so nothing drove a production-shaped token through the
 * authorization rules (pending signup, suspended org, `requireAdmin`,
 * platform-root). The suite could not have disagreed with the verifier.
 *
 * ── WHY A REAL SOCKET AND NOT `vi.stubGlobal("fetch", …)` ──────────────────
 *
 * Two independent reasons, and the second is the one that decides it:
 *
 *  1. `api-boot.test.ts` SPAWNS A REAL PROCESS. A stub installed in this
 *     process cannot reach it, so a stubbed JWKS would leave the one test
 *     that runs the product under its production runtime unable to verify a
 *     token at all.
 *  2. Routes in `server-routes.test.ts` — member password, uploads, ml —
 *     call `fetch` THEMSELVES. A global stub serving JWKS would quietly
 *     change unrelated route behaviour, which is a fake deciding the outcome
 *     of a test that is about something else.
 *
 * One listener serves both files and has no collateral.
 */
import { createServer, type Server } from "node:http";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

export interface TestKey {
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
  kid: string;
}

/** A P-256 keypair, exported as JWK the way a JWKS endpoint serves it. */
export function makeKey(kid: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = {
    ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
    kid,
    alg: "ES256",
    use: "sig",
  };
  return { privateKey, jwk, kid };
}

/**
 * Sign a real ES256 JWT.
 *
 * `ieee-p1363` is not a detail — a JWS signature is the raw r‖s pair and
 * node's DEFAULT is DER. Getting it wrong on either side produces "bad
 * signature" for every valid token, which is exactly the shape of the live
 * outage this file exists because of.
 */
export function signES256(key: TestKey, claims: object): string {
  const header = b64({ alg: "ES256", typ: "JWT", kid: key.kid });
  const payload = b64(claims);
  const signature = cryptoSign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { key: key.privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export interface JwksServer {
  url: string;
  /** how many times the document was actually fetched over the socket */
  hits: () => number;
  close: () => Promise<void>;
}

/**
 * Serve a JWKS document on a real loopback socket.
 *
 * Synchronous start (`listen` then await) so a caller can mint tokens at
 * MODULE SCOPE: `server-routes.test.ts` builds its authorization header at
 * import time, before any `beforeAll` runs, so anything created in a hook is
 * still `undefined` when the header is composed.
 */
export async function startJwksServer(keys: TestKey[]): Promise<JwksServer> {
  let count = 0;
  const server: Server = createServer((_req, res) => {
    count += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: keys.map((k) => k.jwk) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/jwks.json`,
    hits: () => count,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
