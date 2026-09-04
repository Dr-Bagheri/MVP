import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";

/**
 * THE ANSWER SURVIVES THE SCREEN.
 *
 * User report, 2026-09-04: "i started a chat with ai assistant in its page,
 * mid thinking of the ai i changed page and the answer was lost … the side bar
 * of ai assistant and its page is basically one, they are connected, anything
 * start in one can be continue in the other, it should be like a mirroring in
 * two different places one page and one side bar."
 *
 * Both halves are asserted here because they are ONE mechanism and each is
 * invisible on its own:
 *
 *   · the run is not cancelled when the surface that started it goes away. The
 *     old code held an `AbortController` in the component and aborted it on
 *     unmount, so walking to another page did not merely hide the answer — it
 *     closed the SSE body, which the server reads as "nobody is listening".
 *     The answer was not lost in transit; it was killed on the way out.
 *
 *   · what arrives while nothing is mounted is still there when something
 *     mounts again. A run that survives and writes into a thread nobody kept
 *     would look identical to the bug from the reader's side.
 *
 * The stream here is DRIVEN BY THE TEST, one frame at a time, because the
 * subject is what happens BETWEEN two frames — an auto-completing generator
 * would finish before the unmount and prove nothing.
 */

vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/** every route the page's own router was asked to go to */
const pushed: string[] = [];
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => "/assistant",
  useRouter: () => ({ replace: vi.fn(), push: (to: string) => { pushed.push(to); } }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/fa/assistant",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/** the queue the test pushes frames into, and the promise the stream waits on */
let queue: AgentEvent[] = [];
let wake: (() => void) | null = null;
let ended = false;
let aborted = false;

function push(event: AgentEvent): void {
  queue.push(event);
  wake?.();
}
function end(): void {
  ended = true;
  wake?.();
}

async function* handDriven(signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  signal?.addEventListener("abort", () => { aborted = true; end(); });
  for (;;) {
    while (queue.length > 0) yield queue.shift()!;
    if (ended) return;
    await new Promise<void>((resolve) => { wake = resolve; });
  }
}

const persisted: {
  id: string; role: "user" | "assistant"; content: string; author?: string;
}[] = [];

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
      avatar_url: null, role: "admin", status: "active", locale: "fa",
      model_id: null, created_at: new Date().toISOString(),
    }),
    ask: (_q: string, _c: unknown, _s: unknown, opts?: { signal?: AbortSignal }) =>
      handDriven(opts?.signal),
    agentMessages: async () => persisted.map((m) => ({ ...m, tool_calls: [], proposal: null })),
    models: async () => ({ models: [], preferred_model: null, curated: false, tool_capability_filtered: false }),
    skills: async () => [], agents: async () => [], workflows: async () => [],
    search: async () => [], assistantTools: async () => [], sessionFeedback: async () => ({}),
    shareState: async () => false, agentSessions: async () => [], connectors: async () => [],
    mailDrafts: async () => [],
  },
}));

const { Hub } = await import("./Hub");
const { assistantSnapshot } = await import("@/lib/assistantSession");

async function ask(text: string) {
  const box = screen.getByPlaceholderText(/بپرسید/);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  const send = await screen.findByRole("button", { name: /ارسال/ });
  send.click();
}

describe("one conversation, two windows onto it", () => {
  beforeEach(() => {
    queue = []; wake = null; ended = false; aborted = false;
    persisted.length = 0;
    pushed.length = 0;
  });

  it("keeps answering after the surface that asked is gone, and the next surface has it", async () => {
    const first = render(<Hub />);
    await ask("سؤال یک");

    push({ type: "session", id: "sess-1", created: true });
    push({ type: "text_delta", delta: "نیمهٔ" });
    await screen.findByText(/نیمهٔ/);

    /* THE NAVIGATION. Everything the page was is torn down mid-answer — which
       is exactly what clicking a nav link does. */
    first.unmount();

    /*
     * The first assertion, and the one the report was about: the stream was
     * not cancelled on the way out. `aborted` is written by the generator's
     * own abort listener, so this is the transport's account of itself rather
     * than ours.
     */
    expect(aborted, "the navigation must not cancel the run").toBe(false);

    /* the rest of the answer arrives with NOTHING mounted */
    push({ type: "text_delta", delta: " دوم" });
    push({ type: "done", runId: "r-1", failed: false });
    end();
    await waitFor(() => expect(assistantSnapshot().streaming).toBe(false));

    /*
     * And it is all there — the half written before the walk and the half
     * written after. `persisted` is deliberately EMPTY, so this cannot be
     * satisfied by a refetch of stored rows: what is on screen is the live
     * thread, which is the claim being made.
     */
    render(<Hub />);
    await screen.findByText("نیمهٔ دوم");
    expect(screen.getByText("سؤال یک")).toBeTruthy();
  });

  it("the page keeps the hands while it is the surface on screen", async () => {
    /*
     * The assistant page renders the sidebar too, and the sidebar returns null
     * there — but a component that renders nothing still runs its effects, and
     * effects run parent-last, so a HIDDEN panel would register after the page
     * and take the hands out of its window. A consent request would then be
     * answered by a component that renders nothing: a promise nobody can
     * resolve, and a run that hangs until the 120-second timeout.
     *
     * Asserted through the ONE observable difference: a client tool performed
     * by the page navigates through the page's router. A hidden claimant would
     * leave this at zero and look exactly like a tool that was never called.
     */
    render(<Hub />);
    await ask("برو به جلسات");
    push({ type: "session", id: "sess-1", created: true });
    push({
      type: "client_tool_call", id: "ct-1", tool: "navigate", label: "رفتن",
      args: { path: "/meetings" }, effect: "ui", requires_consent: false,
    });
    push({ type: "done", runId: "r-1", failed: false });
    end();
    await waitFor(() => expect(assistantSnapshot().streaming).toBe(false));
    await waitFor(() => expect(pushed).toContain("/meetings"));
  });

  it("the second surface sees the SAME conversation, not a copy of the words", async () => {
    /*
     * The distinction that matters for "they are basically one": continuing
     * the thread has to continue the SESSION. A surface that showed the same
     * text while asking with no session id would look identical here and
     * would open a fresh conversation on the next question — the assistant
     * forgetting, with no visual symptom at all.
     */
    const first = render(<Hub />);
    await ask("سؤال یک");
    push({ type: "session", id: "sess-1", created: true });
    push({ type: "text_delta", delta: "پاسخ" });
    push({ type: "done", runId: "r-1", failed: false });
    end();
    await waitFor(() => expect(assistantSnapshot().streaming).toBe(false));
    first.unmount();

    expect(assistantSnapshot().sessionId).toBe("sess-1");
  });

  it("names the responder BEFORE the answer, and Echo stays an absence", async () => {
    /*
     * M48. The router picks one agent and that one owns the turn, so the
     * thread says who is speaking while the words are still arriving — which
     * is the whole of what makes the extra routing round trip acceptable.
     *
     * The half that would be easy to get wrong: routing to ECHO must leave the
     * message exactly as it was. `author` absent has always meant Echo, and
     * stamping it with the handle "echo" would give the assistant a roster
     * lookup that can never resolve — the avatar would fall to the unknown
     * face on every ordinary turn.
     */
    render(<Hub />);
    await ask("این هفته چه جلساتی دارم؟");
    push({ type: "session", id: "sess-1", created: true });
    push({ type: "route", agent: "roya", rule: "model", switched: false });
    await waitFor(() => {
      const live = assistantSnapshot().messages.find((m) => m.streaming === true);
      expect(live?.author, "the responder is named before a token arrives").toBe("roya");
    });

    /*
     * And the name SURVIVES the settle. The hook refetches the persisted rows
     * when a run finishes, so the stored `author` column is what the reader
     * sees a second later — if the server did not write it, the avatar would
     * appear during the answer and vanish the moment it landed.
     *
     * The fixture carries it for that reason. An empty `persisted` would make
     * this assertion read a thread the refetch had just emptied, which is a
     * fact about the fixture wearing the costume of a fact about the wire.
     */
    persisted.push({ id: "m-1", role: "assistant", content: "سه جلسه", author: "roya" });
    push({ type: "text_delta", delta: "سه جلسه" });
    push({ type: "done", runId: "r-1", failed: false });
    end();
    await waitFor(() => expect(assistantSnapshot().streaming).toBe(false));
    await waitFor(() => expect(assistantSnapshot().messages.at(-1)?.author).toBe("roya"));
  });

  it("THE CONTROL: routing to Echo leaves the turn unauthored", async () => {
    /*
     * Without this the assertion above passes against a handler that stamps
     * every route onto the message — including Echo's, which would hand the
     * ordinary turn a handle no agent row has and draw the unknown-handle
     * face beside every answer the assistant gives.
     */
    render(<Hub />);
    await ask("سلام");
    push({ type: "session", id: "sess-2", created: true });
    push({ type: "route", agent: "echo", rule: "model", switched: false });
    persisted.push({ id: "m-2", role: "assistant", content: "سلام" });
    push({ type: "text_delta", delta: "سلام" });
    push({ type: "done", runId: "r-2", failed: false });
    end();
    await waitFor(() => expect(assistantSnapshot().streaming).toBe(false));
    expect(assistantSnapshot().messages.at(-1)?.author).toBeUndefined();
  });
});
