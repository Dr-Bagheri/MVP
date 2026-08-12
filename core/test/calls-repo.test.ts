/**
 * Call queries: the app layer owns shape, bounds and 404-not-403; RLS owns
 * who may see what (asserted in Backend 3's SQL suite, deliberately not
 * re-implemented here — two rules that can disagree is worse than one).
 */
import { describe, expect, it } from "vitest";

import { createCallsRepo, MAX_PAGE, timingFromCounts } from "../src/api/calls.ts";
import { NotFoundError, ValidationError } from "../src/api/errors.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const CALL = "33333333-3333-4333-8333-333333333333";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

const row = (over: Record<string, unknown> = {}) => ({
  id: CALL, title: "جلسه بودجه", scope: "private", status: "ready",
  language: "fa", started_at: "2026-08-12T09:00:00.000Z",
  duration_ms: 1_800_000, owner_id: ALICE, transcribed_part_count: 2, timed_part_count: 2, ...over,
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

/** Product statements only — `set local role` and set_config are plumbing. */
const queries = (log: { sql: string; params?: unknown[] | undefined }[]) =>
  log.filter((l) => {
    const sql = l.sql.trim().toLowerCase();
    return !sql.startsWith("set local") && !sql.includes("set_config('echo.actor_id'");
  });

describe("list", () => {
  it("clamps the page size and defaults sensibly", async () => {
    const { db, log } = fakeDb((sql) => (sql.includes("select") && !sql.startsWith("set") ? [row()] : []));
    const repo = createCallsRepo(db);

    await repo.list(IDENTITY);
    expect(queries(log)[0]!.params?.[0]).toBe(25);

    await repo.list(IDENTITY, { limit: 5_000 });
    expect(queries(log)[1]!.params?.[0]).toBe(MAX_PAGE);

    await repo.list(IDENTITY, { limit: 0 });
    expect(queries(log)[2]!.params?.[0]).toBe(1);
  });

  it("excludes soft-deleted calls and orders newest first", async () => {
    const { db, log } = fakeDb(() => [row()]);
    await createCallsRepo(db).list(IDENTITY);
    const query = queries(log)[0]!.sql;
    expect(query).toContain("c.deleted_at is null");
    expect(query).toContain("order by c.started_at desc");
  });

  it("reads timing from db/0020's stored flag, not from segment words", async () => {
    // The derived `exists (… s.words <> '[]')` predicate is ANY-segment;
    // the stored flag is ALL-segments and demotes on correction. Keeping the
    // old one alongside would be two rules that disagree after an edit.
    const { db, log } = fakeDb(() => [row()]);
    await createCallsRepo(db).list(IDENTITY);
    const query = queries(log)[0]!.sql;
    expect(query).toContain("p.has_word_timestamps");
    expect(query).not.toContain("s.words <> ");
  });

  it("rejects a malformed cursor rather than passing it to SQL", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(createCallsRepo(db).list(IDENTITY, { before: "not-a-date" }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(log).toHaveLength(0);
  });

  it("maps rows to the client shape, including the derived provenance", async () => {
    const { db } = fakeDb(() => [row({ transcribed_part_count: 2, timed_part_count: 1 })]);
    const [call] = await createCallsRepo(db).list(IDENTITY);
    // wire shape is snake_case throughout — matches the client contract and
    // the DB columns; a half-and-half object is worse than either convention
    expect(call).toEqual({
      id: CALL, title: "جلسه بودجه", scope: "private", status: "ready",
      language: "fa", started_at: "2026-08-12T09:00:00.000Z",
      duration_ms: 1_800_000, owner_id: ALICE, transcript_timing: "mixed",
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

describe("transcript_timing is provenance, not a gate (steward-ratified)", () => {
  it("distinguishes full, mixed and none — information a boolean could not carry", () => {
    expect(timingFromCounts(3, 3)).toBe("full");
    expect(timingFromCounts(3, 1)).toBe("mixed");   // the case that bit the UI
    expect(timingFromCounts(3, 0)).toBe("none");
  });

  it("is NULL when nothing is transcribed — absent is not 'none'", () => {
    // a failed or not-yet-processed call has no transcript at all; "none"
    // would claim a real prose-only transcript exists. The old boolean
    // forced that lie (failed calls carried `true`).
    expect(timingFromCounts(0, 0)).toBeNull();
  });

  it("reports what is transcribed SO FAR while parts are still landing", () => {
    // 2 of 3 parts transcribed, both word-timed → "full" for what exists,
    // and it self-corrects to "mixed" if a later part degrades
    expect(timingFromCounts(2, 2)).toBe("full");
  });

  it("does not count an untranscribed part as an UNTIMED part", () => {
    // The frontend built a fixture on the opposite assumption: part 0 done
    // and timed, part 1 not started, expecting "mixed". A not-yet-transcribed
    // part is not evidence of missing word timing — it is no evidence at all,
    // so this call is "full" for what exists.
    expect(timingFromCounts(1, 1)).toBe("full");
  });

  it("moves full → mixed as a later part degrades, and never back", () => {
    // the direction that actually happens mid-flight: the chip APPEARS, it
    // does not retract. "mixed" is monotone once flags have settled.
    expect(timingFromCounts(1, 1)).toBe("full");
    expect(timingFromCounts(2, 1)).toBe("mixed");
    expect(timingFromCounts(3, 2)).toBe("mixed");
  });

  it("normalises pg bigint counts arriving as strings", () => {
    // "2" === 2 is false; without Number() every call reports "mixed" in
    // production while every unit test passes
    expect(timingFromCounts(Number("2"), Number("2"))).toBe("full");
  });
});
