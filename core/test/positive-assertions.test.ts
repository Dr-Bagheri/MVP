/**
 * CLAUDE.md rule 7 / M19 — POSITIVE assertions on the model path.
 *
 * Why this file exists: Backend 2's VAD shipped subtly wrong with a green
 * suite because every assertion was negative ("finds nothing in silence"),
 * and a component returning ~0 for everything satisfies those perfectly. The
 * same trap is available to me: my wall tests all assert that things are
 * REFUSED. A runtime that answered "" to everything would pass them all.
 *
 * So: prove that a normal run produces real content and that a tool result
 * actually reaches the answer — and that an empty-but-well-formed response
 * fails loudly instead of passing quietly.
 *
 * The live-lane half runs only with ECHO_LIVE_TEST=1 and a key present
 * (network + spend), but it is the same runtime, not a parallel path.
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

const { createAgentRuntime } = await import("../src/agent/runtime.ts");
import type { AgentRunStore, AgentStep, Identity } from "../src/agent/types.ts";

const ACTIVE: Identity = { userId: "u1", orgId: "org-a", role: "member", isActive: true };

function fakeStore() {
  const steps: AgentStep[] = [];
  const finished: { status: string; error?: string | null }[] = [];
  const store: AgentRunStore = {
    async begin() { return "run-1"; },
    async appendStep(_id, step) { steps.push(step); },
    async finish(_id, outcome) { finished.push(outcome); },
  };
  return { store, steps, finished };
}

const readCall = {
  name: "read_call", label: "Read call", description: "",
  parameters: {},
  async run() { return "بودجه بازاریابی بیست درصد افزایش یافت"; },
};

const base = {
  identity: ACTIVE,
  kind: "assistant" as const,
  callerModel: "google/gemini-3.6-flash",
  input: "چه تصمیمی درباره بودجه گرفتیم؟",
  deps: {},
};

describe("positive assertions — the run actually produces something", () => {
  it("a normal run returns real content and succeeds", async () => {
    const { store, finished } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({
      text: "بودجه بازاریابی بیست درصد افزایش یافت.",
      model: "m", tokensIn: 40, tokensOut: 12,
    });

    const result = await createAgentRuntime({ runs: store }).run({ ...base, tools: [] });

    // POSITIVE: content present, not merely "no error"
    expect(result.failed).toBe(false);
    expect(result.text.length).toBeGreaterThan(10);
    expect(result.text).toContain("بودجه");
    expect(finished[0]).toMatchObject({ status: "ok" });
  });

  it("a tool result actually reaches the model and the answer", async () => {
    const { store, steps } = fakeStore();
    runPiMock.mockReset();
    // drive the wrapped tool the way Pi would, then answer FROM its result
    runPiMock.mockImplementation(async (options: {
      tools: { execute: (id: string, args: unknown) => Promise<{ content: { text: string }[] }> }[];
    }) => {
      const toolResult = await options.tools[0]!.execute("t1", { call_id: "c1" });
      const observed = toolResult.content[0]!.text;
      return { text: `بر اساس رونوشت: ${observed}`, model: "m", tokensIn: 50, tokensOut: 20 };
    });

    const result = await createAgentRuntime({ runs: store }).run({
      ...base, tools: [readCall as never],
    });

    // POSITIVE: the tool ran, succeeded, and its data is in the answer
    expect(steps).toHaveLength(1);
    expect(steps[0]!.outcome).toBe("ok");
    expect(result.failed).toBe(false);
    expect(result.text).toContain("بیست درصد");
  });

  it("an EMPTY but well-formed response fails loudly (rule 7)", async () => {
    const { store, finished } = fakeStore();
    runPiMock.mockReset();
    // no error, no exception, stopReason normal — just nothing said
    runPiMock.mockResolvedValue({ text: "", model: "m", tokensIn: 30, tokensOut: 0 });

    const result = await createAgentRuntime({ runs: store }).run({ ...base, tools: [] });

    expect(result.failed).toBe(true);
    expect(result.error).toMatch(/empty response/);
    expect(finished[0]).toMatchObject({ status: "error" });
  });

  it("whitespace-only counts as empty", async () => {
    const { store } = fakeStore();
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "  \n\t ", model: "m", tokensIn: 1, tokensOut: 1 });
    const result = await createAgentRuntime({ runs: store }).run({ ...base, tools: [] });
    expect(result.failed).toBe(true);
  });
});

/**
 * Live lane — same runtime, real provider, real tool. Opt-in because it
 * costs money and needs network:
 *   ECHO_LIVE_TEST=1 OPENROUTER_API_KEY=… pnpm test
 */
const live = process.env.ECHO_LIVE_TEST === "1" && Boolean(process.env.OPENROUTER_API_KEY);

describe.runIf(live)("live lane (opt-in)", () => {
  it("really calls a tool and answers from its data", async () => {
    vi.doUnmock("../src/agent/pi.ts");
    vi.resetModules();
    const { createAgentRuntime: realRuntime } = await import("../src/agent/runtime.ts");
    const { store, steps } = fakeStore();

    const result = await realRuntime({ runs: store }).run({
      ...base,
      input: "Use read_call with call_id c1, then state in one sentence what it said about the budget.",
      tools: [readCall as never],
      apiKey: process.env.OPENROUTER_API_KEY!,
    });

    expect(steps.some((s) => s.tool === "read_call" && s.outcome === "ok")).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.text.trim().length).toBeGreaterThan(10);
  }, 120_000);
});
