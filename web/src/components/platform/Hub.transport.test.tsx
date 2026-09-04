import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";
/**
 * THE HANDOFF IS MOCKED AWAY IN THIS FILE, and the reason is a real race
 * rather than tidiness.
 *
 * `lib/liveConversation` is module state: whichever surface is showing a
 * conversation publishes its id so the other picks it up. These tests drive
 * streams that are still in flight when a case ends — which is the point of a
 * file about streams DYING — so a previous test's `session` event lands after
 * the next test's `beforeEach`, and the next Hub mounts continuing a
 * conversation nobody in that test started. It appeared exactly that way:
 * `expected 'sess-live-1' to be undefined` on the first ask of a test that had
 * not asked anything yet.
 *
 * Clearing it in `beforeEach` does not close the race — the late write happens
 * after. The subject here is what a dead stream does to the SESSION REF, and
 * the handoff is noise standing in front of it, so it answers "nothing handed
 * over". Its own behaviour is asserted in lib/liveConversation.test.ts.
 */
vi.mock("@/lib/liveConversation", () => ({
  liveConversation: () => null,
  setLiveConversation: () => {},
  subscribeLiveConversation: () => () => {},
  resetLiveConversationForTest: () => {},
}));

/**
 * **A stream that ends without `done` died in transport — it is never a
 * success.**
 *
 * The wire contract (core/src/api/sse.ts) says `done` is ALWAYS the last
 * event, including on failure, and that "the client treats
 * stream-end-without-done as a transport failure". Only one half of that
 * sentence was ever built: core never drops the stream silently, and the hub
 * never checked. A proxy closing the SSE body cleanly (Cloudflare tunnel
 * idle timeout, Vercel's duration kill — both on record for this deployment)
 * therefore walked the SUCCESS path: no error, no annotation, a reply stuck
 * on "thinking" — and when the cut landed on a conversation's opening turn
 * before the `session` frame, the id never arrived, so the next message
 * silently opened a NEW conversation under the old thread. The assistant
 * "forgot everything" while the screen looked connected (user report,
 * 2026-08-28, the "re" screenshot).
 *
 * The assertions live at the layer the bug lives: the annotation that must
 * appear, the caret that must settle, and — the one with no visual symptom —
 * the `sessionId` ARGUMENT of the next ask. A rendered label can lie; the
 * argument cannot.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => "/assistant",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

/**
 * How the next stream ends, set per test:
 * - "ok"          — the full contract: session, delta, done.
 * - "die-silent"  — clean EOF before ANY frame. This is the pre-`session`
 *                   cut: `session` is the FIRST event, so a stream that dies
 *                   before it yields nothing at all. The discriminating
 *                   fixture — with any later cut the id has already arrived.
 * - "die-mid"     — session and a delta arrive, then clean EOF. No `done`.
 * - "throw-before"— the fetch itself fails; no run ever started.
 */
type Script = "ok" | "die-silent" | "die-mid" | "throw-before";
let script: Script = "ok";

const askCalls: (string | undefined)[] = [];
const SESSION_ID = "sess-live-1";
const persisted: { id: string; role: "user" | "assistant"; content: string }[] = [];

async function* scriptedAsk(
  q: string,
  _ctx: { page: string; callIds: string[] },
  sessionId?: string,
): AsyncGenerator<AgentEvent> {
  askCalls.push(sessionId);
  if (script === "throw-before") throw new Error("fetch failed");
  if (script === "die-silent") return;
  yield { type: "session", id: sessionId ?? SESSION_ID, created: sessionId === undefined };
  // the server writes the user turn before streaming (wire fact)
  persisted.push({ id: `m-${persisted.length}`, role: "user", content: q });
  yield { type: "text_delta", delta: "پاسخ" };
  if (script === "die-mid") return;
  persisted.push({ id: `m-${persisted.length}`, role: "assistant", content: "پاسخ" });
  yield { type: "done", runId: "run-1", failed: false };
}

vi.mock("@/api/client", () => ({
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
    ask: (...args: Parameters<typeof scriptedAsk>) => scriptedAsk(...args),
    agentMessages: async () =>
      persisted.map((m) => ({ ...m, tool_calls: [], proposal: null })),
    models: async () => ({ models: [], preferred_model: null, curated: false, tool_capability_filtered: false }),
    skills: async () => [],
    agents: async () => [],
    workflows: async () => [],
    search: async () => [],
    assistantTools: async () => [],
    sessionFeedback: async () => ({}),
    shareState: async () => false,
    agentSessions: async () => [],
    /* the composer's ⊕ reads the connector list when it OPENS (2026-09-03).
       An absent method throws inside a promise, and the failure surfaces as
       whatever died next — here, a menu item that "could not be found". */
    connectors: async () => [],
    mailDrafts: async () => [],
  },
}));

const { Hub } = await import("./Hub");

const ANNOTATION = "این پرسش بی‌پاسخ ماند؛ اجرا ناتمام ماند.";
const REFUSED_BEFORE_START = "پرسش پیش از شروع اجرا رد شد.";

async function ask(text: string) {
  const box = screen.getByPlaceholderText(/بپرسید/);
  const setter = Object.getOwnPropertyDescriptor(
    /* the element's OWN prototype: the composer became a <textarea> when it
       grew to three lines (2026-09-04), and React's value setter is a
       different property on each class — pinning HTMLInputElement made every
       one of these throw "not a valid instance" */
    Object.getPrototypeOf(box), "value")!.set!;
  setter.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  /*
   * BY ITS TITLE, not by a style class (2026-09-03 — the sibling trap, caught
   * by the send key losing its fill).
   *
   * `button.bg-accent` was "the first accent-coloured button in the document",
   * which is a fact about the STYLESHEET and not about the send control. The
   * day the button stopped being filled, four suites failed with
   * `Cannot read properties of null` — a null selector reported as a crash,
   * naming nothing about what actually changed.
   *
   * Hub.session.test.tsx had already learned this and written it down. Its
   * three siblings kept the old selector, because fixing one instance is not
   * fixing its siblings — which is exactly the rule that file's comment was
   * recording.
   */
  const send = screen.getByTitle("ارسال") as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  send.click();
}

describe("Hub — a dead stream is a failure someone can see", () => {
  beforeEach(() => {
    script = "ok";
    askCalls.length = 0;
    persisted.length = 0;
  });

  it("shows the failed-run annotation when the stream dies before its first frame — never a stuck spinner", async () => {
    script = "die-silent";
    render(<Hub />);
    await ask("سؤال یک");

    // anchored on the settled state: the annotation exists only after the
    // run is over, so finding it proves the turn settled rather than that
    // some loading state happened to match
    await screen.findByText(ANNOTATION);

    // the empty reply is gone with it — no "thinking" forever on a dead wire
    expect(screen.queryByText("در حال فکر کردن…")).toBeNull();
    // and the question itself still stands: the honest record
    expect(screen.getByText("سؤال یک")).toBeTruthy();
    // distinguish the kinds of nothing: the run may well have STARTED
    // server-side — claiming it was refused before it began would be false
    expect(screen.queryByText(REFUSED_BEFORE_START)).toBeNull();
  });

  it("keeps a partial answer, settles its caret, and annotates it when the stream dies mid-answer", async () => {
    render(<Hub />);
    await ask("سؤال یک");
    await waitFor(() => expect(askCalls.length).toBe(1));
    await screen.findByText("پاسخ");

    script = "die-mid";
    await ask("سؤال دو");
    // the annotation on the REAL turn that ended badly (Shape B, live)
    await screen.findByText(ANNOTATION);

    // the partial text is preserved — what arrived is what the person saw
    expect(screen.getAllByText("پاسخ").length).toBe(2);
    // ...and the caret has stopped claiming words are still coming
    expect(document.querySelector(".animate-pulse")).toBeNull();
    expect(screen.queryByText(REFUSED_BEFORE_START)).toBeNull();
  });

  it("continues the SAME conversation after a dead stream — the failure must not clear the session", async () => {
    render(<Hub />);
    await ask("سؤال یک");
    await waitFor(() => expect(askCalls.length).toBe(1));
    expect(askCalls[0]).toBeUndefined();
    await screen.findByText("پاسخ");

    script = "die-mid";
    await ask("سؤال دو");
    await screen.findByText(ANNOTATION);
    await waitFor(() => expect(askCalls.length).toBe(2));
    expect(askCalls[1]).toBe(SESSION_ID);

    /*
     * THE assertion. If a failure path resets the session ref, this send
     * goes out `undefined`, the server opens a brand-new conversation, and
     * the screen keeps rendering the old thread — the assistant "forgets"
     * with no visual symptom whatsoever. The argument is the only honest
     * witness.
     */
    script = "ok";
    await ask("سؤال سه");
    await waitFor(() => expect(askCalls.length).toBe(3));
    expect(askCalls[2]).toBe(SESSION_ID);
  });

  it("still names a run that never started — the refusal sentence belongs to that nothing only", async () => {
    script = "throw-before";
    render(<Hub />);
    await ask("سؤال یک");

    // nothing ever streamed, so "refused before a run started" is TRUE here
    await screen.findByText(REFUSED_BEFORE_START);
    // and the question stands with its annotation, nothing invented beside it
    await screen.findByText(ANNOTATION);
  });
});
