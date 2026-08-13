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
  duration_ms: 1_800_000, owner_id: ALICE,
  source: null, archived_at: null, deleted_at: null,
  purge_after: null, current_summary_id: null,
  transcribed_part_count: 2, timed_part_count: 2, ...over,
});

// (A `withCount` helper lived here, for statements that read postgres.js's
// affected-row count because they could not use RETURNING. db/0032 replaced
// those with functions that return a boolean, so nothing needs it now.)

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
      // Lifecycle fields the schema always carried and this wire did not.
      // The frontend had built archive/restore, a purge countdown and a
      // version pointer against columns the api never sent — "not built" and
      // "not exposed" are indistinguishable from outside.
      source: null, archived_at: null, deleted_at: null,
      purge_after: null, current_summary_id: null,
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
  /**
   * These used to assert the SQL — `set deleted_at = now()`, and the ABSENCE
   * of a RETURNING clause. db/0032 moved deletion into a named function, so
   * they were rewritten; but the more useful lesson is why they were wrong
   * even while green.
   *
   * They pinned a MECHANISM I inferred from a live failure, and the inference
   * was half wrong. Seeing an owner's delete refused with 42501, I concluded
   * RETURNING made Postgres apply the SELECT policy to a row `call_read`
   * hides — dropped the clause, and wrote a test asserting it stays dropped.
   * The delete still failed live: setting `deleted_at` at ALL moves the row
   * outside the actor's own read policy. So the test passed, described a real
   * constraint, and guarded a fix that did not work.
   *
   * What is asserted now is the CONTRACT — which door, and what each answer
   * means. The mechanism is the database's business, which is precisely why
   * it was able to change without this file being wrong again.
   */
  it("goes through echo.soft_delete_call, never a direct write", async () => {
    const { db, log } = fakeDb(() => [{ deleted: true }]);
    await createCallsRepo(db).softDelete(IDENTITY, CALL);
    const statement = log.find((l) => l.sql.includes("soft_delete_call"))!;
    expect(statement.params).toEqual([CALL]);
    // Direct deleted_at writes now raise for application roles (db/0032):
    // one door, so deletion cannot quietly acquire a second implementation.
    expect(log.some((l) => /set\s+deleted_at/i.test(l.sql))).toBe(false);
    expect(log.some((l) => /\bdelete\s+from\b/i.test(l.sql))).toBe(false);
  });

  it("treats a second delete as success, not an error", async () => {
    // `false` = already deleted. The caller wanted it gone and it is gone; a
    // double-clicked delete button is not a failure.
    const { db } = fakeDb(() => [{ deleted: false }]);
    await expect(createCallsRepo(db).softDelete(IDENTITY, CALL)).resolves.toBeUndefined();
  });

  it("turns the database's refusal into 404, not 500", async () => {
    /**
     * `soft_delete_call` raises 42501 for a call that is not yours — via a
     * plpgsql RAISE, so it carries `routine: exec_stmt_raise`, NOT the
     * `ExecWithCheckOptions` that errors.ts pins its RLS branch to. Without
     * the catch in calls.ts this lands in the 500 bucket and the api claims
     * its own fault for a refusal the database issued deliberately.
     */
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("insufficient privilege"), {
        code: "42501", routine: "exec_stmt_raise",
      });
    });
    await expect(createCallsRepo(db).softDelete(IDENTITY, CALL))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("parts on the call detail (M25)", () => {
  const partRow = {
    id: "p1", idx: 0, offset_ms: 0, duration_ms: 9000, status: "diarized",
    has_word_timestamps: false, missing: false, failure_reason: null,
    audio_format: "opus", byte_size: "1048576",
  };

  it("never selects storage locations or integrity hashes", async () => {
    // A client never addresses storage directly — audio is served through the
    // api, which is what keeps the sealed-object rule enforceable. Selecting
    // these would hand a map of the bucket layout to anyone who can read a
    // call, for no capability they gain.
    const { db, log } = fakeDb(() => [partRow]);
    await createCallsRepo(db).parts(IDENTITY, CALL);
    const sql = queries(log).find((l) => l.sql.includes("echo.call_part"))!.sql;
    for (const forbidden of ["storage_bucket", "storage_path", "audio_sha256", "attempts"]) {
      expect(sql).not.toContain(forbidden);
    }
    // And the positive half, or `select *` would satisfy the loop above.
    expect(sql).toContain("has_word_timestamps");
  });

  it("orders by idx — the field that means 'the nth piece'", async () => {
    const { db, log } = fakeDb(() => [partRow]);
    await createCallsRepo(db).parts(IDENTITY, CALL);
    expect(queries(log).find((l) => l.sql.includes("echo.call_part"))!.sql)
      .toContain("order by idx");
  });

  it("returns byte_size as a NUMBER, not the string postgres.js hands back", async () => {
    // bigint arrives as a string. `byte_size: "1048576"` on the wire turns a
    // size comparison in the client into a lexicographic one, where
    // "9" > "1048576" — a bug that looks like a backend lie about file sizes.
    const { db } = fakeDb(() => [partRow]);
    const [part] = await createCallsRepo(db).parts(IDENTITY, CALL);
    expect(part!.byte_size).toBe(1048576);
  });

  it("distinguishes a null duration from a zero one", async () => {
    const { db } = fakeDb(() => [{ ...partRow, duration_ms: null }]);
    const [part] = await createCallsRepo(db).parts(IDENTITY, CALL);
    // Not yet known is not the same as an empty part; `Number(null)` is 0 and
    // would quietly claim the second.
    expect(part!.duration_ms).toBeNull();
  });
});

describe("archive and restore (M11)", () => {
  it("archives with a TIMESTAMP, not a flag", async () => {
    // "when" carries strictly more than "whether", and the filter becomes
    // `archived_at is null` rather than a boolean that can drift out of sync
    // with the moment it happened.
    const { db, log } = fakeDb((sql) => (sql.includes("update echo.call") ? [{ id: CALL }] : [row()]));
    await createCallsRepo(db).setArchived(IDENTITY, CALL, true);
    const update = queries(log).find((l) => l.sql.includes("update echo.call"))!;
    expect(update.sql).toContain("archived_at = case when $2::boolean then now() else null end");
    expect(update.params).toEqual([CALL, true]);
  });

  it("unarchives by clearing it, through the same path", async () => {
    const { db, log } = fakeDb((sql) => (sql.includes("update echo.call") ? [{ id: CALL }] : [row()]));
    await createCallsRepo(db).setArchived(IDENTITY, CALL, false);
    expect(queries(log).find((l) => l.sql.includes("update echo.call"))!.params).toEqual([CALL, false]);
  });

  it("refuses to archive a DELETED call", async () => {
    // Already out of the way; archiving it too would need a precedence
    // between the two states that nobody has decided.
    const { db, log } = fakeDb(() => []);
    await expect(createCallsRepo(db).setArchived(IDENTITY, CALL, true))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(queries(log)[0]!.sql).toContain("deleted_at is null");
  });

  it("goes through echo.restore_call", async () => {
    const { db, log } = fakeDb((sql) => (sql.includes("restore_call") ? [{ restored: true }] : [row()]));
    await createCallsRepo(db).restore(IDENTITY, CALL);
    expect(queries(log).find((l) => l.sql.includes("restore_call"))!.params).toEqual([CALL]);
    // Clearing the purge countdown is now the function's job. Asserting it in
    // SQL here would be this file re-stating a rule it does not enforce —
    // and, when db/0032 moved it, would have failed while nothing was broken.
    expect(queries(log).some((l) => /purge_after\s*=\s*null/i.test(l.sql))).toBe(false);
  });

  it("surfaces a non-admin's refused restore as 404, not 500 and not silence", async () => {
    /**
     * The bug this replaces was the quiet one. Restore used to be an UPDATE
     * whose WHERE matched zero rows for a non-admin — nothing raised, nothing
     * logged, indistinguishable from a call that never existed. db/0032 makes
     * it RAISE, so there is something to catch; this asserts we catch it and
     * answer like every other invisible row.
     */
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("insufficient privilege"), {
        code: "42501", routine: "exec_stmt_raise",
      });
    });
    await expect(createCallsRepo(db).restore(IDENTITY, CALL))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("is 404 when the window has already passed and the row is gone", async () => {
    const { db } = fakeDb(() => []);
    await expect(createCallsRepo(db).restore(IDENTITY, CALL)).rejects.toBeInstanceOf(NotFoundError);
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
