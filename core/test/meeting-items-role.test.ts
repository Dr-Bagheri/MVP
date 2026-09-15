/**
 * THE EXTRACTION'S ROWS NEED THE AGENT'S ROLE, and nothing asserted it.
 *
 * `recordExtracted` writes `source = 'ai'`. db/0161 grants that shape to
 * echo_agent alone (`meeting_item_agent_insert`); echo_app's own policy,
 * `meeting_item_insert`, is `with check (… and source = 'user')`. And
 * `withIdentity` defaults to echo_app — `options.role === "agent" ? "agent" :
 * "app"` in db/identity.ts — so the third argument is not a refinement of this
 * function, it IS this function.
 *
 * WHY IT SHIPPED SILENTLY, which is the reason this file exists rather than a
 * comment. Without the argument every row is refused by RLS; the refusal is
 * caught upstream (`summarizer.ts` wraps `extractClaims` and sets `claims =
 * null`), and `claims = null` renders as "the pass could not be read". So the
 * symptom of a permission wall was a model that appeared not to answer — on
 * every meeting, for as long as it lasted, with nothing red anywhere.
 *
 * ── WHAT IS ASSERTED, AND AT WHAT ALTITUDE ────────────────────────────────
 *
 * Not "the repo passed `{ role: 'agent' }`" — that is the code agreeing with
 * itself one call deep. The subject is what reaches POSTGRES: which pool the
 * transaction took and which role its preamble asked for. That is the pair RLS
 * actually reads, and the fake records both (the pattern and the fake are
 * `agent-tools-role.test.ts`'s, for the reason it gives: the preamble BINDS the
 * role as `$1`, so identical statement text is issued on either path and a log
 * of SQL alone could not tell them apart).
 *
 * The real policies live in db/ and are db/test's subject. What core/ owns is
 * the door it knocks on, and that is what goes wrong here.
 */
import { describe, expect, it } from "vitest";

import { createMeetingsRepo } from "../src/api/meetings.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member",
  isActive: true,
};
const MEETING = "33333333-3333-4333-8333-333333333333";

interface Entry { pool: "app" | "agent"; sql: string; params: unknown[] }

/**
 * Two fake pools that record WHICH ONE ran, the statement and its parameters.
 *
 * The `returning id` row is answered so the insert's own result path is
 * exercised: a fake that answered nothing would report `landed: 0` for a write
 * that worked and for a write that was refused, which are the two states this
 * whole file is about telling apart.
 */
function fakePools() {
  const log: Entry[] = [];
  const make = (pool: "app" | "agent"): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (
        sql: string,
        params?: unknown[],
      ) => {
        log.push({ pool, sql, params: params ?? [] });
        if (sql.includes("insert into echo.meeting_item")) return [{ id: "item-1" }];
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { pools: { app: make("app"), agent: make("agent") }, log };
}

/** the role this transaction asked Postgres for — $1 of the one-statement preamble */
const rolesAsked = (log: Entry[]): unknown[] =>
  log.filter((e) => e.sql.includes("set_config('role'")).map((e) => e.params[0]);

const CLAIM = {
  kind: "decision" as const,
  body: "قرارداد با NAI تمدید شود",
  ownerId: "44444444-4444-4444-8444-444444444444",
  owner: "سینا",
  dueOn: "2026-09-20",
  atMs: 61_000,
};

describe("recordExtracted runs as the agent", () => {
  it("takes the AGENT pool and asks Postgres for echo_agent", async () => {
    const { pools, log } = fakePools();
    const landed = await createMeetingsRepo(createDb(pools)).recordExtracted(
      IDENTITY, MEETING, [CLAIM],
    );

    expect(rolesAsked(log)).toEqual(["echo_agent"]);
    expect(log.every((e) => e.pool === "agent"), "every statement went to the agent pool").toBe(true);
    /* the insert really ran on that transaction, and its row came back — so
       "the role is right" is said about a write and not about an empty
       transaction that asked for a role and did nothing */
    const insert = log.find((e) => e.sql.includes("insert into echo.meeting_item"));
    expect(insert, "no insert was issued at all").toBeDefined();
    expect(insert!.pool).toBe("agent");
    expect(landed).toEqual({ landed: 1, itemIds: ["item-1"] });
  });

  it("THE VERIFY-RED: the same repo's reads are the caller's own, on echo_app", async () => {
    /*
     * The control, and it is what makes the assertion above mean something: if
     * this repo asked for echo_agent everywhere, the test above would pass and
     * every read in the product would have been widened to the role that is
     * allowed to write `source='ai'`. `ledger` is a READ of the same table, by
     * the same repo, and it must be the caller's.
     */
    const { pools, log } = fakePools();
    await createMeetingsRepo(createDb(pools)).ledger(IDENTITY, {});
    expect(rolesAsked(log)).toEqual(["echo_app"]);
    expect(log.some((e) => e.pool === "agent"), "a read reached the agent pool").toBe(false);
  });

  it("writes source='ai' — the shape only the agent role may insert", async () => {
    /*
     * The other half of the pair the policy is written in. The role above is
     * only the right role BECAUSE of this value: a future edit that wrote
     * `source = 'user'` here would make echo_agent the wrong choice and would
     * also launder a model's claim as a person's, which is the one thing
     * 0160's two policies exist to keep apart.
     */
    const { pools, log } = fakePools();
    await createMeetingsRepo(createDb(pools)).recordExtracted(IDENTITY, MEETING, [CLAIM]);
    const insert = log.find((e) => e.sql.includes("insert into echo.meeting_item"))!;
    expect(insert.sql).toContain("'ai'");
    expect(insert.sql).not.toContain("'user'");
    /* and the claim's own fields travel rather than being dropped on the way:
       the owner the roster resolved, the spoken name beside it, the day, the
       moment in the recording */
    expect(insert.params).toEqual([
      MEETING, CLAIM.kind, CLAIM.body, CLAIM.owner, CLAIM.ownerId, CLAIM.dueOn, CLAIM.atMs,
    ]);
  });

  it("issues no transaction at all for an empty batch", async () => {
    /* a pass that read the meeting and found nothing must not open a write
       transaction, and must leave the previous extraction standing */
    const { pools, log } = fakePools();
    const landed = await createMeetingsRepo(createDb(pools)).recordExtracted(IDENTITY, MEETING, []);
    expect(landed).toEqual({ landed: 0, itemIds: [] });
    expect(log).toEqual([]);
  });
});
