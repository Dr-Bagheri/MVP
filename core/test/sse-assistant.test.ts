/**
 * The SSE contract the frontend built a reducer against. These assert the
 * wire format and the two rules they depend on: `done` always last (even on
 * failure), and denied/blocked as distinct NORMAL states.
 */
import { describe, expect, it, vi } from "vitest";

const runPiMock = vi.fn();
vi.mock("../src/agent/pi.ts", () => ({
  runPi: (...args: unknown[]) => runPiMock(...args),
  Type: {},
}));

const { createAssistant } = await import("../src/api/assistant.ts");
import { createSseStream, formatSse } from "../src/api/sse.ts";
import { ToolDenied } from "../src/agent/tools.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const RUN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

function fakeDb() {
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) =>
        (sql.includes("insert into echo.agent_run") ? [{ id: RUN }] : [])) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return createDb({ app: make(), agent: make() });
}

function collectSink() {
  const chunks: string[] = [];
  let ended = false;
  return {
    chunks,
    get ended() { return ended; },
    sink: { write: (c: string) => { chunks.push(c); }, end: () => { ended = true; } },
    events: () => chunks.filter((c) => c.startsWith("event:")).map((c) => {
      const data = c.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
      return JSON.parse(data) as Record<string, unknown>;
    }),
  };
}

const readCall = {
  name: "read_call", label: "Read call", description: "", parameters: {},
  async run() { return "بودجه تصویب شد"; },
};
const denying = {
  name: "read_call", label: "Read call", description: "", parameters: {},
  async run() { throw new ToolDenied("call not found"); },
};

const ask = { identity: IDENTITY, question: "چه شد؟", model: "google/gemini-3.6-flash" };

describe("SSE wire format", () => {
  it("emits named events with a JSON data line", () => {
    const frame = formatSse({ type: "text_delta", delta: "سلام" });
    expect(frame).toBe(`event: text_delta\ndata: {"type":"text_delta","delta":"سلام"}\n\n`);
  });

  it("keep-alive is a comment, not a vocabulary item", () => {
    const { chunks, sink } = collectSink();
    createSseStream(sink).keepAlive();
    expect(chunks[0]).toBe(":ka\n\n");
  });

  it("nothing is written after finish", () => {
    const { chunks, sink } = collectSink();
    const stream = createSseStream(sink);
    stream.finish({ runId: RUN, failed: false });
    stream.send({ type: "text_delta", delta: "late" });
    expect(chunks.filter((c) => c.includes("late"))).toHaveLength(0);
    expect(stream.isClosed).toBe(true);
  });
});

describe("assistant stream", () => {
  it("streams text, tool lifecycle, then done — in that order", async () => {
    runPiMock.mockReset();
    runPiMock.mockImplementation(async (options: {
      tools: { execute: (id: string, args: unknown) => Promise<unknown> }[];
      onText?: (d: string) => void;
    }) => {
      await options.tools[0]!.execute("t1", { call_id: "c1" });
      options.onText?.("بودجه ");
      options.onText?.("تصویب شد.");
      return { text: "بودجه تصویب شد.", model: "m", tokensIn: 5, tokensOut: 5 };
    });

    const out = collectSink();
    await createAssistant({ db: fakeDb(), tools: [readCall as never], deps: {} })
      .ask(ask, out.sink);

    const events = out.events();
    expect(events[0]).toMatchObject({ type: "tool_call", state: "started", name: "read_call", label: "Read call" });
    expect(events.filter((e) => e.type === "text_delta").map((e) => e.delta)).toEqual(["بودجه ", "تصویب شد."]);
    const terminal = events.find((e) => e.type === "tool_call" && e.state === "ok");
    expect(terminal).toBeTruthy();
    // done is ALWAYS last, and the stream is closed
    expect(events.at(-1)).toMatchObject({ type: "done", failed: false, runId: RUN });
    expect(out.ended).toBe(true);
  });

  it("a denied tool is a NORMAL terminal state, not an error", async () => {
    runPiMock.mockReset();
    runPiMock.mockImplementation(async (options: {
      tools: { execute: (id: string, args: unknown) => Promise<unknown> }[];
    }) => {
      await options.tools[0]!.execute("t1", { call_id: "someone-elses" });
      return { text: "به آن جلسه دسترسی ندارید.", model: "m", tokensIn: 1, tokensOut: 1 };
    });

    const out = collectSink();
    await createAssistant({ db: fakeDb(), tools: [denying as never], deps: {} })
      .ask(ask, out.sink);

    const events = out.events();
    expect(events.some((e) => e.type === "tool_call" && e.state === "denied")).toBe(true);
    expect(events.some((e) => e.state === "error")).toBe(false);
    // the run still succeeded — a refusal is not a failure
    expect(events.at(-1)).toMatchObject({ type: "done", failed: false });
  });

  it("a failed run STILL ends with done{failed:true} (never a dropped stream)", async () => {
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({
      text: "", model: "m", tokensIn: null, tokensOut: null,
      error: "400 provider exploded",
    });

    const out = collectSink();
    await createAssistant({ db: fakeDb(), tools: [], deps: {} }).ask(ask, out.sink);

    const last = out.events().at(-1)!;
    expect(last.type).toBe("done");
    expect(last.failed).toBe(true);
    expect(String(last.error)).toContain("provider exploded");
    expect(out.ended).toBe(true);
  });

  it("an inactive actor still gets a well-formed stream, not a hang", async () => {
    runPiMock.mockReset();
    const out = collectSink();
    await createAssistant({ db: fakeDb(), tools: [], deps: {} })
      .ask({ ...ask, identity: { ...IDENTITY, isActive: false } }, out.sink);

    const last = out.events().at(-1)!;
    expect(last).toMatchObject({ type: "done", failed: true });
    expect(String(last.error)).toMatch(/not active/);
    expect(out.ended).toBe(true);
  });
});
