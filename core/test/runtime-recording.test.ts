import { NO_TOOL_CALL_MARKER } from "../src/agent/runtime.ts";

// The marker is a shared constant so the harness and the producer cannot
// drift. That makes its CONTENT untestable by comparison — so assert the one
// property a shared constant can still lose: being there at all. An emptied
// marker would satisfy every `includes` check downstream.
/**
 * Invariant 5 (runs are replayable) and the in-band-error rule, exercised
 * through the real runtime with Pi stubbed at the one interface file.
 */
import { describe, expect, it, vi } from "vitest";

const runPiMock = vi.fn();
/*
 * The REAL `Type`, spread in from pi-ai (2026-09-03).
 *
 * `platform-tools.ts` and `delegation.ts` build their schemas at module load,
 * so a `Type: {}` stub throws "Type.String is not a function" before a single
 * test runs — and what that produces is a SUITE THAT WILL NOT LOAD, which
 * reads as the file being broken rather than as its mock being one line short.
 *
 * Imported INSIDE the factory because `vi.mock` is hoisted above every import
 * in the file: a top-level `Type` is not initialised when the factory runs
 * ("Cannot access __vi_import_1__ before initialization"). Only `runPi` needs
 * to be fake here; everything else is the genuine module.
 */
vi.mock("../src/agent/pi.ts", async () => ({
  ...await import("@earendil-works/pi-ai"),
  runPi: (...args: unknown[]) => runPiMock(...args),
}));

const { createAgentRuntime, InactiveActorError } = await import("../src/agent/runtime.ts");

if (NO_TOOL_CALL_MARKER.trim().length < 8) {
  throw new Error("the M21 decline marker is empty or trivial; every downstream check would pass vacuously");
}
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
    expect(summarizer.degraded).toMatch(new RegExp(NO_TOOL_CALL_MARKER));
    expect(withSkill.finished[0]).toMatchObject({ status: "ok" });
    expect((withSkill.finished[0] as { error: string }).error).toMatch(new RegExp(NO_TOOL_CALL_MARKER));

    // Same run without a tool-declaring skill: recorded, not surfaced.
    const plain = fakeStore();
    const chat = await createAgentRuntime({ runs: plain.store }).run({
      ...baseRequest, tools: [okTool as never],
    });
    expect(chat.degraded).toBeUndefined();
    expect((plain.finished[0] as { error: string }).error).toMatch(new RegExp(NO_TOOL_CALL_MARKER));
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

describe("web search and plural context (2026-08-18)", () => {
  it("web:true dispatches the :online variant — and records the id it actually called", async () => {
    const { store, begun } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "answer", model: "m", tokensIn: 1, tokensOut: 1 });

    await createAgentRuntime({ runs: store }).run({
      ...baseRequest, tools: [okTool as never], web: true,
    });

    const dispatched = (runPiMock.mock.calls[0]![0] as { model: { id: string } }).model.id;
    expect(dispatched).toBe("google/gemini-3.6-flash:online");
    // the record's job is what was actually called (invariant 4)
    expect(begun[0]).toMatchObject({ model: "google/gemini-3.6-flash:online" });
    expect((begun[0] as { request: { web?: boolean } }).request.web).toBe(true);
  });

  it("without the flag, NO suffix — a toggle nobody pressed must change nothing", async () => {
    const { store, begun } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "answer", model: "m", tokensIn: 1, tokensOut: 1 });

    await createAgentRuntime({ runs: store }).run({
      ...baseRequest, tools: [okTool as never],
    });

    const dispatched = (runPiMock.mock.calls[0]![0] as { model: { id: string } }).model.id;
    expect(dispatched).toBe("google/gemini-3.6-flash");
    expect((begun[0] as { request: { web?: boolean } }).request.web).toBeUndefined();
  });

  it("every attached call reaches the prompt — the wire used to truncate to the first", async () => {
    const { store, begun } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "answer", model: "m", tokensIn: 1, tokensOut: 1 });

    await createAgentRuntime({ runs: store }).run({
      ...baseRequest, tools: [okTool as never], callIds: ["call-a", "call-b"],
    });

    const prompt = (runPiMock.mock.calls[0]![0] as { systemPrompt: string }).systemPrompt;
    expect(prompt).toContain("call-a");
    expect(prompt).toContain("call-b");
    // the row's link stays singular (composite FK, purge semantics): first id
    expect(begun[0]).toMatchObject({ callId: "call-a" });
    // the full list is in the replayable record
    expect((begun[0] as { request: { callIds?: string[] } }).request.callIds).toEqual([
      "call-a", "call-b",
    ]);
  });

  it("a single attached call keeps the exact singular sentence — no plural drift", async () => {
    const { store, begun } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "answer", model: "m", tokensIn: 1, tokensOut: 1 });

    await createAgentRuntime({ runs: store }).run({
      ...baseRequest, tools: [okTool as never], callIds: ["call-a"],
    });

    const prompt = (runPiMock.mock.calls[0]![0] as { systemPrompt: string }).systemPrompt;
    expect(prompt).toContain("شناسهٔ تماسِ در حال بحث: call-a");
    // one call = no callIds list in the record; the row's call_id carries it
    expect((begun[0] as { request: { callIds?: string[] } }).request.callIds).toBeUndefined();
    expect(begun[0]).toMatchObject({ callId: "call-a" });
  });
});
