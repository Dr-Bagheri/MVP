/**
 * Skill authoring (M29). The db suite walks the WALL (12_skill_crud.sql);
 * these pin this layer's own judgement — the vocabulary refusals and the
 * supplied-flag patch shape, the two things that fail silently when wrong:
 * a typo'd tool sits in a list forever never firing, and a coalesce-style
 * patch makes clearing a model pin impossible while every save reports
 * success.
 */
import { describe, expect, it } from "vitest";

import { ConflictError, NotActivatedError, ValidationError } from "../src/api/errors.ts";
import { availableTools, createSkillAuthoring } from "../src/api/skills.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ADMIN: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};
const MEMBER: Identity = { ...ADMIN, role: "member" };

const ROW = {
  id: "33333333-3333-4333-8333-333333333333", level: "org", slug: "recap",
  name: "جمع‌بندی", description: "", prompt: "خلاصه کن", model: null,
  tools: [], starter_questions: [], enabled: true, max_tool_calls: null,
  archived_at: null, created_at: new Date("2026-08-01T00:00:00Z"),
};

function fakeDb(fail?: { code: string }) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (fail && /insert into echo\.skill|update echo\.skill/.test(sql)) {
          throw Object.assign(new Error("db refusal"), fail);
        }
        return sql.includes("set local") || sql.includes("set_config") ? [] : [ROW];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

describe("the tool vocabulary is derived and closed", () => {
  it("carries both registries — a write tool is author-attachable", () => {
    expect(availableTools()).toContain("search_transcripts");
    expect(availableTools()).toContain("correct_transcript");
  });

  it("refuses an unknown tool at the door, naming it", async () => {
    const { db } = fakeDb();
    await expect(
      createSkillAuthoring(db).create(ADMIN, {
        level: "org", slug: "x", name: "x", prompt: "x",
        tools: ["search_transcripts", "launch_missiles"],
      }),
    ).rejects.toMatchObject({ code: "unknown_tools", params: { tools: "launch_missiles" } });
  });
});

describe("who may author what", () => {
  it("a member creating an org skill gets a sentence, not a bare 42501", async () => {
    const { db } = fakeDb();
    await expect(
      createSkillAuthoring(db).create(MEMBER, { level: "org", slug: "x", name: "x", prompt: "x" }),
    ).rejects.toBeInstanceOf(NotActivatedError);
  });

  it("system is not a caller-mintable level — the floor is a deployment fact", async () => {
    const { db } = fakeDb();
    await expect(
      createSkillAuthoring(db).create(ADMIN, {
        level: "system" as never, slug: "x", name: "x", prompt: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("a member authors their own user skill", async () => {
    const { db, log } = fakeDb();
    await createSkillAuthoring(db).create(MEMBER, {
      level: "user", slug: "my-notes", name: "یادداشت", prompt: "کوتاه",
    });
    const insert = log.find((l) => l.sql.includes("insert into echo.skill"))!;
    // user_id travels for a user-level row; the wall checks it again
    expect(insert.params![2]).toBe(MEMBER.userId);
  });
});

describe("the patch is supplied-flag, not coalesce", () => {
  it("clearing the model pin back to caller's-choice is expressible", async () => {
    const { db, log } = fakeDb();
    await createSkillAuthoring(db).update(ADMIN, ROW.id, { model: null });
    const update = log.find((l) => l.sql.includes("update echo.skill"))!;
    // [$8 supplied, $9 value] — model supplied as null means CLEAR the pin
    expect(update.params![7]).toBe(true);
    expect(update.params![8]).toBeNull();
    // name untouched
    expect(update.params![1]).toBe(false);
  });

  it("an empty patch is refused rather than a no-op write", async () => {
    const { db } = fakeDb();
    await expect(createSkillAuthoring(db).update(ADMIN, ROW.id, {}))
      .rejects.toMatchObject({ code: "nothing_to_update" });
  });
});

describe("slug collisions get a named sentence", () => {
  it("create on a taken slug is a conflict carrying the slug", async () => {
    const { db } = fakeDb({ code: "23505" });
    await expect(
      createSkillAuthoring(db).create(ADMIN, { level: "org", slug: "recap", name: "x", prompt: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("unarchive into a re-used slug names the succession problem", async () => {
    const { db } = fakeDb({ code: "23505" });
    await expect(createSkillAuthoring(db).setArchived(ADMIN, ROW.id, false))
      .rejects.toMatchObject({ code: "slug_taken_by_successor" });
  });
});
