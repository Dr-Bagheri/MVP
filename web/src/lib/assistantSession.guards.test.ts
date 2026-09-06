import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";

/**
 * THREE GUARDS ON THE STORE (2026-09-06, the check-up's store lens):
 *
 * 1. A refetch that belongs to an OLDER run does not replace the thread —
 *    the post-`done` read used to land after the next question started and
 *    overwrite its live placeholder, so that answer streamed into nothing.
 * 2. A pending client tool cannot hold the stream hostage past the run's
 *    own abort: a consent card whose surface went away left `consume`
 *    suspended forever, `streaming` true, every composer refusing.
 * 3. A superseded run's teardown does not touch the run that replaced it —
 *    its `finally` used to null the live controller and publish
 *    `streaming: false` mid-run, so a third question could start on top.
 *
 * The stream is hand-driven, one frame at a time, because every one of
 * these is about what happens BETWEEN two frames.
 */
let queue: AgentEvent[] = [];
let wake: (() => void) | null = null;
let ended = false;
let asks = 0;
/** how many times an ABORTED stream was pulled again — the consumer resumed */
let resumedAfterAbort = 0;

function push(event: AgentEvent): void { queue.push(event); wake?.(); }
function end(): void { ended = true; wake?.(); }

async function* handDriven(signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  asks += 1;
  let aborted = false;
  signal?.addEventListener("abort", () => { aborted = true; wake?.(); });
  /* checked after EVERY resumption, including the one after a yield: a
     generator paused at `yield` that only looked at `aborted` at the loop's
     top would await a wake nobody sends, and a test built on it passes
     against any consumer, including one that never resumes at all */
  const bail = () => {
    if (!aborted) return;
    resumedAfterAbort += 1;
    const e = new Error("aborted"); e.name = "AbortError"; throw e;
  };
  for (;;) {
    bail();
    while (queue.length > 0) { yield queue.shift()!; bail(); }
    if (ended) return;
    await new Promise<void>((resolve) => { wake = resolve; });
  }
}

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    ask: (_q: string, _c: unknown, _s: unknown, opts?: { signal?: AbortSignal }) => handDriven(opts?.signal),
    deliverToolResult: async () => undefined,
    setAssistantFloor: async () => [],
  },
}));

const store = await import("./assistantSession");

const row = (id: string, role: "user" | "assistant", content: string) =>
  ({ id, role, content, tool_calls: [], proposal: null }) as never;

describe("the store's guards", () => {
  beforeEach(() => {
    queue = []; wake = null; ended = false; asks = 0; resumedAfterAbort = 0;
    store.resetAssistantForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a settle-refetch about an older run does not replace the live thread", async () => {
    let settled: number | null = null;
    const off = store.registerAssistantSurface({
      handleClientTool: async () => undefined,
      onSettled: (_reason, asOf) => { settled = asOf; },
    });
    void store.askAssistant({ question: "یک", page: "assistant" });
    push({ type: "session", id: "s-1", created: true });
    push({ type: "text_delta", delta: "پاسخ یک" });
    push({ type: "done", runId: "r-1", failed: false });
    end();
    await vi.waitFor(() => expect(store.assistantSnapshot().streaming).toBe(false));
    expect(settled).not.toBeNull();
    const first = settled as unknown as number;

    /* the next question starts before the refetch lands */
    queue = []; ended = false;
    void store.askAssistant({ question: "دو", page: "assistant" });
    push({ type: "session", id: "s-1", created: false });
    await vi.waitFor(() => expect(store.assistantSnapshot().messages.length).toBe(4));

    /* the stale refetch arrives, stamped with the FIRST run */
    store.adoptAssistantThread("s-1", [row("m-1", "user", "یک"), row("m-2", "assistant", "پاسخ یک")], [], first);
    expect(store.assistantSnapshot().messages.length, "the live placeholders survive a stale refetch").toBe(4);

    /* THE CONTROL: an unstamped adopt (a resume) still replaces */
    store.adoptAssistantThread("s-1", [row("m-1", "user", "یک")], []);
    expect(store.assistantSnapshot().messages.length).toBe(1);
    end();
    off();
  });

  it("a client tool whose surface never answers cannot outlive the run's abort", async () => {
    vi.useFakeTimers();
    const off = store.registerAssistantSurface({
      handleClientTool: () => new Promise<void>(() => { /* the card that nobody can press */ }),
    });
    void store.askAssistant({ question: "یک تسک بساز", page: "assistant" });
    push({ type: "session", id: "s-2", created: true });
    push({
      type: "client_tool_call", id: "ct-1", tool: "create_task", label: "ساختن تسک",
      args: { title: "x" }, effect: "write", requires_consent: true,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(store.assistantSnapshot().streaming).toBe(true);

    /* the person starts over: the run is aborted, and the wait must end
       with it — the old code stayed suspended on the promise forever, which
       is what the counter sees: the aborted stream is pulled once more only
       if the consumer got past the card */
    store.resetAssistantSession();
    await vi.advanceTimersByTimeAsync(50);
    expect(store.assistantSnapshot().streaming).toBe(false);
    expect(store.assistantSnapshot().messages).toEqual([]);
    expect(resumedAfterAbort, "the consumer left the card and met the abort").toBe(1);

    /* and a NEW question is accepted at once — the store is not stuck */
    queue = []; ended = false;
    void store.askAssistant({ question: "دو", page: "assistant" });
    await vi.advanceTimersByTimeAsync(10);
    expect(asks).toBe(2);
    expect(store.assistantSnapshot().streaming).toBe(true);
    end();
    await vi.advanceTimersByTimeAsync(10);
    off();
  });

  it("a superseded run's teardown leaves the run that replaced it alone", async () => {
    vi.useFakeTimers();
    let release: (() => void) | null = null;
    const off = store.registerAssistantSurface({
      handleClientTool: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    void store.askAssistant({ question: "یک", page: "assistant" });
    push({ type: "session", id: "s-3", created: true });
    push({
      type: "client_tool_call", id: "ct-2", tool: "create_task", label: "ساختن تسک",
      args: { title: "x" }, effect: "write", requires_consent: true,
    });
    await vi.advanceTimersByTimeAsync(20);

    /* «گفت‌وگوی تازه», then the next question — run B owns the controller */
    store.resetAssistantSession();
    await vi.advanceTimersByTimeAsync(20);
    queue = []; ended = false;
    void store.askAssistant({ question: "دو", page: "assistant" });
    push({ type: "session", id: "s-4", created: true });
    push({ type: "text_delta", delta: "در حال" });
    await vi.advanceTimersByTimeAsync(20);
    expect(store.assistantSnapshot().streaming).toBe(true);

    /* the stale card is answered now: run A resumes, hits its abort and
       tears down — and B must still be streaming afterwards */
    release!();
    await vi.advanceTimersByTimeAsync(50);
    expect(store.assistantSnapshot().streaming, "run B is still the live run").toBe(true);
    expect(store.assistantSnapshot().sessionId).toBe("s-4");

    push({ type: "done", runId: "r-4", failed: false });
    end();
    await vi.advanceTimersByTimeAsync(50);
    expect(store.assistantSnapshot().streaming).toBe(false);
    off();
  });
});
