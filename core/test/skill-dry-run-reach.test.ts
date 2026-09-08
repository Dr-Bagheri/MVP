import { describe, expect, it, vi } from "vitest";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * A DRY RUN GETS NO TOOLS.
 *
 * Its own file, because the assertion needs the RUNTIME rather than the
 * `runModel` seam — and that is the finding. `skill-dry-run.test.ts` opens by
 * calling this "the assertion this file exists for" and cannot make it: every
 * test there stubs the model call, so the tools argument is never handed to
 * anything that could be asked about it. A header that claims a check the
 * file does not perform is the most expensive kind of comment.
 *
 * So this one mocks the runtime itself and reads what the dry run asked it
 * for. A draft is a wording nobody has reviewed; the first thing it must not
 * be able to do is send a message, file a card or change a record.
 */

const run = vi.fn(async () => ({
  runId: "r-1", text: "ok", model: "openai/gpt-5-mini", steps: [], failed: false,
}));

vi.mock("../src/agent/runtime.ts", () => ({
  createAgentRuntime: () => ({ run }),
}));
vi.mock("../src/agent/run-store.ts", () => ({
  createAgentRunStore: () => ({}),
}));

const { createSkillDryRun } = await import("../src/api/skill-dry-run.ts");

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin", isActive: true,
};

function fakeDb() {
  const tx = {
    async unsafe() {
      return [{ preferred_model: "openai/gpt-5-mini", allowed_models: null }];
    },
  } as unknown as SqlTx;
  return {
    withIdentity: async <T,>(_i: unknown, fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withoutIdentity: async <T,>(fn: (t: SqlTx) => Promise<T>) => fn(tx),
    withActor: async <T,>(_a: string, fn: (t: SqlTx) => Promise<T>) => fn(tx),
  } as unknown as Db;
}

describe("a dry run's reach", () => {
  it("offers the model NO tools, and declares none on the draft", async () => {
    run.mockClear();
    await createSkillDryRun(fakeDb(), { apiKey: "k" }).dryRun(IDENTITY, {
      prompt: "روش پذیرش مشتری جدید", question: "مشتری تازه آمده",
    });
    const request = run.mock.calls[0]![0] as unknown as {
      tools: unknown[]; skill: { tools: string[]; id: string }; input: string;
    };
    /* BOTH halves: the runtime intersects a skill's declared tools with the
       offered set, so either one alone being empty would satisfy a version
       where the other is full — and only one of them is what a future author
       would reach for when a draft "needs" a tool */
    expect(request.tools).toEqual([]);
    expect(request.skill.tools).toEqual([]);
    /* and the draft is not attributed to a saved skill: a run carrying an id
       would put this answer against a row that may never hold these words */
    expect(request.skill.id).toBe("");
    expect(request.input).toBe("مشتری تازه آمده");
  });

  it("the control: the runtime really was called", async () => {
    /*
     * Without this, "no tools were offered" is equally true of a dry run that
     * never reached the runtime at all — which is exactly how the sibling
     * file's version of this assertion would have passed.
     */
    run.mockClear();
    await createSkillDryRun(fakeDb(), { apiKey: "k" }).dryRun(IDENTITY, {
      prompt: "p", question: "q",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
