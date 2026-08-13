/**
 * Audit Logs (M25) — and mostly, what must NOT be in them.
 *
 * The feed unions three tables, one of which (`echo.agent_run`) carries the
 * assistant's prompt and tool trace in `request` and `steps`. Those are
 * transcript excerpts, quoted documents, whatever the person asked about. An
 * audit surface answers WHAT HAPPENED, not what was said, and the distance
 * between the two is one `select *`.
 *
 * So the first test asserts on the SQL rather than the output. That is
 * usually the wrong instinct — I have been burned this week pinning a
 * mechanism I had inferred — but it is right here for a specific reason: the
 * defect is the QUERY asking for a column, and a fake's rows cannot tell you
 * which columns the real statement selected. What reaches the wire is
 * whatever the database was asked for, so the ask is the thing to check.
 */
import { describe, expect, it } from "vitest";

import { createAuditRepo } from "../src/api/audit.ts";
import { ValidationError } from "../src/api/errors.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};

function fakeDb(rows: unknown[] = []) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }) .unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return sql.includes("set local") || sql.includes("set_config") ? [] : rows;
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const feedSql = (log: { sql: string }[]) => log.find((l) => l.sql.includes("union all"))!.sql;

describe("the audit feed never selects content", () => {
  it("does not ask for agent_run.request or agent_run.steps", async () => {
    const { db, log } = fakeDb();
    await createAuditRepo(db).list(IDENTITY);
    const sql = feedSql(log);
    // Word boundaries: `r.request` must not appear, but `jsonb_build_object`
    // mentioning unrelated words is fine.
    expect(sql).not.toMatch(/\br\.request\b/);
    expect(sql).not.toMatch(/\br\.steps\b/);
    expect(sql).not.toMatch(/\bselect\s+\*\s+from\s+echo\.agent_run\b/i);
  });

  it("selects agent_run by named column, never by row", async () => {
    // The positive half: proving the absence of two names is only meaningful
    // if the query is naming columns at all. A `select r.*` would satisfy the
    // test above by containing neither string.
    const { db, log } = fakeDb();
    await createAuditRepo(db).list(IDENTITY);
    const sql = feedSql(log);
    expect(sql).toContain("r.model");
    expect(sql).toContain("r.tokens_in");
    expect(sql).not.toMatch(/\br\.\*/);
  });
});

describe("the page boundary cannot drop a row", () => {
  /**
   * FE3 found this: the order was `(at, source, id)` but the filter was
   * `at < before`. Total order, partial filter — so rows sharing the last
   * row's exact timestamp fell between pages and were never shown. A burst of
   * admin actions in one transaction, or a run and its decision landing
   * together, is exactly when it bites.
   *
   * On an audit surface a silently dropped row is the worst nothing there is:
   * the reader cannot tell a complete page from a lossy one.
   */
  it("compares the cursor row-wise, not on the timestamp alone", async () => {
    const { db, log } = fakeDb();
    await createAuditRepo(db).list(IDENTITY, {
      cursor: { at: "2026-08-13T10:00:00.000Z", source: "agent_run", id: "run-1" },
    });
    const sql = feedSql(log);
    expect(sql).toContain("(feed.at, feed.source, feed.id)");
    // The old, lossy shape must not come back.
    expect(sql).not.toMatch(/feed\.at\s*<\s*\$\d+::timestamptz\s*\)/);
  });

  it("sorts all three cursor fields the same direction", async () => {
    // Row-wise comparison only means "strictly after this row" when the sort
    // is uniform; a mixed `at desc, source asc` makes the operator and the
    // order disagree, which is a subtler version of the same bug.
    const { db, log } = fakeDb();
    await createAuditRepo(db).list(IDENTITY);
    expect(feedSql(log)).toContain("order by feed.at desc, feed.source desc, feed.id desc");
  });

  it("asks for one row more than the page, to answer 'is there more'", async () => {
    const { db, log } = fakeDb();
    await createAuditRepo(db).list(IDENTITY, { limit: 10 });
    expect(log.find((l) => l.sql.includes("union all"))!.params?.[0]).toBe(11);
  });

  it("builds the cursor from FULL-PRECISION time, not the displayed timestamp", async () => {
    /**
     * The bug inside the fix. `iso()` renders milliseconds; Postgres stores
     * microseconds. A cursor built from the display value re-opens the skip
     * the composite cursor closed: with the last row at `…341567`, a cursor of
     * `…341000` excludes everything between them — rows that sort AFTER the
     * last one and belong on the next page.
     *
     * So `at_cursor` (raw `feed.at::text`) is the cursor and `at` is the
     * display, and they are deliberately different strings. Anyone "tidying"
     * this by reusing `at` reintroduces a silent row-drop, which is why the
     * assertion is that they DIFFER.
     */
    const rows = [
      { source: "agent_run", id: "r1", at: new Date("2026-08-13T10:00:00.341Z"),
        at_cursor: "2026-08-13 10:00:00.341567+00", actor_id: IDENTITY.userId,
        actor_name: null, action: "ok", target_type: "agent_run", target_id: null, detail: {} },
      { source: "agent_run", id: "r2", at: new Date("2026-08-13T09:59:00Z"),
        at_cursor: "2026-08-13 09:59:00.1+00", actor_id: IDENTITY.userId,
        actor_name: null, action: "ok", target_type: "agent_run", target_id: null, detail: {} },
    ];
    const { db } = fakeDb(rows);
    const page = await createAuditRepo(db).list(IDENTITY, { limit: 1 });
    expect(page.next_cursor!.at).toBe("2026-08-13 10:00:00.341567+00");
    expect(page.next_cursor!.at).not.toBe(page.entries[0]!.at);
  });

  it("sends the cursor's text to Postgres without a Date round trip", async () => {
    // `new Date(cursor.at).toISOString()` would silently truncate the
    // microseconds back off — the same loss, one layer down.
    const { db, log } = fakeDb();
    await createAuditRepo(db).list(IDENTITY, {
      cursor: { at: "2026-08-13 10:00:00.341567+00", source: "agent_run", id: "r1" },
    });
    expect(log.find((l) => l.sql.includes("union all"))!.params?.[1])
      .toBe("2026-08-13 10:00:00.341567+00");
  });

  it("returns a cursor when a further row exists, and drops the extra row", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      source: "agent_run", id: `run-${i}`, at: new Date(`2026-08-13T10:0${i}:00Z`),
      at_cursor: `2026-08-13 10:0${i}:00.000123+00`,
      actor_id: IDENTITY.userId, actor_name: "علی", action: "ok",
      target_type: "agent_run", target_id: null, detail: {},
    }));
    const { db } = fakeDb(rows);
    const page = await createAuditRepo(db).list(IDENTITY, { limit: 2 });
    expect(page.entries).toHaveLength(2);
    // The cursor points at the LAST RETURNED row, not the peeked one — and
    // carries that row's full-precision time, not its displayed one.
    expect(page.next_cursor).toEqual({
      at: "2026-08-13 10:01:00.000123+00", source: "agent_run", id: "run-1",
    });
  });

  it("returns a null cursor at the end of the feed", async () => {
    // The reliable end signal — better than `entries.length < limit`, which
    // is a fact about the query plan rather than a promise.
    const { db } = fakeDb([{
      source: "agent_run", id: "run-1", at: new Date("2026-08-13T10:00:00Z"),
      actor_id: IDENTITY.userId, actor_name: null, action: "ok",
      target_type: "agent_run", target_id: null, detail: {},
    }]);
    const page = await createAuditRepo(db).list(IDENTITY, { limit: 50 });
    expect(page.next_cursor).toBeNull();
  });

  it("caps an oversized limit rather than honouring it", async () => {
    const { db, log } = fakeDb();
    await createAuditRepo(db).list(IDENTITY, { limit: 100_000 });
    expect(log.find((l) => l.sql.includes("union all"))!.params?.[0]).toBe(201);
  });

  it("rejects an unknown source instead of quietly returning everything", async () => {
    const { db } = fakeDb();
    await expect(createAuditRepo(db).list(IDENTITY, { source: "agent_runs" }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an unparseable cursor rather than paging from the epoch", async () => {
    const { db } = fakeDb();
    await expect(createAuditRepo(db).list(IDENTITY, {
      cursor: { at: "last tuesday", source: "agent_run", id: "x" },
    })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("who did it is readable, and its absence is meaningful", () => {
  it("carries the actor's name beside the id", async () => {
    const { db } = fakeDb([{
      source: "admin_action", id: "a-1", at: new Date("2026-08-13T10:00:00Z"),
      actor_id: IDENTITY.userId, actor_name: "علی رضایی", action: "set_setting",
      target_type: "org", target_id: null, detail: { key: "locale" },
    }]);
    const [entry] = (await createAuditRepo(db).list(IDENTITY)).entries;
    expect(entry).toEqual({
      source: "admin_action", id: "a-1", at: "2026-08-13T10:00:00.000Z",
      actor_id: IDENTITY.userId, actor_name: "علی رضایی", action: "set_setting",
      target_type: "org", target_id: null, detail: { key: "locale" },
    });
  });

  it("reports a tombstoned actor as null, not as an empty string", async () => {
    // M24's true delete EMPTIES the name and keeps the row so references
    // resolve. An empty string would render as a blank cell — null says "this
    // person no longer exists", which is the fact the screen needs.
    const { db } = fakeDb([{
      source: "admin_action", id: "a-1", at: new Date("2026-08-13T10:00:00Z"),
      actor_id: IDENTITY.userId, actor_name: "", action: "set_setting",
      target_type: "org", target_id: null, detail: {},
    }]);
    const [entry] = (await createAuditRepo(db).list(IDENTITY)).entries;
    expect(entry!.actor_name).toBeNull();
  });
});
