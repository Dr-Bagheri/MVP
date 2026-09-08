import { describe, expect, it } from "vitest";
import { createSkillAuthoring } from "../src/api/skills.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * A skill's history (item 16, db/0215).
 *
 * The database owns the hard half — who may read a version, and that nobody
 * may write one; `db/test/123` walks that matrix. What this file asserts is
 * the two things the READ decides, because a history is only useful if it
 * arrives in the order somebody reads it and says who wrote each line.
 */

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin", isActive: true,
};
const SKILL = "33333333-3333-4333-8333-333333333333";

function fakeDb(rows: Record<string, unknown>[]) {
  const calls: { sql: string; params?: unknown[] | undefined }[] = [];
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

const version = (over: Record<string, unknown> = {}) => ({
  id: "v-2", version: 2, name: "روش پذیرش", description: "",
  prompt: "نسخهٔ دو", model: null, tools: [],
  created_at: new Date("2026-09-08T09:00:00Z"),
  created_by: "11111111-1111-4111-8111-111111111111",
  created_by_name: "علی", ...over,
});

describe("a skill's history", () => {
  it("arrives newest first, because that is the one somebody is looking at", async () => {
    const { db, calls } = fakeDb([version()]);
    await createSkillAuthoring(db).versions(IDENTITY, SKILL);
    /* asserted in the QUERY: the screen marks row 0 as «نسخهٔ فعلی», so an
       ascending read would label the oldest wording as the live one — a
       screen that is confidently wrong rather than empty */
    expect(calls[0]!.sql).toContain("order by v.version desc");
    expect(calls[0]!.params?.[0]).toBe(SKILL);
  });

  it("carries the prompt, which is the whole point of the screen", async () => {
    const { db } = fakeDb([version()]);
    const [row] = await createSkillAuthoring(db).versions(IDENTITY, SKILL);
    /* a list of dates with no text is a history nobody can read, and the
       author is already looking at this skill's current prompt — there is
       nothing withheld by withholding the old ones */
    expect(row?.prompt).toBe("نسخهٔ دو");
    expect(row?.version).toBe(2);
    expect(row?.created_at).toBe("2026-09-08T09:00:00.000Z");
  });

  it("says PLATFORM rather than naming somebody who never touched it", async () => {
    /* a shipped skill's version 1 was written by a migration; `created_by` is
       null there, which is M15's spelling for "the vendor did this". A screen
       that filled it with the reader's own name — or with the skill's
       owner — would be attributing a wording to a person who did not write it */
    const { db } = fakeDb([version({ created_by: null, created_by_name: null })]);
    const [row] = await createSkillAuthoring(db).versions(IDENTITY, SKILL);
    expect(row?.created_by).toBeNull();
    expect(row?.created_by_name).toBeNull();
  });

  it("refuses a skill id that is not one", async () => {
    const { db } = fakeDb([]);
    await expect(createSkillAuthoring(db).versions(IDENTITY, "not-a-uuid")).rejects.toThrow();
  });

  it("an unreadable skill is an empty history, not an error", async () => {
    /* the read policy answers nothing for a skill the caller cannot see, and
       that is the same nothing the skill itself gives them — inventing a 404
       here would tell a stranger whether an id exists */
    const { db } = fakeDb([]);
    expect(await createSkillAuthoring(db).versions(IDENTITY, SKILL)).toEqual([]);
  });
});
