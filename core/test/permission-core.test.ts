/**
 * Invariant 2 — no DB access without an identity — asserted structurally.
 * A fake SqlClient records exactly what would have been sent, so these tests
 * prove the SET LOCAL discipline without needing Postgres. (RLS itself is
 * Backend 3's SQL suite; this is the app half of M3.)
 */
import { describe, expect, it } from "vitest";

import {
  identityForJob, InactiveOwnerError, OwnerMismatchError, resolveIdentity, UnknownActorError,
} from "../src/db/actor.ts";
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
    expect(log[0]!.sql).toBe("set local role echo_app");
    expect(log[1]!.sql).toBe("select set_config('echo.actor_id', $1, true)");
    expect(log[1]!.params).toEqual([ALICE]);
    // is_local / SET LOCAL throughout — nothing may outlive the transaction
    expect(log[0]!.sql.toLowerCase()).toContain("set local");
    expect(log[1]!.sql).toContain(", true)");
    // the identity is applied BEFORE the caller's query, in the same tx
    expect(log[2]!.sql).toBe("select 1");
  });

  it("passes the actor as a BOUND PARAMETER, not an interpolated string", async () => {
    // set_config is a function call and takes $1; `SET` cannot, which is why
    // this used to be interpolated behind an assertUuid guard. The guard
    // stays as a second line, but a parameter cannot be deleted by a future
    // edit the way a guard can.
    const { pools, log } = fakePools();
    const db = createDb(pools);
    await db.withIdentity(IDENTITY, async () => null);
    expect(log.some((l) => l.sql.includes(ALICE))).toBe(false);

    await expect(db.withIdentity(
      { ...IDENTITY, userId: "'; drop schema echo cascade; --" },
      async () => null,
    )).rejects.toThrow(/invalid actor id/);
    expect(() => assertUuid("not-a-uuid")).toThrow();
    expect(assertUuid(ALICE)).toBe(ALICE);
  });

  it("routes agent work to the echo_agent pool, app work to echo_app", async () => {
    const { pools, log } = fakePools();
    const db = createDb(pools);
    await db.withIdentity(IDENTITY, async () => null);
    await db.withIdentity(IDENTITY, async () => null, { role: "agent" });
    expect(log[0]!.pool).toBe("app");
    expect(log[2]!.pool).toBe("agent");
  });

  it("ASSERTS the role in-transaction, so the boundary is code and not config", async () => {
    // The pool alone made this a configuration fact: worker/main.ts defaults
    // DATABASE_URL_AGENT to the app URL, so a missing variable silently gave
    // agent work echo_app's grants with nothing visibly breaking. SET LOCAL
    // ROLE drops an over-privileged connection to the intended role, and
    // fails loudly on an under-privileged one.
    const { pools, log } = fakePools();
    const db = createDb(pools);
    await db.withIdentity(IDENTITY, async () => null, { role: "agent" });
    expect(log[0]!.sql).toBe("set local role echo_agent");
    // and it is asserted BEFORE the actor, so an unauthorised connection
    // fails before any identity is attached to it
    expect(log[1]!.sql).toContain("set_config");
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
    expect(log[1]!.sql).toContain("set_config('echo.actor_id'");
    expect(log[2]!.params).toEqual([ALICE]);
  });

  it("marks a pending signup inactive instead of throwing (M15)", async () => {
    const { pools } = fakePools((sql) => (sql.includes("app_user") ? userRow({ status: "pending" }) : []));
    const identity = await resolveIdentity(createDb(pools), ALICE);
    expect(identity.isActive).toBe(false);
  });

  it("resolves a PENDING person instead of 401ing them (M15)", async () => {
    // The regression this guards: the org join was inner, `org_read` requires
    // an active actor, so a pending person's row never resolved and the api
    // answered 401 to a valid token. The 403/kind:"pending" branch the whole
    // waiting-for-approval screen keys off was unreachable. Note org_status
    // is NULL here — that is what RLS actually returns for this person, not a
    // convenience.
    const { pools } = fakePools((sql) =>
      (sql.includes("app_user") ? userRow({ status: "pending", org_status: null }) : []));
    const identity = await resolveIdentity(createDb(pools), ALICE);
    expect(identity.userId).toBe(ALICE);
    expect(identity.isActive).toBe(false);
  });

  it("LEFT JOINs the org, so an invisible org row is not a missing person", async () => {
    const { pools, log } = fakePools((sql) => (sql.includes("app_user") ? userRow() : []));
    await resolveIdentity(createDb(pools), ALICE);
    const query = log.find((l) => l.sql.includes("app_user"))!;
    expect(query.sql).toContain("left join echo.org");
  });

  it("says WHY someone is inactive, checking their own status first", async () => {
    // Order matters and the wrong order is tempting: a pending person's org
    // row is invisible to them, so org_status is null. Testing the org first
    // would report every pending signup as "suspended" — a new wrong answer
    // replacing the old one. Their own row is always visible to them.
    const pending = fakePools((sql) =>
      (sql.includes("app_user") ? userRow({ status: "pending", org_status: null }) : []));
    expect((await resolveIdentity(createDb(pending.pools), ALICE)).inactiveReason).toBe("pending");

    const suspended = fakePools((sql) =>
      (sql.includes("app_user") ? userRow({ status: "active", org_status: "suspended" }) : []));
    expect((await resolveIdentity(createDb(suspended.pools), ALICE)).inactiveReason).toBe("suspended");

    // an active person who cannot read their org row at all: same conclusion
    const invisible = fakePools((sql) =>
      (sql.includes("app_user") ? userRow({ status: "active", org_status: null }) : []));
    expect((await resolveIdentity(createDb(invisible.pools), ALICE)).inactiveReason).toBe("suspended");

    const disabled = fakePools((sql) =>
      (sql.includes("app_user") ? userRow({ status: "disabled", org_status: "active" }) : []));
    expect((await resolveIdentity(createDb(disabled.pools), ALICE)).inactiveReason).toBe("disabled");
  });

  it("distinguishes an INACTIVE owner from a lying payload (worker path)", async () => {
    // Both used to be OwnerMismatchError, because RLS denies them
    // identically: a pending owner sees no calls, and a forged payload names
    // an owner who sees no calls. Identical from outside, opposite in
    // meaning — one is reinstatable, one wants investigating.
    const pending = fakePools((sql) =>
      (sql.includes("app_user") ? userRow({ status: "pending", org_status: null }) : []));
    const error = await identityForJob(createDb(pending.pools), { callId: CALL, ownerId: ALICE })
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(InactiveOwnerError);
    expect((error as InactiveOwnerError).reason).toBe("pending");

    // and it does NOT reach the call read — nothing to learn from it
    expect(pending.log.some((l) => l.sql.includes("echo.call"))).toBe(false);
  });

  it("still reports an ACTIVE owner who cannot see the call as a mismatch", async () => {
    const { pools } = fakePools((sql) => (sql.includes("app_user") ? userRow() : []));
    await expect(identityForJob(createDb(pools), { callId: CALL, ownerId: ALICE }))
      .rejects.toBeInstanceOf(OwnerMismatchError);
  });

  it("omits the reason entirely for an active person", async () => {
    // it explains a refusal; there is nothing to explain when there isn't one
    const { pools } = fakePools((sql) => (sql.includes("app_user") ? userRow() : []));
    const identity = await resolveIdentity(createDb(pools), ALICE);
    expect(identity.isActive).toBe(true);
    expect(identity).not.toHaveProperty("inactiveReason");
  });

  it("treats a NULL org_status as not-active, whatever caused it", async () => {
    // null can only mean "could not read the org", and both causes — the
    // actor is not active, or the org is suspended — are false anyway.
    const { pools } = fakePools((sql) =>
      (sql.includes("app_user") ? userRow({ status: "active", org_status: null }) : []));
    expect((await resolveIdentity(createDb(pools), ALICE)).isActive).toBe(false);
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
    expect(log[callRead - 1]!.sql).toContain("set_config('echo.actor_id'");
    expect(log[callRead - 1]!.params).toEqual([BOB]);
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
