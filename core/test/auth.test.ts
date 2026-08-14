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

const SECRET = "test-secret-do-not-use";
const ALICE = "11111111-1111-4111-8111-111111111111";

const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function sign(claims: object, { alg = "HS256", secret = SECRET } = {}) {
  const head = b64({ alg, typ: "JWT" });
  const body = b64(claims);
  const sig = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${head}.${body}`).digest().toString("base64url");
  return `${head}.${body}.${sig}`;
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
  const verify = createVerifier({ secret: SECRET });

  it("accepts a well-formed HS256 token", async () => {
    expect((await verify(sign({ sub: ALICE, exp: future() }))).sub).toBe(ALICE);
  });

  it("rejects algorithm confusion, including alg:none", async () => {
    await expect(verify(sign({ sub: ALICE, exp: future() }, { alg: "none" })))
      .rejects.toThrow(InvalidTokenError);
    await expect(verify(sign({ sub: ALICE, exp: future() }, { alg: "RS256" })))
      .rejects.toThrow(/unsupported algorithm/);
  });

  it("rejects a signature made with the wrong secret", async () => {
    await expect(verify(sign({ sub: ALICE, exp: future() }, { secret: "attacker" })))
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
    const pinned = createVerifier({ secret: SECRET, issuer: "https://echo.example" });
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
    const auth = createAuth({ db: dbReturning(activeRow({ role: "admin" })), jwtSecret: SECRET });
    const identity = await auth.requireActive({
      headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future(), role: "member" })}` },
    });
    expect(identity).toEqual({ userId: ALICE, orgId: "org-a", role: "admin", isActive: true });
  });

  it("rejects a missing or non-bearer header", async () => {
    const auth = createAuth({ db: dbReturning(activeRow()), jwtSecret: SECRET });
    await expect(auth.identify({ headers: {} })).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(auth.identify({ headers: { authorization: "Basic abc" } }))
      .rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects a verified token with no account row", async () => {
    const auth = createAuth({ db: dbReturning([]), jwtSecret: SECRET });
    await expect(auth.identify({ headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` } }))
      .rejects.toThrow(/no account/);
  });

  it("M15: a pending signup identifies but cannot use product routes", async () => {
    const auth = createAuth({ db: dbReturning(activeRow({ status: "pending" })), jwtSecret: SECRET });
    const request = { headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` } };

    // identify() succeeds so the UI can say "waiting for an admin"
    const identity = await auth.identify(request);
    expect(identity.isActive).toBe(false);
    // but every product route is closed
    await expect(auth.requireActive(request)).rejects.toBeInstanceOf(NotActivatedError);
  });

  it("a suspended org closes the door for active members too", async () => {
    const auth = createAuth({ db: dbReturning(activeRow({ org_status: "suspended" })), jwtSecret: SECRET });
    await expect(auth.requireActive({
      headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` },
    })).rejects.toBeInstanceOf(NotActivatedError);
  });

  it("requireAdmin refuses members", async () => {
    const request = { headers: { authorization: `Bearer ${sign({ sub: ALICE, exp: future() })}` } };
    const member = createAuth({ db: dbReturning(activeRow()), jwtSecret: SECRET });
    await expect(member.requireAdmin(request)).rejects.toBeInstanceOf(NotActivatedError);

    const admin = createAuth({ db: dbReturning(activeRow({ role: "admin" })), jwtSecret: SECRET });
    expect((await admin.requireAdmin(request)).role).toBe("admin");
  });
});
