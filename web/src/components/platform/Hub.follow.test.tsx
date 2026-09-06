import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentEvent } from "@/api/types";
import { installFakeResizeObserver } from "@/test/resizeObserver";

/**
 * **The assistant page's own scroll (the Sana shape).**
 *
 * jsdom lays nothing out, so this file holds what it honestly can:
 * (a) the STRUCTURE — the active page is a bounded column (`md:h-full`,
 *     `md:overflow-hidden`, the dvh belt) whose thread carries the one
 *     overflow class, so on md+ the page cannot grow and the thread is the
 *     scroller; and
 * (b) the WIRING — the follow writes the container's scrollTop only while
 *     the reader is pinned, and stops the moment they scroll up; and
 * (c) the COVERAGE (2026-09-06) — the follow is keyed on the box's
 *     geometry, so everything that lands in the box is followed, the consent
 *     card included: the card must render INSIDE the element the follow
 *     observes. Until that day the follow ran on the message list alone, and
 *     a card, a refusal line or a second colleague's answer landed below the
 *     fold and stayed there ("the messages from agents or echo go under the
 *     field of vision").
 * The real geometry (does it actually scroll, is the composer visible) is
 * a browser check; that ceiling is stated in the close report, not hidden.
 *
 * The follow DECISION itself is pure and lives in lib/threadFollow with its
 * own tests — including the scrolled-up case that must answer NO; the
 * mechanism has its own file too (lib/useThreadFollow.test.tsx). jsdom has no
 * ResizeObserver, so a fake is installed and the test says when the box's
 * content changed size.
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
  if (/تسک/.test(q)) {
    /* a WRITE the run asks the page to perform: the store awaits the surface's
       answer before it pulls the next frame, so the card stands until the
       test answers it */
    yield {
      type: "client_tool_call", id: "ct-f-1", tool: "create_task", label: "ساختن تسک",
      args: { title: "کارت اجازه" }, effect: "write", requires_consent: true,
    };
    yield { type: "text_delta", delta: "لغو شد" };
    persisted.push({ id: `m-${persisted.length}`, role: "assistant", content: "لغو شد" });
    yield { type: "done", runId: "run-f-2", failed: false };
    return;
  }
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
    agentThread: async () =>
      ({ messages: persisted.map((m) => ({ ...m, tool_calls: [], proposal: null })), floor: [] }),
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
    /* the runner answers the server on every path, the decline included */
    deliverToolResult: async () => undefined,
  },
}));

const { Hub } = await import("./Hub");

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

/** The thread's scroll box — the one region carrying the overflow class. */
function scroller(): HTMLElement {
  const el = document.querySelector('[class*="overflow-y-auto"]');
  if (!el) throw new Error("thread scroller not rendered");
  return el as HTMLElement;
}

describe("Hub — the thread scrolls, the page does not", () => {
  let ro: ReturnType<typeof installFakeResizeObserver>;
  beforeEach(() => {
    release = [];
    persisted.length = 0;
    ro = installFakeResizeObserver();
  });
  afterEach(() => {
    ro.uninstall();
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

    /*
     * THE FADE MUST NOT EAT THE NEWEST LINE (2026-09-06). `.fade-scroll`
     * masks the box's last 1.25rem to transparent, and the box carried no
     * vertical padding — so a pinned thread showed its latest line half
     * ghosted, at the one place the reader is looking. The padding equals
     * the fade edge (Tailwind's step 5 = 1.25rem), read from the stylesheet
     * rather than restated: a pair, not two numbers.
     */
    const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");
    expect(css).toMatch(/\.fade-scroll \{[^}]*var\(--fade-edge, 1\.25rem\)/);
    expect(box.className).toMatch(/(^|\s)py-5(\s|$)/);
    /* and the follow watches this box and the one wrapper inside it */
    expect(ro.observed()).toContain(box);
    expect(ro.observed().filter((el) => el !== box && box.contains(el)).length).toBe(1);

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

    // the rest of the answer streams in — the box's content changes size —
    // and must NOT yank them down
    release.shift()!();
    await screen.findByText(/دوم/);
    await waitFor(() => expect(screen.queryByText("در حال فکر کردن…")).toBeNull());
    ro.fire();
    expect(writes.length).toBe(0);

    // their own send re-pins: they acted at the composer, and a thread that
    // does not show the question they just sent reads as having eaten it
    await ask("سؤال دو");
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    // pinning is a position: the container is put AT its bottom
    expect(writes[0]).toBe(1000);
    // and from here every size change is followed again
    const before = writes.length;
    ro.fire();
    expect(writes.length).toBe(before + 1);
    expect(writes[writes.length - 1]).toBe(1000);

    release.shift()!();
    await waitFor(() => expect(screen.getAllByText(/دوم/).length).toBeGreaterThan(0));
  });

  it("the consent card lands INSIDE what the follow watches, and is followed like any other growth", async () => {
    /*
     * The screenshot that opened this (2026-09-06): «رؤیا: در حال فکر کردن…»
     * with the card «دستیار می‌خواهد: بایگانی تسک — «دکتر»» under it, below
     * the fold. The card is not a message, so a follow keyed on the message
     * list never ran for it. Keyed on geometry it does — provided the card
     * renders inside the observed wrapper; a card rendered as the box's
     * sibling would be invisible to the follow, and this assertion is what
     * fails then.
     */
    render(<Hub />);
    await ask("یک تسک آزمایشی بساز");
    const decline = await screen.findByRole("button", { name: "نه" });
    expect(screen.getByText(/ساختن تسک/).textContent).toContain("کارت اجازه");

    const el = scroller();
    const inside = ro.observed().filter((node) => node !== el && el.contains(node));
    expect(inside.length, "one content wrapper is observed").toBe(1);
    expect(inside[0]!.contains(decline), "the card is inside the observed content").toBe(true);

    // the card's arrival is a size change; pinned, the box goes to its bottom
    const writes: number[] = [];
    let top = 0;
    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", {
      configurable: true, get: () => top, set: (value: number) => { top = value; writes.push(value); },
    });
    ro.fire();
    expect(writes).toEqual([1000]);

    // «نه»: the runner answers the server, the run continues, nothing was created
    decline.click();
    await screen.findByText(/لغو شد/);
    await waitFor(() => expect(screen.queryByRole("button", { name: "نه" })).toBeNull());
  });
});
