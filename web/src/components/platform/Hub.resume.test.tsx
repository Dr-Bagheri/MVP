import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentMessage } from "@/api/types";

/**
 * **Resuming a stored conversation — including the one that has no answer.**
 *
 * This path was unreachable until fixtures existed: with `agentSessions()`
 * returning empty there was no thread to open, so every line here was code
 * nobody had watched run. It is tested rather than merely rendered once,
 * because the resumed half of a conversation is the half nobody looks at.
 *
 * The second test is the subtle one. Resuming sets the session id, so a
 * follow-up question must CONTINUE the resumed thread rather than open a new
 * one — and that failure is invisible in exactly the same way as dropping the
 * id on a live turn: the answer arrives, the thread renders, and the assistant
 * has quietly forgotten everything above the question you just asked.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const RESUMED = "sess-3";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`c=${RESUMED}`),
}));

/**
 * The failed-run shape, straight from the wire contract: a turn is written only
 * if the run produced text, so a run that failed with nothing said leaves the
 * question standing ALONE. No assistant message carrying `failed: true` — that
 * flag belongs to the live stream, where the client watched it happen.
 */
const failedThread: AgentMessage[] = [
  { id: "m1", role: "user", content: "این تماس را خلاصه کن.", tool_calls: [], proposal: null },
];

const askCalls: (string | undefined)[] = [];
/**
 * A thread fetch the test can HOLD OPEN. The loading window is a moment, and
 * a mock that resolves on the next microtask makes that moment unobservable —
 * an assertion about it would pass or fail on scheduling luck. When `gate` is
 * set, `agentMessages` waits for the test to release it.
 */
let gate: Promise<AgentMessage[]> | null = null;
async function* scriptedAsk(
  _q: string,
  _ctx: { page: string; callIds: string[] },
  sessionId?: string,
): AsyncGenerator<AgentEvent> {
  askCalls.push(sessionId);
  yield { type: "session", id: sessionId ?? "sess-new", created: sessionId === undefined };
  yield { type: "text_delta", delta: "پاسخ تازه" };
  yield { type: "done", runId: "run-2", failed: false };
}

vi.mock("@/api/client", () => ({
  /*
   * The mock owes `BffError` too: Hub catches it by CLASS to tell a
   * refusal from a transport failure, and a mock without it throws
   * "No BffError export is defined" from inside the catch — which
   * surfaced as 15 unhandled errors beside a green suite. A green
   * suite with unhandled rejections is not a green suite.
   */
  BffError: class BffError extends Error {
    constructor(public status: number, public kind?: string, public detail?: string) {
      super(detail ?? kind ?? String(status));
    }
  },
  api: {
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
      avatar_url: null, role: "admin", status: "active", locale: "fa",
      model_id: null, created_at: new Date().toISOString(),
    }),
    agentMessages: () => gate ?? Promise.resolve(failedThread),
    ask: (...args: Parameters<typeof scriptedAsk>) => scriptedAsk(...args),
    // the Part-1 surface the hub now touches on mount / after done
    models: async () => ({ models: [], preferred_model: null, curated: false, tool_capability_filtered: false }),
    skills: async () => [],
    agents: async () => [],
    /* the hub reads the workflow cards to name an auto-run's opening
       line; EMPTY is the honest fixture here — with no card there is no
       run, which is what these files are about (none of them arrive with
       a workflow on the URL) */
    workflows: async () => [],
    assistantTools: async () => [],
    sessionFeedback: async () => ({}),
    shareState: async () => false,
  },
}));

const { Hub } = await import("./Hub");

describe("Hub — resuming a stored conversation", () => {
  beforeEach(() => {
    askCalls.length = 0;
    gate = null;
  });

  it("shows the thread's skeleton, not the welcome screen, while the stored thread loads", async () => {
    /*
     * audit finding, 2026-09-02: `idle` was `messages.length === 0`, and a
     * resumed thread is exactly that until its fetch lands — so opening a
     * stored conversation painted the welcome line and the suggestion chips,
     * then swapped them for the thread. Loading and empty are different
     * nothings; this holds the fetch open and looks at the window.
     */
    let release!: (thread: AgentMessage[]) => void;
    gate = new Promise((resolve) => { release = resolve; });
    render(<Hub />);

    // in flight: a skeleton in the thread's own box…
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    // …and NOT the idle hub. Both halves, because each alone is vacuous in
    // one direction: absence of the welcome line also holds on a blank box,
    // and a busy marker alone would pass with the welcome still under it.
    expect(screen.queryByText(/من دستیار نورای/)).toBeNull();

    /* the release is the test's own state update, so it is the test's own
       act — a bare resolve here fires the thread's arrival outside React's
       knowledge and is reported as an un-acted update */
    await act(async () => { release(failedThread); });
    await screen.findByText("این تماس را خلاصه کن.");
    // the skeleton left with the thread's arrival
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("renders a resumed failed run as a question with no answer — and invents nothing", async () => {
    render(<Hub />);

    // anchor on the loaded thread, not on the initial paint: asserting before
    // the fetch resolves would pass against an implementation that never loads
    await screen.findByText("این تماس را خلاصه کن.");

    // the annotation is present…
    expect(screen.getByText(/بی‌پاسخ ماند/)).toBeTruthy();
    // …and there is exactly ONE message bubble: no fabricated assistant turn
    expect(document.querySelectorAll(".rounded-2xl").length - 1).toBe(1);
    // the idle anatomy has stepped aside — this is the active state
    expect(screen.queryByAltText("NeurAI")).toBeNull();
  });

  it("continues the RESUMED thread on the next question, rather than opening a new one", async () => {
    render(<Hub />);
    await screen.findByText("این تماس را خلاصه کن.");

    const box = screen.getByPlaceholderText(/بپرسید/);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(box, "و نکتهٔ بعدی؟");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    const send = document.querySelector("button.bg-accent") as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    send.click();

    await waitFor(() => expect(askCalls.length).toBe(1));
    /*
     * If this is `undefined`, the follow-up silently starts a new conversation
     * and the resumed history is orphaned — with no visual symptom whatsoever.
     */
    expect(askCalls[0]).toBe(RESUMED);
  });
});
