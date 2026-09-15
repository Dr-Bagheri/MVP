/**
 * Auth: token proves WHO, the database decides WHAT (M3), and M15's
 * signup-pending gate. The JWT tests target the failure modes worth owning —
 * algorithm confusion, forged signatures, expiry.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createAuth, NotActivatedError, UnauthenticatedError } from "../src/api/auth.ts";
import { createVerifier, InvalidTokenError } from "../src/api/jwt.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import { makeKey, signES256, startJwksServer } from "./helpers/es256.ts";

/*
 * A REAL ES256 KEY AND A REAL JWKS LISTENER (review F1).
 *
 * These tests used to mint HS256 tokens against a shared secret, which is
 * the branch F1 deletes — and, more to the point, is not what the product
 * issues. Every HS256 fixture passed the whole time because the fixtures and
 * the verifier were built from one assumption, so nothing in the suite could
 * disagree with it.
 *
 * Top-level await, because the ATTACKER key and the listener must both exist
 * before any token is minted below.
 */
const KEY = makeKey("test-key-1");
const ATTACKER = makeKey("test-key-1"); // same kid, different key: a forgery
const jwks = await startJwksServer([KEY]);


const SECRET = "test-secret-do-not-use";
const ALICE = "11111111-1111-4111-8111-111111111111";

const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** a real ES256 token, signed with the key the listener serves */
function sign(claims: object, { key = KEY } = {}) {
  return signES256(key, claims);
}

/**
 * An HS256 token, kept for exactly ONE purpose: proving the verifier REFUSES
 * it. That refusal is the rule now, and a test for it fails loudly if the
 * branch is ever reintroduced.
 */
function signHS256(claims: object, secret = SECRET) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(claims);
  const sig = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${head}.${body}`).digest().toString("base64url");
  return `${head}.${body}.${sig}`;
}

/** a token whose header claims an algorithm we do not verify */
function signWithAlg(alg: string, claims: object) {
  return `${b64({ alg, typ: "JWT" })}.${b64(claims)}.${Buffer.from("x").toString("base64url")}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;

function dbReturning(rows: unknown[]) {
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe =
        (async (sql: string) => (sql.includes("app_user") ? rows : [])) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return createDb({ app: make(), agent: make() });
}

const activeRow = (over: Record<string, unknown> = {}) => [{
  id: ALICE, org_id: "org-a", role: "member",
  status: "active", org_status: "active", ...over,
}];

describe("jwt verification", () => {
  const verify = createVerifier({ jwksUrl: jwks.url });

  it("accepts a well-formed ES256 token", async () => {
    expect((await verify(sign({ sub: ALICE, exp: future() }))).sub).toBe(ALICE);
  });

  it("rejects algorithm confusion, including alg:none", async () => {
    await expect(verify(signWithAlg("none", { sub: ALICE, exp: future() })))
      .rejects.toThrow(InvalidTokenError);
    await expect(verify(signWithAlg("RS256", { sub: ALICE, exp: future() })))
      .rejects.toThrow(/unsupported algorithm/);
    /* THE RULE F1 MADE: an HS256 token is refused by name. Keep this. If the
       shared-secret branch is ever reintroduced, this is what says so. */
    await expect(verify(signHS256({ sub: ALICE, exp: future() })))
      .rejects.toThrow(/unsupported algorithm HS256/);
  });

  it("rejects a signature made with an attacker's key", async () => {
    /* a PROPERLY SIGNED ES256 token from a key the JWKS does not serve, with
       the same kid — the old fixture was base64 with a literal ".badsig",
       which only ever proved base64 parsing */
    await expect(verify(sign({ sub: ALICE, exp: future() }, { key: ATTACKER })))
      .rejects.toThrow(/bad signature/);
  });

  it("rejects tampered claims (signature no longer matches)", async () => {
    const token = sign({ sub: ALICE, exp: future() });
    const [head, , sig] = token.split(".");
    const forged = `${head}.${b64({ sub: "99999999-9999-4999-8999-999999999999", exp: future() })}.${sig}`;
    await expect(verify(forged))
      .rejects.toThrow(/bad signature/);
  });

  it("rejects expired tokens and enforces the issuer when pinned", async () => {
    await expect(verify(sign({ sub: ALICE, exp: Math.floor(Date.now() / 1000) - 120 })))
      .rejects.toThrow(/expired/);
    const pinned = createVerifier({ jwksUrl: jwks.url, issuer: "https://echo.example" });
    await expect(pinned(sign({ sub: ALICE, exp: future(), iss: "https://evil.example" })))
      .rejects.toThrow(/bad issuer/);
  });

  it("rejects malformed tokens without throwing something opaque", async () => {
    await expect(verify("not.a.jwt"))
      .rejects.toThrow(InvalidTokenError);
    await expect(verify("onlyonepart"))
      .rejects.toThrow(/malformed/);
  });
});

describe("auth — token proves who, the DB decides what", () => {
  it("identifies a caller and takes membership from the database", async () => {
    // token claims member; DB says admin — the DB wins
    const auth = createAuth({ db: dbReturning(activeRow({ role: "admin" })), jwksUrl: jwks.url });
    const identity = await auth.requireActive({
      headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future(), role: "member" })}` },
    });
    expect(identity).toEqual({ userId: ALICE, orgId: "org-a", role: "admin", isActive: true });
  });

  it("rejects a missing or non-bearer header", async () => {
    const auth = createAuth({ db: dbReturning(activeRow()), jwksUrl: jwks.url });
    await expect(auth.identify({ headers: {} })).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(auth.identify({ headers: { authorization: "Basic abc" } }))
      .rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects a verified token with no account row", async () => {
    const auth = createAuth({ db: dbReturning([]), jwksUrl: jwks.url });
    await expect(auth.identify({ headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` } }))
      .rejects.toThrow(/no account/);
  });

  it("M15: a pending signup identifies but cannot use product routes", async () => {
    const auth = createAuth({ db: dbReturning(activeRow({ status: "pending" })), jwksUrl: jwks.url });
    const request = { headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` } };

    // identify() succeeds so the UI can say "waiting for an admin"
    const identity = await auth.identify(request);
    expect(identity.isActive).toBe(false);
    // but every product route is closed
    await expect(auth.requireActive(request)).rejects.toBeInstanceOf(NotActivatedError);
  });

  it("a suspended org closes the door for active members too", async () => {
    const auth = createAuth({ db: dbReturning(activeRow({ org_status: "suspended" })), jwksUrl: jwks.url });
    await expect(auth.requireActive({
      headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` },
    })).rejects.toBeInstanceOf(NotActivatedError);
  });

  it("requireAdmin refuses members", async () => {
    const request = { headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` } };
    const member = createAuth({ db: dbReturning(activeRow()), jwksUrl: jwks.url });
    await expect(member.requireAdmin(request)).rejects.toBeInstanceOf(NotActivatedError);

    const admin = createAuth({ db: dbReturning(activeRow({ role: "admin" })), jwksUrl: jwks.url });
    expect((await admin.requireAdmin(request)).role).toBe("admin");
  });

  it("platform-root is a separate database check and can recover a suspended organization", async () => {
    const request = { headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` } };
    const root = createAuth({
      db: dbReturning(activeRow({ org_status: "suspended" })),
      jwksUrl: jwks.url,
      // The real callback runs echo.actor_is_platform_root() under RLS. A
      // function here keeps this unit test about the auth boundary rather than
      // pretending a hand-written row is the policy composition.
      isPlatformRoot: async () => true,
    });
    await expect(root.requirePlatformRoot(request)).resolves.toMatchObject({ userId: ALICE });

    const nonRoot = createAuth({
      db: dbReturning(activeRow()), jwksUrl: jwks.url, isPlatformRoot: async () => false,
    });
    await expect(nonRoot.requirePlatformRoot(request)).rejects.toBeInstanceOf(NotActivatedError);
  });
});
