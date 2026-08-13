/**
 * Conversations (M4, db/0018) — and the truncation annotation FE2 found.
 *
 * The case that matters: a run failing MID-STREAM leaves a real partial
 * answer in the thread, and after a reload nothing says it stopped early. It
 * renders identically to a complete answer the model chose to give, which in
 * a product whose value is "you need not re-listen to the call" means a user
 * can act on half a summary believing it is the whole one.
 */
import { describe, expect, it } from "vitest";

import { NotFoundError } from "../src/api/errors.ts";
import { createSessionsRepo, titleFrom } from "../src/api/sessions.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member",
  isActive: true,
};
const SESSION = "55555555-5555-4555-8555-555555555555";

function fakeDb(rowsFor: (sql: string) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes("set local") || sql.includes("set_config")) return [];
        return rowsFor(sql);
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const message = (over: Record<string, unknown> = {}) => ({
  id: "m1", seq: 0, role: "assistant", content: "سه موضوع مطرح شد: نخست",
  tool_calls: [], agent_run_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  created_at: new Date("2026-08-13T10:00:00Z"), ...over,
});

describe("a cut-off answer says so", () => {
  const thread = (sql: string, row: Record<string, unknown>) =>
    sql.includes("agent_message") ? [row] : [{ id: SESSION }];

  it("marks a turn whose run errored", async () => {
    const { db } = fakeDb((sql) => thread(sql, message({ truncated: true })));
    const [turn] = await createSessionsRepo(db).messages(IDENTITY, SESSION);
    expect(turn!.truncated).toBe(true);
  });

  it("leaves a completed turn unmarked", async () => {
    const { db } = fakeDb((sql) => thread(sql, message({ truncated: false })));
    const [turn] = await createSessionsRepo(db).messages(IDENTITY, SESSION);
    expect(turn!.truncated).toBe(false);
  });

  it("does NOT claim truncation when the run is unreadable", async () => {
    // A LEFT JOIN to a run this caller cannot see yields null. The safe
    // default is silence: a wrong "cut off" on a complete answer is its own
    // lie, and worse than the vaguer nothing.
    const { db } = fakeDb((sql) => thread(sql, message({ truncated: null })));
    const [turn] = await createSessionsRepo(db).messages(IDENTITY, SESSION);
    expect(turn!.truncated).toBe(false);
  });

  it("never marks a human turn", async () => {
    const { db } = fakeDb((sql) =>
      thread(sql, message({ role: "user", agent_run_id: null, truncated: null })));
    const [turn] = await createSessionsRepo(db).messages(IDENTITY, SESSION);
    expect(turn!.truncated).toBe(false);
  });

  it("calls the SHARED predicate rather than spelling the rule again", async () => {
    /**
     * Three predicates existed for one rule: my `= 'error'`, db/0047's stamp
     * `<> 'ok'`, and my near-miss `<> 'ok'` live. db/0048 makes it one
     * function both halves call, with the context as a parameter — a run is
     * truncated if it did not finish cleanly AND is not still plausibly in
     * flight, and `started_at` is what decides the second clause.
     *
     * Asserted on the SQL because the divergence IS the predicate: any
     * re-spelling of the rule here is exactly the drift this closed.
     */
    const { db, log } = fakeDb((sql) => thread(sql, message({ truncated: true })));
    await createSessionsRepo(db).messages(IDENTITY, SESSION);
    const query = log.find((l) => l.sql.includes("agent_message"))!.sql;
    // The TWO-argument form: `started_at` is what makes the answer structural
    // rather than dependent on the api appending after the run resolves.
    expect(query).toContain("echo.run_is_truncated(r.status, r.started_at)");
    // No local copy of the rule, in either spelling.
    expect(query).not.toContain("r.status = 'error'");
    expect(query).not.toContain("r.status <> 'ok'");
  });

  it("derives it by join rather than reading a stored column", async () => {
    // Stored, it would be a second copy of agent_run.status that can disagree
    // with it — and it would have needed a migration for a fact the database
    // already held.
    const { db, log } = fakeDb((sql) => thread(sql, message({ truncated: true })));
    await createSessionsRepo(db).messages(IDENTITY, SESSION);
    const query = log.find((l) => l.sql.includes("agent_message"))!.sql;
    expect(query).toContain("left join echo.agent_run");
  });
});

describe("a thread that isn't there is not an empty thread", () => {
  it("404s for a conversation the caller cannot see", async () => {
    // Both would otherwise be `[]` — the recurring two-kinds-of-nothing bug.
    const { db } = fakeDb(() => []);
    await expect(createSessionsRepo(db).messages(IDENTITY, SESSION))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns an empty array for a real conversation with nothing said", async () => {
    const { db } = fakeDb((sql) => (sql.includes("agent_message") ? [] : [{ id: SESSION }]));
    await expect(createSessionsRepo(db).messages(IDENTITY, SESSION)).resolves.toEqual([]);
  });
});

describe("titles are made from the first question", () => {
  it("keeps a short one whole", () => {
    expect(titleFrom("خلاصهٔ جلسه؟")).toBe("خلاصهٔ جلسه؟");
  });

  it("collapses whitespace so a pasted prompt does not become a ragged title", () => {
    expect(titleFrom("  چه\n\n خبر  ")).toBe("چه خبر");
  });

  it("cuts on a word boundary when there is one nearby", () => {
    const title = titleFrom(`${"word ".repeat(30)}end`);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/wo…$/);
  });

  it("still truncates an unbroken string rather than collapsing it", () => {
    // Searching back for a space must not eat most of the title when there
    // is no space to find.
    const title = titleFrom("a".repeat(200));
    expect(title.length).toBeGreaterThan(60);
  });
});
