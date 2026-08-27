import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CAPABILITIES, createCapabilitiesRepo } from "../src/api/capabilities.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * MEMBER PRIVILEGES (db/0101). This is an authorization surface, so the
 * suite walks the whole matrix rather than the happy path — the M11 lesson:
 * asserting the PRIVILEGED path and the REFUSED path leaves the ORDINARY
 * path unproven, and the ordinary path is the product.
 *
 * The four properties that matter, in order of how badly each would hurt:
 *  1. a restriction actually REFUSES (or the screen is theatre);
 *  2. absence means ALLOWED (or shipping the table locks every org out);
 *  3. a member-scoped restriction does not bind the admin who set it
 *     (or an admin disarms themselves by restricting members);
 *  4. an admin cannot bind admins, and nobody can bind the owner
 *     (or the exit closes behind whoever walks through it — D27).
 */

const who = (role: string): Identity => ({
  userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  orgId: "99999999-8888-4777-8666-555555555555",
  role,
  isActive: true,
} as unknown as Identity);

function fakeDb(rows: { role: string; capability: string; allowed: boolean }[]) {
  const log: { sql: string; params: unknown[] }[] = [];
  const tx = {
    unsafe: (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (!sql.includes("select")) return Promise.resolve([]);
      return Promise.resolve(
        rows.filter((r) =>
          (params[1] === undefined || r.role === params[1])
          && (params[2] === undefined || r.capability === params[2])),
      );
    },
  } as unknown as SqlTx;
  return {
    db: { withIdentity: (_i: Identity, fn: (tx: SqlTx) => unknown) => fn(tx) } as unknown as Db,
    log,
  };
}

describe("what a capability decides", () => {
  it("a written NO refuses the action", () => {
    const { db } = fakeDb([{ role: "member", capability: "records.delete", allowed: false }]);
    return expect(createCapabilitiesRepo(db).require(who("member"), "records.delete"))
      .rejects.toThrow();
  });

  it("ABSENT means allowed — an org that has decided nothing loses nothing", async () => {
    // the property that makes this table safe to ship: arriving changes
    // nothing until somebody writes a decision
    const { db } = fakeDb([]);
    await expect(createCapabilitiesRepo(db).require(who("member"), "records.delete"))
      .resolves.toBeUndefined();
  });

  it("a written YES is allowed, and is kept rather than deleted", async () => {
    const { db } = fakeDb([{ role: "member", capability: "records.delete", allowed: true }]);
    await expect(createCapabilitiesRepo(db).require(who("member"), "records.delete"))
      .resolves.toBeUndefined();
  });

  it("restricting MEMBERS does not bind the admin who did it", async () => {
    /* the disarm-yourself case: if the check keyed off the capability alone
       instead of its role scope, an admin taking deletion away from members
       would take it away from themselves in the same press */
    const { db } = fakeDb([{ role: "member", capability: "records.delete", allowed: false }]);
    await expect(createCapabilitiesRepo(db).require(who("admin"), "records.delete"))
      .resolves.toBeUndefined();
  });

  it("an ADMIN restriction does not bind a member", async () => {
    // the mirror: admin-scoped capabilities are about admins, and a member
    // never had the action to lose
    const { db } = fakeDb([{ role: "admin", capability: "members.manage", allowed: false }]);
    await expect(createCapabilitiesRepo(db).require(who("member"), "members.manage"))
      .resolves.toBeUndefined();
  });

  it("an admin restriction DOES bind an admin", () => {
    const { db } = fakeDb([{ role: "admin", capability: "members.manage", allowed: false }]);
    return expect(createCapabilitiesRepo(db).require(who("admin"), "members.manage"))
      .rejects.toThrow();
  });

  it("the OWNER is bound by nothing — the exit always exists", async () => {
    /* D27. 0101 refuses to STORE an owner row; this is the same rule in the
       api, so a hand-written row could not close the last door either */
    const { db } = fakeDb([
      { role: "admin", capability: "members.manage", allowed: false },
      { role: "member", capability: "records.delete", allowed: false },
    ]);
    const repo = createCapabilitiesRepo(db);
    await expect(repo.require(who("owner"), "members.manage")).resolves.toBeUndefined();
    await expect(repo.require(who("owner"), "records.delete")).resolves.toBeUndefined();
  });

  it("an unknown key restricts nothing — a typo must not become a lock", async () => {
    const { db } = fakeDb([{ role: "member", capability: "recrds.delete", allowed: false }]);
    await expect(createCapabilitiesRepo(db).require(who("member"), "records.delete"))
      .resolves.toBeUndefined();
  });
});

describe("who may write a decision", () => {
  it("an admin may bind members", async () => {
    const { db, log } = fakeDb([]);
    await createCapabilitiesRepo(db).set(who("admin"),
      { role: "member", capability: "records.delete", allowed: false });
    expect(log.some((q) => q.sql.includes("insert into echo.role_capability"))).toBe(true);
  });

  it("an admin may NOT bind admins — the exit stays open", () => {
    const { db } = fakeDb([]);
    return expect(createCapabilitiesRepo(db).set(who("admin"),
      { role: "admin", capability: "members.manage", allowed: false })).rejects.toThrow();
  });

  it("the owner may bind admins", async () => {
    const { db, log } = fakeDb([]);
    await createCapabilitiesRepo(db).set(who("owner"),
      { role: "admin", capability: "members.manage", allowed: false });
    expect(log.some((q) => q.sql.includes("insert into echo.role_capability"))).toBe(true);
  });

  it("a capability cannot be written under the other role", () => {
    // records.delete is a MEMBER capability; storing it as an admin row
    // would create a decision no enforcement point ever reads
    const { db } = fakeDb([]);
    return expect(createCapabilitiesRepo(db).set(who("owner"),
      { role: "admin", capability: "records.delete", allowed: false })).rejects.toThrow();
  });

  it("an unknown capability is refused rather than stored", () => {
    const { db } = fakeDb([]);
    return expect(createCapabilitiesRepo(db).set(who("owner"),
      { role: "member", capability: "invented.thing", allowed: false })).rejects.toThrow();
  });
});

describe("the vocabulary is not decoration", () => {
  it("every capability names a route that ENFORCES it", () => {
    /* the rule that keeps this surface honest: a switch with no guard
       behind it reads as a promise on screen and does nothing on press.
       Checked against the server's source, so adding a capability without
       wiring it fails here rather than in production. */
    const server = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
    const unwired = CAPABILITIES
      .map((c) => c.key)
      .filter((key) => !server.includes(`capabilities.require(identity, "${key}")`));
    expect(unwired).toEqual([]);
  });

  it("only member and admin are restrictable — never the owner", () => {
    expect(CAPABILITIES.every((c) => c.role === "member" || c.role === "admin")).toBe(true);
  });
});
