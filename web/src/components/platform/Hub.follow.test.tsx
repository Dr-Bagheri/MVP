import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";

/**
 * **The assistant page's own scroll (the Sana shape).**
 *
 * jsdom lays nothing out, so this file holds what it honestly can:
 * (a) the STRUCTURE — the active page is a bounded column (`md:h-full`,
 *     `md:overflow-hidden`, the dvh belt) whose thread carries the one
 *     overflow class, so on md+ the page cannot grow and the thread is the
 *     scroller; and
 * (b) the WIRING — the follow effect writes the container's scrollTop only
 *     while the reader is pinned, and stops the moment they scroll up.
 * The real geometry (does it actually scroll, is the composer visible) is
 * a browser check; that ceiling is stated in the close report, not hidden.
 *
 * The follow DECISION itself is pure and lives in lib/threadFollow with its
 * own tests — including the scrolled-up case that must answer NO.
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

/** Gates let a test hold the stream mid-answer and scroll "while streaming". */
let release: Array<() => void> = [];
const gate = () => new Promise<void>((resolve) => { release.push(resolve); });

const persisted: { id: string; role: "user" | "assistant"; content: string }[] = [];

async function* scriptedAsk(
  q: string,
  _ctx: { page: string; callIds: string[] },
  sessionId?: string,
): AsyncGenerator<AgentEvent> {
  yield { type: "session", id: sessionId ?? "sess-f-1", created: sessionId === undefined };
  persisted.push({ id: `m-${persisted.length}`, role: "user", content: q });
  yield { type: "text_delta", delta: "پاسخ " };
  await gate(); // the test decides when the rest of the answer arrives
  yield { type: "text_delta", delta: "دوم" };
  persisted.push({ id: `m-${persisted.length}`, role: "assistant", content: "پاسخ دوم" });
  yield { type: "done", runId: "run-f-1", failed: false };
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
    mailDrafts: async () => [],
  },
}));

const { Hub } = await import("./Hub");

async function ask(text: string) {
  const box = screen.getByPlaceholderText(/بپرسید/);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  const send = document.querySelector("button.bg-accent") as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  send.click();
}

/** The thread's scroll box — the one region carrying the overflow class. */
function scroller(): HTMLElement {
  const el = document.querySelector('[class*="overflow-y-auto"]');
  if (!el) throw new Error("thread scroller not rendered");
  return el as HTMLElement;
}

describe("Hub — the thread scrolls, the page does not", () => {
  beforeEach(() => {
    release = [];
    persisted.length = 0;
  });

  it("bounds the active page and gives the THREAD the overflow (md+)", async () => {
    const { container } = render(<Hub />);
    await ask("سؤال");
    await screen.findByText(/پاسخ/);
    release.shift()!();
    await screen.findByText(/دوم/);

    /*
     * Structural halves of the Sana shape. The root refuses to grow —
     * without `overflow-hidden` + the height bound, a long conversation
     * grows the PAGE and the person scrolls the document to follow it,
     * which is the reported bug.
     *
     * The bound is unconditional now, not `md:` — the IDLE hub grew with its
     * suggestions and scrolled behind a composer pinned to its foot, so the
     * one screen whose job is a fixed box with a fixed prompt was the one
     * that moved (user directive, 2026-09-02). `max-w-content-small` is the
     * other half of that directive: a conversation is reading width.
     * The thread wrapper is the one scroller. jsdom cannot verify the resulting geometry; the classes are
     * the part a unit test can refuse to lose.
     */
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("overflow-hidden");
    expect(root.className).toContain("h-full");
    /* the COLUMN is the page's, not the hub's (2026-09-02, the audit): the
       assistant page renders the hub inside <PageContainer width="small">,
       and a hub that also drew `max-w-content-small` put the toolbar and the
       content in two different columns. So the assertion flipped: the root
       must NOT name a width of its own. */
    expect(root.className).not.toContain("max-w-content");

    const box = scroller();
    expect(box.className).toContain("overflow-y-auto");
    expect(box.className).toContain("min-h-0");
    expect(box.className).toContain("flex-1");

    // the idle state keeps its own (approved) anatomy: nothing bounded there
    // is asserted — this file is about the conversation state only
  });

  it("follows while pinned, stops when the reader scrolls up, resumes on their own send", async () => {
    render(<Hub />);
    await ask("سؤال یک");
    await screen.findByText(/پاسخ/);

    // instrument the scroller: jsdom has no layout, so the metrics are
    // stated and the WRITES are the observable — the effect's only output
    const el = scroller();
    const writes: number[] = [];
    let top = 0;
    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = value; writes.push(value); },
    });

    // the reader scrolls UP to re-read something older (500px above bottom)
    top = 100;
    fireEvent.scroll(el);

    // the rest of the answer streams in — and must NOT yank them down
    release.shift()!();
    await screen.findByText(/دوم/);
    await waitFor(() => expect(screen.queryByText("در حال فکر کردن…")).toBeNull());
    expect(writes.length).toBe(0);

    // their own send re-pins: they acted at the composer, and a thread that
    // does not show the question they just sent reads as having eaten it
    await ask("سؤال دو");
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    // pinning is a position: the container is put AT its bottom
    expect(writes[0]).toBe(1000);

    release.shift()!();
    await waitFor(() => expect(screen.getAllByText(/دوم/).length).toBeGreaterThan(0));
  });
});
