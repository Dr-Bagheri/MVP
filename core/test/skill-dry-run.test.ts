import { describe, expect, it, vi } from "vitest";
import { createSkillDryRun } from "../src/api/skill-dry-run.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * Item 16 — trying a skill before anybody has to live with it.
 *
 * This file is about the run being a RUN: the right model off the ladder,
 * a refusal that names what is wrong, and nothing spent before one.
 *
 * THE REACH ASSERTION IS NOT HERE, and that is deliberate. Every test below
 * stubs the model call through `runModel`, so the tools argument is never
 * handed to anything that could be asked about it — a version of this header
 * claiming "a dry run gets no tools" would have been describing a check the
 * file cannot perform. It lives in `skill-dry-run-reach.test.ts`, which
 * mocks the runtime and reads what was actually offered.
 */

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin", isActive: true,
};

function fakeDb(row: Record<string, unknown> = { preferred_model: "openai/gpt-5-mini", allowed_models: null }) {
  const calls: { sql: string; params?: unknown[] | undefined }[] = [];
  const tx = {
    async unsafe(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return [row];
    },
  } as unknown as SqlTx;
  const db = {
    withIdentity: async <T,>(_i: unknown, fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withoutIdentity: async <T,>(fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withActor: async <T,>(_a: string, fn: (t: SqlTx) => Promise<T>) => fn(tx),
  } as unknown as Db;
  return { db, calls };
}

describe("trying a draft skill", () => {
  it("runs the DRAFT, not a saved row", async () => {
    const runModel = vi.fn(async () => ({ text: "پاسخ", runId: "r-1" }));
    const { db } = fakeDb();
    const out = await createSkillDryRun(db, { apiKey: "k", runModel }).dryRun(IDENTITY, {
      prompt: "روش پذیرش مشتری جدید را دنبال کن", question: "مشتری تازه آمده",
    });
    /* the text on the author's screen reaches the model — a version that
       looked the skill up by id would answer about the SAVED wording, which
       is the one question this route does not exist for */
    expect(runModel.mock.calls[0]![0].prompt).toContain("پذیرش مشتری");
    expect(runModel.mock.calls[0]![0].question).toBe("مشتری تازه آمده");
    expect(out.text).toBe("پاسخ");
    expect(out.run_id).toBe("r-1");
  });

  it("walks the model ladder rather than the raw preference", async () => {
    const runModel = vi.fn(async () => ({ text: "", runId: null }));
    /* a preference nobody typed that the product does not serve is NOT a
       rung (2026-08-29): the ladder falls through to the org's own list */
    const { db } = fakeDb({
      preferred_model: "anthropic/claude-opus-latest",
      allowed_models: ["openai/gpt-5-mini"],
    });
    await createSkillDryRun(db, { apiKey: "k", runModel }).dryRun(IDENTITY, {
      prompt: "p", question: "q",
    });
    expect(runModel.mock.calls[0]![0].model).toBe("openai/gpt-5-mini");
  });

  it("refuses an empty draft and an empty question, by name", async () => {
    const { db } = fakeDb();
    const repo = createSkillDryRun(db, { apiKey: "k", runModel: async () => ({ text: "", runId: null }) });
    await expect(repo.dryRun(IDENTITY, { prompt: "   ", question: "q" }))
      .rejects.toThrow(/prompt/i);
    await expect(repo.dryRun(IDENTITY, { prompt: "p", question: "" }))
      .rejects.toThrow(/question/i);
  });

  it("refuses a deployment with no provider key rather than sending an empty one", async () => {
    /* the alternative is a provider 401 nobody can act on — a missing floor
       is loud (rule 7), and «no model provider configured» names the thing
       an operator has to fix */
    const { db } = fakeDb();
    await expect(createSkillDryRun(db, {}).dryRun(IDENTITY, { prompt: "p", question: "q" }))
      .rejects.toThrow(/provider/i);
  });

  it("refuses a draft longer than a skill may be", async () => {
    const { db } = fakeDb();
    const repo = createSkillDryRun(db, { apiKey: "k", runModel: async () => ({ text: "", runId: null }) });
    await expect(repo.dryRun(IDENTITY, { prompt: "x".repeat(20_001), question: "q" }))
      .rejects.toThrow();
  });

  it("says no model is available rather than calling one that is not", async () => {
    const runModel = vi.fn(async () => ({ text: "", runId: null }));
    const { db } = fakeDb({ preferred_model: null, allowed_models: null });
    await expect(createSkillDryRun(db, { apiKey: "k", runModel }).dryRun(IDENTITY, {
      prompt: "p", question: "q",
    })).rejects.toThrow(/model/i);
    /* and the pair: nothing was called, so the refusal is before the spend */
    expect(runModel).not.toHaveBeenCalled();
  });
});
