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

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => "/assistant",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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

const persisted: { id: string; role: "user" | "assistant"; content: string }[] = [];

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
});
