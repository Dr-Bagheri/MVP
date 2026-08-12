/**
 * The database behind SkillSource. Precedence itself is tested in the pure
 * layer (skills.ts); this covers what only the store can get wrong — the
 * columns it selects, what it filters, and what it refuses to put on the wire.
 */
import { describe, expect, it } from "vitest";

import {
  createNamedSkillResolver, createResolveSkill, createSkillStore,
  createSummarizerResolver, getSkill, listResolvedSkills,
  MissingSystemSkillError, SUMMARIZER_SLUG,
} from "../src/agent/skill-store.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

const skillRow = (over: Record<string, unknown> = {}) => ({
  id: "s1", level: "system", slug: "summarizer", name: "خلاصه‌ساز",
  description: "", prompt: "شما خلاصه‌ساز هستید", model: null,
  tools: ["search_transcripts", "read_window"], enabled: true,
  max_tool_calls: null, ...over,
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

const queries = (log: { sql: string }[]) =>
  log.filter((l) => {
    const sql = l.sql.trim().toLowerCase();
    return !sql.startsWith("set local") && !sql.includes("set_config('echo.actor_id'");
  });

describe("what the store selects", () => {
  it("selects only columns echo.skill actually has", async () => {
    // This list is pinned because it was wrong once: `max_tool_calls` was in
    // the SELECT on the strength of `Skill.maxToolCalls` existing in
    // types.ts, while information_schema said the column did not exist. It
    // would have been 42703 on the first real lookup, with no fake
    // objecting. (The column landed later as db/0025, once the steward
    // actually ruled it — which is why it is back in the list now.)
    const { db, log } = fakeDb(() => [skillRow()]);
    await createSkillStore(db).listVisible(IDENTITY);
    const sql = queries(log)[0]!.sql;
    for (const column of [
      "id", "level", "slug", "name", "description", "prompt", "model",
      "tools", "enabled", "max_tool_calls",
    ]) {
      expect(sql, column).toContain(column);
    }
  });

  it("reads the per-skill ceiling, and keeps NULL as inherit-the-default", async () => {
    // db/0025. NULL means inherit DEFAULT_MAX_TOOL_CALLS, not "unlimited" —
    // a skill that says nothing should inherit a ceiling, not escape one.
    // runtime.ts's `request ?? skill ?? DEFAULT` makes that true by
    // construction, so nothing here needs to check for it.
    const { db } = fakeDb(() => [skillRow({ max_tool_calls: 6 })]);
    const [pinned] = await createSkillStore(db).listVisible(IDENTITY);
    expect(pinned!.maxToolCalls).toBe(6);

    const { db: db2 } = fakeDb(() => [skillRow({ max_tool_calls: null })]);
    const [inherited] = await createSkillStore(db2).listVisible(IDENTITY);
    expect(inherited!.maxToolCalls).toBeNull();
  });

  it("keeps a null model null — M5 imposes no default", async () => {
    // Coercing this to a string here would invent a product policy that the
    // architecture explicitly declines to have.
    const { db } = fakeDb(() => [skillRow({ model: null })]);
    const [skill] = await createSkillStore(db).listVisible(IDENTITY);
    expect(skill!.model).toBeNull();
  });

  it("filters archived AND disabled, which are different acts", async () => {
    // Disabling an org override correctly falls back to the system skill
    // beneath it; archiving means gone, and must not resolve at all.
    const { db, log } = fakeDb(() => [skillRow()]);
    await createSkillStore(db).listVisible(IDENTITY);
    const sql = queries(log)[0]!.sql;
    expect(sql).toContain("enabled");
    expect(sql).toContain("archived_at is null");
  });

  it("does not re-implement visibility — that is db/0013's skill_read", async () => {
    const { db, log } = fakeDb(() => [skillRow()]);
    await createSkillStore(db).listVisible(IDENTITY);
    const sql = queries(log)[0]!.sql;
    expect(sql).not.toContain("org_id =");
    expect(sql).not.toContain("user_id =");
  });
});

describe("tools column", () => {
  it("drops non-string entries rather than passing undefined to the wall", async () => {
    // A non-string would arrive at the tool wall as `undefined` and quietly
    // widen or narrow what the skill may call. One bad element costs one
    // tool, not the skill.
    const { db } = fakeDb(() => [skillRow({ tools: ["read_window", 42, null, "get_call"] })]);
    const [skill] = await createSkillStore(db).listVisible(IDENTITY);
    expect(skill!.tools).toEqual(["read_window", "get_call"]);
  });

  it("treats a non-array as no tools at all", async () => {
    const { db } = fakeDb(() => [skillRow({ tools: null })]);
    const [skill] = await createSkillStore(db).listVisible(IDENTITY);
    expect(skill!.tools).toEqual([]);
  });
});

describe("resolution through the store", () => {
  it("gives the org override, not the system skill beneath it", async () => {
    const { db } = fakeDb(() => [
      skillRow(),
      skillRow({ id: "s2", level: "org", name: "خلاصه‌ساز سازمان", prompt: "org" }),
    ]);
    const skill = await createResolveSkill(db)(IDENTITY, "summarizer");
    expect(skill?.id).toBe("s2");
    expect(skill?.level).toBe("org");
  });

  it("returns undefined for a slug the caller cannot see", async () => {
    const { db } = fakeDb(() => []);
    expect(await createResolveSkill(db)(IDENTITY, "nope")).toBeUndefined();
  });

  it("lists each slug ONCE, under the winning level's wording", async () => {
    const { db } = fakeDb(() => [
      skillRow(),
      skillRow({ id: "s2", level: "org", name: "خلاصه‌ساز سازمان" }),
      skillRow({ id: "s3", slug: "translator", name: "مترجم" }),
    ]);
    const skills = await listResolvedSkills(db, IDENTITY);
    expect(skills).toHaveLength(2);
    expect(skills.find((s) => s.slug === "summarizer")!.name).toBe("خلاصه‌ساز سازمان");
  });
});

describe("the worker's summarizer resolver", () => {
  it("takes an identity only, and resolves the shipped slug", async () => {
    // The pipeline has no slug to pass — it always wants the summarizer — so
    // the specialisation lives next to the slug rather than as a lambda in
    // the worker's wiring, where the string would be invisible.
    const { db } = fakeDb(() => [skillRow()]);
    const skill = await createSummarizerResolver(db)(IDENTITY);
    expect(skill?.slug).toBe(SUMMARIZER_SLUG);
    expect(SUMMARIZER_SLUG).toBe("summarizer");
  });
});

describe("a missing FLOOR is loud (steward: rule 7 corollary)", () => {
  /**
   * These drive the REAL store and the REAL resolution ladder. The db returns
   * genuine skill rows for other slugs, so the miss emerges from resolution
   * over real-shaped data rather than from a stub that returns undefined by
   * construction — a fake resolver proving a fake miss would be exactly the
   * self-satisfying test rule 9 forbids.
   */
  it("throws when the summarizer does not resolve, instead of falling back", async () => {
    // The silent version generated summaries WITHOUT the shipped
    // anti-fabrication prompt and said nothing. They looked fine, which is
    // the problem.
    const { db } = fakeDb(() => [skillRow({ id: "s9", slug: "translator", name: "مترجم" })]);
    await expect(createSummarizerResolver(db)(IDENTITY))
      .rejects.toBeInstanceOf(MissingSystemSkillError);
  });

  it("names BOTH causes, because the second one bit me", async () => {
    // I read this as a missing seed. The row had been there since 0015 — my
    // actor was not an app_user row, and db/0018 gates system skills behind
    // actor_is_active(), so an invalid identity sees no skills at all.
    const { db } = fakeDb(() => []);
    const error = await createSummarizerResolver(db)(IDENTITY).catch((e: Error) => e);
    expect((error as Error).message).toContain("seed");
    expect((error as Error).message).toContain("active member");
  });

  it("is fatal for a SYSTEM slug through the api resolver too", async () => {
    const { db } = fakeDb(() => []);
    await expect(createNamedSkillResolver(db)(IDENTITY, SUMMARIZER_SLUG))
      .rejects.toBeInstanceOf(MissingSystemSkillError);
  });

  it("still answers undefined for a slug the caller invented", async () => {
    // A user-typed slug that isn't there is a 400 — the caller asked for
    // something absent. Conflating it with a broken seed would hand the user
    // a validation error for our fault.
    const { db } = fakeDb(() => [skillRow()]);
    expect(await createNamedSkillResolver(db)(IDENTITY, "no-such-skill")).toBeUndefined();
  });

  it("lets an ORG override fall through to the system skill — the ladder working", async () => {
    // Only the FLOOR is loud. A disabled org override must still resolve to
    // the system skill beneath it, silently and correctly.
    const { db } = fakeDb(() => [
      skillRow(),
      skillRow({ id: "s2", level: "org", enabled: false, name: "غیرفعال" }),
    ]);
    const skill = await createSummarizerResolver(db)(IDENTITY);
    expect(skill?.level).toBe("system");
  });
});

describe("read by id is the replay surface", () => {
  it("still returns an ARCHIVED skill — a past run must stay explainable", async () => {
    // invariant 5 is about what happened, not about what is currently offered
    const { db, log } = fakeDb(() => [skillRow()]);
    const skill = await getSkill(db, IDENTITY, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
    expect(skill?.slug).toBe("summarizer");
    expect(queries(log)[0]!.sql).not.toContain("archived_at is null");
  });

  it("validates the id before touching the database", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(getSkill(db, IDENTITY, "'; drop table echo.skill; --"))
      .rejects.toThrow(/invalid skill id/);
    expect(log).toHaveLength(0);
  });
});
