/**
 * Invariant 5 (runs are replayable) and the in-band-error rule, exercised
 * through the real runtime with Pi stubbed at the one interface file.
 */
import { describe, expect, it, vi } from "vitest";

const runPiMock = vi.fn();
vi.mock("../src/agent/pi.ts", () => ({
  runPi: (...args: unknown[]) => runPiMock(...args),
  Type: {},
}));

const { createAgentRuntime, InactiveActorError } = await import("../src/agent/runtime.ts");
const { ToolDenied } = await import("../src/agent/tools.ts");
import type { AgentRunStore, AgentStep, Identity, Skill } from "../src/agent/types.ts";

const ACTIVE: Identity = { userId: "u1", orgId: "org-a", role: "member", isActive: true };

function fakeStore() {
  const begun: unknown[] = [];
  const steps: AgentStep[] = [];
  const finished: unknown[] = [];
  const store: AgentRunStore = {
    async begin(run) { begun.push(run); return "run-1"; },
    async appendStep(_id, step) { steps.push(step); },
    async finish(_id, outcome) { finished.push(outcome); },
  };
  return { store, begun, steps, finished };
}

const okTool = {
  name: "read_call", label: "r", description: "", parameters: {},
  async run() { return "content"; },
};

const baseRequest = {
  identity: ACTIVE,
  kind: "assistant" as const,
  callerModel: "google/gemini-3.6-flash",
  input: "question",
  deps: {},
};

describe("agent runtime — recording and failure surfacing", () => {
  it("records the run before any provider contact, and finishes it", async () => {
    const { store, begun, finished } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "answer", model: "m", tokensIn: 10, tokensOut: 5 });

    const result = await createAgentRuntime({ runs: store }).run({
      ...baseRequest, tools: [okTool as never],
    });

    expect(begun).toHaveLength(1);
    expect(begun[0]).toMatchObject({
      orgId: "org-a", actorId: "u1", kind: "assistant", model: "google/gemini-3.6-flash",
    });
    // the request is captured for replay (invariant 5)
    expect((begun[0] as { request: { tools: string[] } }).request.tools).toEqual(["read_call"]);
    // "ok"/"error" are echo.agent_run_status's own labels — the TS union used
    // to say succeeded/failed and no database ever accepted either
    expect(finished[0]).toMatchObject({ status: "ok", tokensIn: 10, tokensOut: 5 });
    expect(result.failed).toBe(false);
    expect(result.text).toBe("answer");
  });

  it("treats an in-band provider error as a FAILURE, not an empty answer", async () => {
    // the spike's sharpest finding: pi returns normally with stopReason:error
    const { store, finished } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({
      text: "", model: "m", tokensIn: null, tokensOut: null,
      error: "400 Reasoning is mandatory for this endpoint",
    });

    const result = await createAgentRuntime({ runs: store }).run({ ...baseRequest, tools: [] });

    expect(result.failed).toBe(true);
    expect(result.error).toContain("Reasoning is mandatory");
    expect(finished[0]).toMatchObject({ status: "error" });
  });

  it("records a failed run when the provider call rejects", async () => {
    const { store, finished } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockImplementation(() => Promise.reject(new Error("network down")));

    const result = await createAgentRuntime({ runs: store }).run({
      ...baseRequest, kind: "summarizer", tools: [],
    });

    expect(result.failed).toBe(true);
    expect(result.error).toBe("network down");
    expect(finished[0]).toMatchObject({ status: "error", error: "network down" });
  });

  it("records 'no tool called' on every run but SURFACES it only for a tool skill", async () => {
    // Steward calibration: signal on a summarizer, which SPEC says reads
    // earlier calls before it writes; noise on a chat question the model can
    // answer from context. A marker that appears on most runs becomes
    // wallpaper, and the one time it matters nobody looks.
    //
    // So the audit records uniformly — it should not decide what is
    // interesting — and `degraded`, which is what a consumer renders, is set
    // only when a skill asked for tools and got no use from them.
    const withSkill = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "خلاصه", model: "m", tokensIn: 5, tokensOut: 5 });
    const summarizer = await createAgentRuntime({ runs: withSkill.store }).run({
      ...baseRequest,
      tools: [okTool as never],
      skill: { id: "s1", level: "system", slug: "summarizer", name: "خلاصه‌ساز",
               description: "", prompt: "p", model: null, tools: ["read_call"],
               enabled: true, maxToolCalls: null },
    });
    expect(summarizer.degraded).toMatch(/no tool was called/);
    expect(withSkill.finished[0]).toMatchObject({ status: "ok" });
    expect((withSkill.finished[0] as { error: string }).error).toMatch(/no tool was called/);

    // Same run without a tool-declaring skill: recorded, not surfaced.
    const plain = fakeStore();
    const chat = await createAgentRuntime({ runs: plain.store }).run({
      ...baseRequest, tools: [okTool as never],
    });
    expect(chat.degraded).toBeUndefined();
    expect((plain.finished[0] as { error: string }).error).toMatch(/no tool was called/);
  });

  it("does not mark a run degraded when a tool WAS used", async () => {
    const { store, finished } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockImplementation(async (options: {
      tools: { execute: (id: string, args: unknown) => Promise<unknown> }[];
    }) => {
      await options.tools[0]!.execute("t1", {});
      return { text: "پاسخ", model: "m", tokensIn: 5, tokensOut: 5 };
    });
    const result = await createAgentRuntime({ runs: store }).run({
      ...baseRequest, tools: [okTool as never],
    });
    expect(result.degraded).toBeUndefined();
    expect((finished[0] as { error: string | null }).error).toBeNull();
  });

  it("refuses to run for an inactive actor — nothing recorded, nothing spent", async () => {
    const { store, begun } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "", model: "m", tokensIn: null, tokensOut: null });

    await expect(createAgentRuntime({ runs: store }).run({
      ...baseRequest, identity: { ...ACTIVE, isActive: false }, tools: [],
    })).rejects.toBeInstanceOf(InactiveActorError);

    expect(begun).toHaveLength(0);
    expect(runPiMock).not.toHaveBeenCalled();
  });

  it("appends every tool step in order, including denials", async () => {
    const { store, steps } = fakeStore();
    const denying = {
      name: "read_call", label: "r", description: "", parameters: {},
      async run() { throw new ToolDenied("call not found"); },
    };
    runPiMock.mockReset();
    // drive the wrapped tools the way Pi's loop would
    runPiMock.mockImplementation(async (options: { tools: { execute: (id: string, args: unknown) => Promise<unknown> }[] }) => {
      const tools = options.tools;
      await tools[0]!.execute("t1", { call_id: "c1" });
      await tools[0]!.execute("t2", { call_id: "c2" });
      return { text: "done", model: "m", tokensIn: null, tokensOut: null };
    });

    const result = await createAgentRuntime({ runs: store }).run({
      ...baseRequest, tools: [denying as never],
    });

    expect(steps.map((s) => [s.seq, s.outcome])).toEqual([[0, "denied"], [1, "denied"]]);
    expect(result.steps).toHaveLength(2);
    expect(result.failed).toBe(false);
  });

  it("passes the skill's prompt, model pin and tool list into the run", async () => {
    const { store, begun } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "x", model: "pinned-model", tokensIn: null, tokensOut: null });
    const skill: Skill = {
      id: "s1", level: "org", slug: "summarize", name: "Summarize", description: "",
      prompt: "PINNED PROMPT", model: "pinned-model", tools: ["read_call"], enabled: true,
    };

    await createAgentRuntime({ runs: store }).run({
      ...baseRequest, kind: "summarizer", skill, tools: [okTool as never],
    });

    const passed = runPiMock.mock.calls[0]![0] as { systemPrompt: string; model: { id: string } };
    expect(passed.systemPrompt).toBe("PINNED PROMPT");
    expect(passed.model.id).toBe("pinned-model");
    expect(begun[0]).toMatchObject({ skillId: "s1", model: "pinned-model" });
  });

  it("assistant and summarizer are the same runtime, different toolsets (M4)", async () => {
    const { store } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "x", model: "m", tokensIn: null, tokensOut: null });
    const runtime = createAgentRuntime({ runs: store });

    await runtime.run({ ...baseRequest, kind: "assistant", tools: [okTool as never] });
    await runtime.run({ ...baseRequest, kind: "summarizer", tools: [] });

    const first = runPiMock.mock.calls[0]![0] as { tools: unknown[] };
    const second = runPiMock.mock.calls[1]![0] as { tools: unknown[] };
    expect(first.tools).toHaveLength(1);
    expect(second.tools).toHaveLength(0);
  });
});
