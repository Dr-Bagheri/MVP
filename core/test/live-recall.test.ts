import { describe, expect, it } from "vitest";
import {
  MIN_SHARED_TERMS, STOP_WORDS, createLiveRecallRepo, distinctiveTerms,
} from "../src/api/live-recall.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * Item 7 — the live meeting's second brain.
 *
 * The assertions that carry this file are about SILENCE. A card that appears
 * mid-meeting about the wrong thing is worse than no card at all: the host
 * reads it, it is irrelevant, and the next one is not read. So the tests that
 * matter most are the ones where recall must return nothing — a window of
 * function words, a single word in common, this meeting's own decisions.
 *
 * `distinctiveTerms` is pure and is where every edge lives, because the rule
 * IS the term list: what reaches the query decides what can ever be recalled.
 */

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member", isActive: true,
};
const MEETING = "33333333-3333-4333-8333-333333333333";

describe("the words worth searching for", () => {
  it("keeps the topic and drops the scaffolding", () => {
    const terms = distinctiveTerms("خب پس ما باید قرارداد شرکت الف را تا شهریور امضا کنیم");
    expect(terms).toContain("قرارداد");
    expect(terms).toContain("شرکت");
    expect(terms).toContain("شهریور");
    /* the pair: without this the assertion above is satisfied by a function
       that returns every word, which is the version that fires on «را» */
    expect(terms).not.toContain("باید");
    expect(terms).not.toContain("پس");
    expect(terms).not.toContain("را");
  });

  it("folds the letters a keyboard chooses, so one spelling reaches the index", () => {
    /* «شركت» with an Arabic kaf is what a different keyboard produces, and
       the database's own column is folded — a term list that did not fold
       would search for a lexeme the index cannot contain */
    expect(distinctiveTerms("شركت الف")).toContain("شرکت");
    expect(distinctiveTerms("قرارداد")[0]).toBe(distinctiveTerms("قرارداد")[0]);
  });

  it("reads the window newest-first, because a meeting moves on", () => {
    const terms = distinctiveTerms("بودجه تبلیغات ... قرارداد شرکت");
    /* what was said last is what the room is on now; the order is what makes
       the cap («at most 24 terms») take the right end of a long window */
    expect(terms.indexOf("شرکت")).toBeLessThan(terms.indexOf("بودجه"));
  });

  it("says NOTHING for a window with no topic in it", () => {
    expect(distinctiveTerms("خب پس بله دیگه")).toEqual([]);
    expect(distinctiveTerms("ok so yes then we should")).toEqual([]);
    expect(distinctiveTerms("   ")).toEqual([]);
  });

  it("drops bare numbers, which are quantities and not subjects", () => {
    expect(distinctiveTerms("۱۴۰۵ و 2026 و ۳۰۰")).toEqual([]);
    /* the control: a token that merely CONTAINS digits is a name and stays */
    expect(distinctiveTerms("پروژهٔ q3")).toContain("پروژه");
  });

  it("counts a repeated word once", () => {
    /* forty «قرارداد» is one topic, and without the de-duplication the cap
       would be spent on it while the actual subject fell off the end */
    const said = Array.from({ length: 40 }, () => "قرارداد").join(" ");
    expect(distinctiveTerms(`${said} شهریور`).filter((t) => t === "قرارداد")).toHaveLength(1);
  });

  it("the stop list holds no topic", () => {
    /*
     * A wrong entry here is SILENT: the decision that word belongs to can
     * never be recalled and nothing says why. So the words this product
     * actually decides about are asserted absent — a guard for the day
     * somebody adds «کار» or «مورد» to make the list feel more complete.
     */
    for (const topic of ["قرارداد", "بودجه", "پروژه", "جلسه", "مشتری", "گزارش",
      "contract", "budget", "project", "client", "report", "deadline"]) {
      expect(STOP_WORDS.has(topic), `"${topic}" is a topic, not scaffolding`).toBe(false);
    }
  });
});

// ─── the query ───────────────────────────────────────────────────────────────

interface Recorded { sql: string; params?: unknown[] | undefined }

function fakeDb(rows: Record<string, unknown>[] = []) {
  const calls: Recorded[] = [];
  const tx = {
    async unsafe(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return rows;
    },
  } as unknown as SqlTx;
  const db = {
    withIdentity: async <T,>(_i: unknown, fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withoutIdentity: async <T,>(fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withActor: async <T,>(_a: string, fn: (t: SqlTx) => Promise<T>) => fn(tx),
  } as unknown as Db;
  return { db, calls };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "i-1", kind: "decision", body: "قرارداد با شرکت الف امضا می‌شود",
  status: "standing", meeting_id: "m-9", meeting_title: "جلسهٔ مرداد",
  decided_at: new Date("2026-08-15T09:00:00Z"),
  owner_id: null, due_on: null, shared: 3, ...over,
});

describe("what the room already decided", () => {
  it("asks the database only when the window has enough to ask about", async () => {
    const { db, calls } = fakeDb();
    const repo = createLiveRecallRepo(db);
    const found = await repo.recall(IDENTITY, { window: "خب پس بله", exclude: MEETING });
    expect(found).toEqual([]);
    /* not one query for a window with no topic: recall runs on a timer in a
       live meeting, and a search per tick over nothing is a cost with no
       possible answer */
    expect(calls).toHaveLength(0);
  });

  it("carries the rule into the query rather than filtering afterwards", async () => {
    const { db, calls } = fakeDb([row()]);
    await createLiveRecallRepo(db).recall(IDENTITY, {
      window: "قرارداد شرکت الف را امضا کنیم", exclude: MEETING,
    });
    const q = calls[0]!;
    expect(q.params?.[0]).toBe(MEETING);
    /*
     * TWO, written out — not `MIN_SHARED_TERMS`.
     *
     * The first version read the constant, so the assertion moved with it:
     * changing the rule to one shared word left this test green, which is a
     * test comparing the code with itself. The floor is a PRODUCT decision
     * («a single word in common is a coincidence, not a topic») and a change
     * to it should have to come here and say so.
     */
    expect(q.params?.[2]).toBe(2);
    expect(MIN_SHARED_TERMS).toBe(2);
    /* the terms are the folded, filtered ones — a query built from the raw
       window would search for «را» and match every decision there is */
    expect(q.params?.[1]).toContain("قرارداد");
    expect(q.params?.[1]).not.toContain("را");
    /* an OR, not an AND: `websearch_to_tsquery` over a transcript window
       matches nothing at all, which is the version that ships and never fires */
    expect(q.sql).toContain("' | '");
    expect(q.sql).not.toContain("websearch_to_tsquery");
  });

  it("never recalls the meeting it is happening in", async () => {
    /* the decisions being made in this room reach the ledger within seconds,
       so without the exclusion the loudest hit is the meeting quoting itself */
    const { db, calls } = fakeDb([row()]);
    await createLiveRecallRepo(db).recall(IDENTITY, {
      window: "قرارداد شرکت الف", exclude: MEETING,
    });
    expect(calls[0]!.sql).toContain("i.meeting_id <> $1::uuid");
  });

  it("refuses a meeting id that is not one", async () => {
    const { db } = fakeDb();
    await expect(createLiveRecallRepo(db).recall(IDENTITY, {
      window: "قرارداد شرکت", exclude: "not-a-uuid",
    })).rejects.toThrow();
  });

  it("returns the decision with the count that earned it", async () => {
    const { db } = fakeDb([row({ shared: "3" })]);
    const [found] = await createLiveRecallRepo(db).recall(IDENTITY, {
      window: "قرارداد شرکت الف", exclude: MEETING,
    });
    expect(found?.body).toBe("قرارداد با شرکت الف امضا می‌شود");
    expect(found?.meeting_title).toBe("جلسهٔ مرداد");
    /* postgres counts return as strings through this driver, and a card that
       renders "3" from a number and nothing from a string is the shape that
       passes every unit test and shows an empty chip on production */
    expect(found?.shared).toBe(3);
    expect(found?.decided_at).toBe("2026-08-15T09:00:00.000Z");
  });

  it("asks for a handful, never a page", async () => {
    const { db, calls } = fakeDb([]);
    const repo = createLiveRecallRepo(db);
    await repo.recall(IDENTITY, { window: "قرارداد شرکت", exclude: MEETING });
    expect(calls[0]!.params?.[3]).toBe(3);
    /* a caller cannot turn a quiet card into a wall of them */
    await repo.recall(IDENTITY, { window: "قرارداد شرکت", exclude: MEETING, limit: 500 });
    expect(calls[1]!.params?.[3]).toBe(10);
  });
});
