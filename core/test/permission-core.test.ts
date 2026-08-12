/**
 * Invariant 2 — no DB access without an identity — asserted structurally.
 * A fake SqlClient records exactly what would have been sent, so these tests
 * prove the SET LOCAL discipline without needing Postgres. (RLS itself is
 * Backend 3's SQL suite; this is the app half of M3.)
 */
import { describe, expect, it } from "vitest";

import { identityForJob, OwnerMismatchError, resolveIdentity, UnknownActorError } from "../src/db/actor.ts";
import {
  assertAgentRole, assertUuid, createDb, MissingIdentityError, WrongRoleError,
  type SqlClient, type SqlTx,
} from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CALL = "33333333-3333-4333-8333-333333333333";

const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

/** Records every statement, per pool, so we can assert on the wire. */
function fakePools(rowsFor: (sql: string, params?: unknown[]) => unknown[] = () => []) {
  const log: { pool: string; sql: string; params?: unknown[] | undefined }[] = [];
  const make = (pool: string): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ pool, sql, params });
        return rowsFor(sql, params) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { log, pools: { app: make("app"), agent: make("agent") } };
}

describe("connection factory — identity or no handle (invariant 2)", () => {
  it("refuses to open a handle with no identity", async () => {
    const { pools, log } = fakePools();
    const db = createDb(pools);
    await expect(db.withIdentity(null, async () => "never")).rejects.toBeInstanceOf(MissingIdentityError);
    await expect(db.withIdentity({ ...IDENTITY, userId: "" }, async () => "never"))
      .rejects.toBeInstanceOf(MissingIdentityError);
    expect(log).toHaveLength(0); // nothing reached the database
  });

  it("sets the actor with SET LOCAL, never SET (pooled connections)", async () => {
    const { pools, log } = fakePools();
    await createDb(pools).withIdentity(IDENTITY, async (tx) => {
      await tx.unsafe("select 1");
      return null;
    });
    expect(log[0]!.sql).toBe(`set local echo.actor_id = '${ALICE}'`);
    expect(log[0]!.sql.toLowerCase()).toContain("set local");
    expect(log[0]!.sql.toLowerCase()).not.toMatch(/^\s*set\s+echo/); // never bare SET
    // the identity is applied BEFORE the caller's query, in the same tx
    expect(log[1]!.sql).toBe("select 1");
  });

  it("rejects a non-UUID actor rather than interpolating it", async () => {
    const { pools, log } = fakePools();
    const db = createDb(pools);
    // SET cannot take a bound parameter, so the guard is the whole defence
    await expect(db.withIdentity(
      { ...IDENTITY, userId: "'; drop schema echo cascade; --" },
      async () => null,
    )).rejects.toThrow(/invalid actor id/);
    expect(log).toHaveLength(0);
    expect(() => assertUuid("not-a-uuid")).toThrow();
    expect(assertUuid(ALICE)).toBe(ALICE);
  });

  it("routes agent work to the echo_agent pool, app work to echo_app", async () => {
    const { pools, log } = fakePools();
    const db = createDb(pools);
    await db.withIdentity(IDENTITY, async () => null);
    await db.withIdentity(IDENTITY, async () => null, { role: "agent" });
    expect(log[0]!.pool).toBe("app");
    expect(log[1]!.pool).toBe("agent");
  });

  it("assertAgentRole catches agent tools wired to the app pool", () => {
    expect(() => assertAgentRole("agent")).not.toThrow();
    expect(() => assertAgentRole("app")).toThrow(WrongRoleError);
  });
});

describe("identity resolution", () => {
  const userRow = (over: Record<string, unknown> = {}) => [{
    id: ALICE, org_id: "org-a", role: "member",
    status: "active", org_status: "active", ...over,
  }];

  it("reads membership from the database, not the token", async () => {
    const { pools, log } = fakePools((sql) => (sql.includes("app_user") ? userRow({ role: "admin" }) : []));
    const identity = await resolveIdentity(createDb(pools), ALICE);
    expect(identity).toEqual({ userId: ALICE, orgId: "org-a", role: "admin", isActive: true });
    // and it read as itself — actor set before the select
    expect(log[0]!.sql).toContain("set local echo.actor_id");
    expect(log[1]!.params).toEqual([ALICE]);
  });

  it("marks a pending signup inactive instead of throwing (M15)", async () => {
    const { pools } = fakePools((sql) => (sql.includes("app_user") ? userRow({ status: "pending" }) : []));
    const identity = await resolveIdentity(createDb(pools), ALICE);
    expect(identity.isActive).toBe(false);
  });

  it("marks a member of a suspended org inactive", async () => {
    const { pools } = fakePools((sql) => (sql.includes("app_user") ? userRow({ org_status: "suspended" }) : []));
    expect((await resolveIdentity(createDb(pools), ALICE)).isActive).toBe(false);
  });

  it("throws for an unknown actor", async () => {
    const { pools } = fakePools(() => []);
    await expect(resolveIdentity(createDb(pools), ALICE)).rejects.toBeInstanceOf(UnknownActorError);
  });
});

describe("worker identity — runs as the call's owner (M3/M4)", () => {
  it("resolves from the payload and verifies the owner can see the call", async () => {
    const { pools, log } = fakePools((sql) => {
      if (sql.includes("app_user")) return [{ id: BOB, org_id: "org-b", role: "member", status: "active", org_status: "active" }];
      if (sql.includes("echo.call")) return [{ id: CALL }];
      return [];
    });
    const identity = await identityForJob(createDb(pools), { callId: CALL, ownerId: BOB });
    expect(identity.userId).toBe(BOB);
    // the call was read AS BOB — the actor was set to bob first
    const callRead = log.findIndex((l) => l.sql.includes("echo.call"));
    expect(log[callRead - 1]!.sql).toBe(`set local echo.actor_id = '${BOB}'`);
    // no identity-less read happened anywhere
    expect(log.every((l) => l.pool === "app")).toBe(true);
  });

  it("fails closed when the payload's owner cannot see the call", async () => {
    // a stale or forged payload: owner resolves, but the call isn't theirs,
    // so RLS returns nothing and the job must not proceed
    const { pools } = fakePools((sql) => {
      if (sql.includes("app_user")) return [{ id: BOB, org_id: "org-b", role: "member", status: "active", org_status: "active" }];
      return []; // call invisible to bob
    });
    await expect(identityForJob(createDb(pools), { callId: CALL, ownerId: BOB }))
      .rejects.toBeInstanceOf(OwnerMismatchError);
  });

  it("validates both ids before touching the database", async () => {
    const { pools, log } = fakePools();
    await expect(identityForJob(createDb(pools), { callId: "nope", ownerId: BOB }))
      .rejects.toThrow(/invalid call id/);
    expect(log).toHaveLength(0);
  });
});
