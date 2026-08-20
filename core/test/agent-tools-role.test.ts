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

/** Two fake pools that record which one ran and every statement issued. */
function fakePools() {
  const log: { pool: "app" | "agent"; sql: string }[] = [];
  const make = (pool: "app" | "agent"): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
        log.push({ pool, sql });
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { pools: { app: make("app"), agent: make("agent") }, log };
}

describe("agentToolsDb", () => {
  it("forces the agent pool and SET LOCAL ROLE echo_agent even when a repo omits options", async () => {
    const { pools, log } = fakePools();
    const db = agentToolsDb(createDb(pools));

    // Exactly how the shared repos call it: no options argument at all.
    await db.withIdentity(IDENTITY, async () => "ok");

    expect(log.some((e) => e.pool === "agent" && e.sql === "set local role echo_agent")).toBe(true);
    // The verify-red half: the same call on the UNWRAPPED db goes to echo_app —
    // proving the wrapper is what carries the property, not the default.
    const control = fakePools();
    await createDb(control.pools).withIdentity(IDENTITY, async () => "ok");
    expect(control.log.some((e) => e.pool === "app" && e.sql === "set local role echo_app")).toBe(true);
    expect(control.log.some((e) => e.pool === "agent")).toBe(false);
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
