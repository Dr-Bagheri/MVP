/**
 * Call queries: the app layer owns shape, bounds and 404-not-403; RLS owns
 * who may see what (asserted in Backend 3's SQL suite, deliberately not
 * re-implemented here — two rules that can disagree is worse than one).
 */
import { describe, expect, it } from "vitest";

import { createCallsRepo, MAX_PAGE } from "../src/api/calls.ts";
import { NotFoundError, ValidationError } from "../src/api/errors.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const CALL = "33333333-3333-4333-8333-333333333333";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

const row = (over: Record<string, unknown> = {}) => ({
  id: CALL, title: "جلسه بودجه", scope: "private", status: "ready",
  language: "fa", started_at: "2026-08-12T09:00:00.000Z",
  duration_ms: 1_800_000, owner_id: ALICE, word_timestamps: true, ...over,
});

function fakeDb(rowsFor: (sql: string, params?: unknown[]) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return rowsFor(sql, params) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { log, db: createDb({ app: make(), agent: make() }) };
}

describe("list", () => {
  it("clamps the page size and defaults sensibly", async () => {
    const { db, log } = fakeDb((sql) => (sql.includes("select") && !sql.startsWith("set") ? [row()] : []));
    const repo = createCallsRepo(db);

    await repo.list(IDENTITY);
    expect(log[1]!.params?.[0]).toBe(25);

    await repo.list(IDENTITY, { limit: 5_000 });
    expect(log[3]!.params?.[0]).toBe(MAX_PAGE);

    await repo.list(IDENTITY, { limit: 0 });
    expect(log[5]!.params?.[0]).toBe(1);
  });

  it("excludes soft-deleted calls and orders newest first", async () => {
    const { db, log } = fakeDb(() => [row()]);
    await createCallsRepo(db).list(IDENTITY);
    const query = log[1]!.sql;
    expect(query).toContain("c.deleted_at is null");
    expect(query).toContain("order by c.started_at desc");
  });

  it("rejects a malformed cursor rather than passing it to SQL", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(createCallsRepo(db).list(IDENTITY, { before: "not-a-date" }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(log).toHaveLength(0);
  });

  it("maps rows to the client shape, including the derived flag", async () => {
    const { db } = fakeDb(() => [row({ word_timestamps: false })]);
    const [call] = await createCallsRepo(db).list(IDENTITY);
    expect(call).toEqual({
      id: CALL, title: "جلسه بودجه", scope: "private", status: "ready",
      language: "fa", startedAt: "2026-08-12T09:00:00.000Z",
      durationMs: 1_800_000, ownerId: ALICE, wordTimestamps: false,
    });
  });
});

describe("get", () => {
  it("returns the call when RLS shows it", async () => {
    const { db } = fakeDb(() => [row()]);
    expect((await createCallsRepo(db).get(IDENTITY, CALL)).id).toBe(CALL);
  });

  it("is 404 (not 403) when the row is invisible — existence is information", async () => {
    const { db } = fakeDb(() => []);
    await expect(createCallsRepo(db).get(IDENTITY, CALL)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("validates the id before touching the database", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(createCallsRepo(db).get(IDENTITY, "'; drop table echo.call; --"))
      .rejects.toThrow(/invalid call id/);
    expect(log).toHaveLength(0);
  });
});

describe("update", () => {
  it("patches title and scope, then re-reads through the same visibility rules", async () => {
    const { db, log } = fakeDb((sql) => (sql.includes("update echo.call") ? [{ id: CALL }] : [row({ title: "نو" })]));
    const call = await createCallsRepo(db).update(IDENTITY, CALL, { title: "نو", scope: "org" });
    expect(call.title).toBe("نو");
    const update = log.find((l) => l.sql.includes("update echo.call"))!;
    expect(update.params).toEqual([CALL, "نو", "org"]);
  });

  it("refuses empty patches and empty titles", async () => {
    const { db } = fakeDb(() => []);
    const repo = createCallsRepo(db);
    await expect(repo.update(IDENTITY, CALL, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.update(IDENTITY, CALL, { title: "   " })).rejects.toBeInstanceOf(ValidationError);
  });

  it("reports a guard-refused update as 404, not a silent success", async () => {
    // tg_call_guard / RLS refuse → zero rows affected
    const { db } = fakeDb(() => []);
    await expect(createCallsRepo(db).update(IDENTITY, CALL, { scope: "org" }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("delete is soft (M11)", () => {
  it("sets deleted_at/deleted_by instead of issuing DELETE", async () => {
    const { db, log } = fakeDb(() => [{ id: CALL }]);
    await createCallsRepo(db).softDelete(IDENTITY, CALL);
    const statement = log.find((l) => l.sql.includes("echo.call"))!;
    expect(statement.sql).toContain("set deleted_at = now()");
    expect(statement.sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(statement.params).toEqual([CALL, ALICE]);
  });

  it("is idempotent-safe: deleting an already-deleted call is 404", async () => {
    const { db } = fakeDb(() => []);
    await expect(createCallsRepo(db).softDelete(IDENTITY, CALL))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
