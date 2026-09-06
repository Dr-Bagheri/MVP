/**
 * The SSE contract the frontend built a reducer against. These assert the
 * wire format and the two rules they depend on: `done` always last (even on
 * failure), and denied/blocked as distinct NORMAL states.
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

  it("the floor is announced after the session, and a second responder answers AFTER the streamed one (2026-09-06)", async () => {
    /*
     * "When two names are said in one message, both answer." The first
     * named streams as the turn's own answer; each other named colleague
     * runs after it, hears it, and lands as ONE message under its own name,
     * after the answer it follows — and `done` is still last.
     */
    runPiMock.mockReset();
    let calls = 0;
    runPiMock.mockImplementation(async (options: { onText?: (d: string) => void }) => {
      calls += 1;
      if (calls === 1) {
        options.onText?.("رؤیا: سلام");
        return { text: "رؤیا: سلام", model: "m", tokensIn: 1, tokensOut: 1 };
      }
      return { text: "آوا: منم هستم", model: "m", tokensIn: 1, tokensOut: 1 };
    });
    const out = collectSink();
    const turns: { text: string; author?: string | undefined }[] = [];
    await createAssistant({ db: fakeDb(), tools: [], deps: {} }).ask({
      ...ask,
      sessionId: "55555555-5555-4555-8555-555555555555",
      agentHandle: "roya",
      route: { agent: "roya", rule: "mention", switched: true, confidence: null },
      floor: ["roya", "ava"],
      also: [{ handle: "ava", name: "آوا", systemInstructions: "تو آوا هستی", web: false }],
      onTurn: async (turn: { text: string; author?: string | undefined }) => { turns.push({ text: turn.text, author: turn.author }); },
    } as never, out.sink);
    const events = out.events();
    const types = events.map((e) => e.type);
    expect(types.indexOf("floor"), "the floor comes right after the session").toBe(types.indexOf("session") + 1);
    expect(events.find((e) => e.type === "floor")).toMatchObject({ agents: ["roya", "ava"] });
    expect(events.filter((e) => e.type === "text_delta").map((e) => e.delta)).toEqual(["رؤیا: سلام"]);
    const second = events.find((e) => e.type === "agent_message");
    expect(second).toMatchObject({ author: "ava", name: "آوا", text: "آوا: منم هستم", failed: false, after: true });
    expect(types.indexOf("agent_message"), "the second answer follows the first").toBeGreaterThan(types.lastIndexOf("text_delta"));
    expect(types.at(-1)).toBe("done");
    expect(runPiMock).toHaveBeenCalledTimes(2);
    /* both persisted, under their own names, in speaking order */
    expect(turns.map((t) => t.author)).toEqual(["roya", "ava"]);
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
