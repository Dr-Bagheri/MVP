/**
 * The summarizer with a FAKE MODEL (2026-09-08): the prior-meeting block the
 * step built must reach BOTH runs — the writer's prompt and the grounding
 * verifier's — and the verifier's prompt must carry the rule that the block
 * counts as source. Half of this feature is the block being present; the
 * other half is the verifier not penalising the summary for using it, and
 * the second half is invisible unless the grounding input is read.
 *
 * The runtime is replaced whole: this test is about what the summarizer
 * ASKS the runtime, and a recorded run would need a database.
 */
import { describe, expect, it, vi } from "vitest";

const runs: { kind: string; input: string; tools: unknown[] }[] = [];

vi.mock("../src/agent/run-store.ts", () => ({ createAgentRunStore: () => ({}) }));
vi.mock("../src/agent/runtime.ts", () => ({
  createAgentRuntime: () => ({
    async run(request: { kind: string; input: string; tools: unknown[] }) {
      runs.push({ kind: request.kind, input: request.input, tools: request.tools });
      // the first run is the summary, the second the verdict
      const text = runs.length === 1 ? "خلاصه: طبق توافق جلسهٔ «بازبینی سیمرغ» در تاریخ 2026-08-20 …" : '{"clean":true}';
      return { text, model: "fake/model", runId: "66666666-6666-4666-8666-666666666666", failed: false };
    },
  }),
}));

const { createSummarizer, formatPriorMeetingsBlock, GROUNDING_PRIOR_RULE, PRIOR_MEETINGS_OPEN } = await import("../src/worker/summarizer.ts");
import type { Skill } from "../src/agent/types.ts";
import type { MeetingsRepo } from "../src/api/meetings.ts";

/*
 * 0211's extraction pass is REQUIRED wiring on the summarizer, and this file is
 * about the two PROMPTS. A call with no meeting lands its claims nowhere and —
 * since 2026-09-10, deliberately — spends no model run finding that out, so
 * `runs` stays exactly the writer and the verifier. A stub that answered with a
 * meeting id would add a third run here and every count below would be off by
 * one for a reason that has nothing to do with prior context.
 */
const noMeeting = { meetingIdForCall: async () => null } as unknown as MeetingsRepo;

const identity = { userId: "11111111-1111-4111-8111-111111111111", orgId: "org", role: "member" as const, isActive: true };
const skill = {
  id: "sk", level: "system", slug: "summarizer", name: "s", description: "", prompt: "p",
  model: "fake/model", tools: [], enabled: true,
} as unknown as Skill;

describe("createSummarizer with prior-meeting context", () => {
  it("hands the SAME fenced block to the writer and to the grounding verifier, with the verifier's rule", async () => {
    runs.length = 0;
    const block = formatPriorMeetingsBlock([{
      title: "بازبینی سیمرغ", started_at: "2026-08-20T10:00:00.000Z",
      terms: ["سیمرغ"], snippets: ["چک‌لیست سیمرغ"], summary: "سیمرغ نام رمزی پروژهٔ مهاجرت است.",
    }])!;
    const summarizer = createSummarizer({
      db: {} as never, resolveSkill: async () => skill, deps: {}, apiKey: "k", meetings: noMeeting,
    });

    const result = await summarizer.summarize({
      identity, callId: "22222222-2222-4222-8222-222222222222",
      transcript: "سینا: ادامهٔ چک‌لیست سیمرغ", verify: true, priorMeetings: block,
    });

    expect(result.skipped).toBeFalsy();
    expect(runs).toHaveLength(2);
    const [writer, verifier] = runs;
    expect(writer!.input).toContain(block);
    expect(verifier!.input).toContain(block);
    expect(verifier!.input).toContain(GROUNDING_PRIOR_RULE);
    // the verifier keeps its no-tools posture — it reads, it never searches
    expect(verifier!.tools).toEqual([]);
    // and the verdict lands, so a block-aware verifier is the one recorded
    expect(!result.skipped && result.grounding).toEqual({ clean: true, flags: [], model: "fake/model" });
  });

  it("with no block, neither prompt carries the fence or the rule (the control)", async () => {
    runs.length = 0;
    const summarizer = createSummarizer({
      db: {} as never, resolveSkill: async () => skill, deps: {}, apiKey: "k", meetings: noMeeting,
    });
    await summarizer.summarize({
      identity, callId: "22222222-2222-4222-8222-222222222222", transcript: "سلام", verify: true,
    });
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.input).not.toContain(PRIOR_MEETINGS_OPEN);
      expect(run.input).not.toContain(GROUNDING_PRIOR_RULE);
    }
  });
});
