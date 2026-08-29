/**
 * agentToolsDb (2026-08-20 tenancy audit): the Db handed to the agent's tools
 * must run every transaction on echo_agent — the grant set IS the boundary
 * ("the agent deletes nothing" is a grant, not a prompt instruction), and the
 * previous wiring passed the raw db, so tool reads ran on echo_app while
 * `assertAgentRole` sat uncalled. These tests pin the wrapper's three
 * properties at the altitude they're promised: which POOL a transaction takes
 * and which SET LOCAL ROLE it issues, not which comment claims it.
 */
import { describe, expect, it } from "vitest";

import {
  agentToolsDb,
  createDb,
  WrongRoleError,
  type SqlClient,
  type SqlTx,
} from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member",
  isActive: true,
};

/**
 * Two fake pools that record which one ran, every statement issued, AND its
 * bound parameters.
 *
 * The params half is load-bearing rather than tidy. The preamble used to spell
 * the role into the SQL (`set local role echo_agent`), so a log of statement
 * TEXT was enough to tell the two roles apart. It is now one statement,
 * `select set_config('role', $1, true), set_config('echo.actor_id', $2, true)`,
 * with the role BOUND — identical text on both paths. A fake that captured
 * only `sql` would still have passed this test and could no longer have
 * failed it for the right reason: both roles produce the same string, so the
 * assertion would have been true of a wrapper that did nothing.
 */
function fakePools() {
  const log: { pool: "app" | "agent"; sql: string; params: unknown[] }[] = [];
  const make = (pool: "app" | "agent"): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (
        sql: string,
        params?: unknown[],
      ) => {
        log.push({ pool, sql, params: params ?? [] });
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { pools: { app: make("app"), agent: make("agent") }, log };
}

/** The role this transaction actually asked Postgres for — $1 of the preamble. */
const roleSetOn = (
  log: { pool: "app" | "agent"; sql: string; params: unknown[] }[],
  pool: "app" | "agent",
): unknown[] =>
  log.filter((e) => e.pool === pool && e.sql.includes("set_config('role'"))
     .map((e) => e.params[0]);

describe("agentToolsDb", () => {
  it("forces the agent pool and the echo_agent role even when a repo omits options", async () => {
    const { pools, log } = fakePools();
    const db = agentToolsDb(createDb(pools));

    // Exactly how the shared repos call it: no options argument at all.
    await db.withIdentity(IDENTITY, async () => "ok");

    expect(roleSetOn(log, "agent")).toEqual(["echo_agent"]);
    // The verify-red half: the same call on the UNWRAPPED db goes to echo_app —
    // proving the wrapper is what carries the property, not the default. This
    // is the assertion that would go vacuous if the fake stopped recording
    // parameters, because both paths now issue the identical statement text.
    const control = fakePools();
    await createDb(control.pools).withIdentity(IDENTITY, async () => "ok");
    expect(roleSetOn(control.log, "app")).toEqual(["echo_app"]);
    expect(control.log.some((e) => e.pool === "agent")).toBe(false);
  });

  it("issues its whole preamble in ONE statement", async () => {
    // The speed claim, pinned where it can rot: the identity preamble runs
    // before every query in the product, so a future edit that splits it back
    // into two awaited statements re-adds a round trip to every database call
    // in the codebase and would otherwise break nothing visible.
    const { pools, log } = fakePools();
    await createDb(pools).withIdentity(IDENTITY, async () => "ok");
    expect(log).toHaveLength(1);
    expect(log[0]?.params).toEqual(["echo_app", IDENTITY.userId]);
  });

  it("an explicit app-role request through the wrapper fails loudly, never widens quietly", async () => {
    const { pools, log } = fakePools();
    const db = agentToolsDb(createDb(pools));
    await expect(
      db.withIdentity(IDENTITY, async () => "ok", { role: "app" }),
    ).rejects.toBeInstanceOf(WrongRoleError);
    // and nothing reached either pool before the refusal
    expect(log).toHaveLength(0);
  });

  it("has no actor-less door: a tool has a caller by definition", async () => {
    const { pools, log } = fakePools();
    const db = agentToolsDb(createDb(pools));
    expect(() => db.withoutIdentity(async () => "ok")).toThrow(WrongRoleError);
    expect(log).toHaveLength(0);
  });
});
