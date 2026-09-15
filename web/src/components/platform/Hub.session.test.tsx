import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";

/**
 * **The session id must be captured from the `session` event and sent back on
 * the next ask.**
 *
 * This is the one behaviour in the hub that fails invisibly. A client that
 * drops the id starts a brand-new conversation on every message: the answer
 * still streams, the thread still renders, nothing on screen is wrong — and the
 * assistant has no memory of the previous turn while appearing to. There is no
 * visual symptom to notice, which is exactly why it needs a test that inspects
 * the *argument* rather than the output.
 *
 * `created: true` is the only place a new id is ever announced, so this is also
 * the only moment it can be lost.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/*
 * `@/i18n/routing`'s Link reads next-intl's real locale context, which the
 * setup's `useTranslations` stub does not provide. Stubbed to a plain anchor:
 * the Echo card's routing is not what this file is about, and leaving it
 * unmocked fails the suite for a reason unrelated to session continuity.
 */
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/*
 * The hub reads `?c=` to resume a conversation, so it needs a search-params
 * source. Empty here: this file is about a LIVE conversation, and a resume
 * param would silently load a thread instead of starting one.
 */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

/** Every `ask` call's third argument, in order. */
const askCalls: (string | undefined)[] = [];
const sourceSearches: string[] = [];
const visibleTools: string[] = [];
const askedQuestions: string[] = [];
/** the CONTEXT of every ask, in order: the `@` picker is the only producer
    of `callIds` on this surface, so its wire is what proves it works. */
const askedCalls: string[][] = [];
/** every refusal the composer raised - a drop that loses a file in silence
    is the defect the ceiling exists to prevent */
const errors: string[] = [];
const SESSION_ID = "sess-fixed-1";

/**
 * What the server has PERSISTED, appended as the script streams. The mock
 * must honour persisted-before-done (rule 10): `done` means the turn is
 * already written, and the hub refetches after it — a mock whose refetch
 * returns [] would wipe the thread and fail the render for a reason the
 * real wire guarantees cannot happen.
 */
const persisted: { id: string; role: "user" | "assistant"; content: string }[] = [];

async function* scriptedAsk(
  q: string,
  ctx: { page: string; callIds: string[] },
  sessionId?: string,
): AsyncGenerator<AgentEvent> {
  askCalls.push(sessionId);
  askedQuestions.push(q);
  askedCalls.push(ctx.callIds);
  // mirrors the wire: `session` first, `created` false when continuing
  yield { type: "session", id: sessionId ?? SESSION_ID, created: sessionId === undefined };
  persisted.push({ id: `m-${persisted.length}`, role: "user", content: q });
  yield { type: "text_delta", delta: "پاسخ" };
  persisted.push({ id: `m-${persisted.length}`, role: "assistant", content: "پاسخ" });
  yield { type: "done", runId: "run-1", failed: false };
}

/*
 * The refusals are TOASTS, and a toast is fire-and-forget - it leaves nothing
 * on this component to assert against. Captured at the bus so a drop that
 * loses a file in silence fails here, which is the whole reason the ceiling
 * raises a sentence instead of returning early.
 */
vi.mock("@/lib/notify", async () => {
  const real = await vi.importActual<typeof import("@/lib/notify")>("@/lib/notify");
  return { ...real, notifyError: (text: string) => { errors.push(text); } };
});


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
    ask: (...args: Parameters<typeof scriptedAsk>) => scriptedAsk(...args),
    agentThread: async () =>
      ({ messages: persisted.map((m) => ({ ...m, tool_calls: [] })), floor: [] }),
    // the Part-1 surface the hub now touches on mount / after done — empty
    // answers keep the pickers unrendered and the subject of THIS file
    // (session continuity) unchanged
    models: async () => ({ models: [], preferred_model: null, curated: false, tool_capability_filtered: false }),
    /* ONE SYSTEM SKILL, so the starter chips have something to be. Its
       starters come from the CATALOGUE (useSkillStarters reads
       `skills.starters_<slug>` for a system skill), which is why the wire's
       own list is deliberately different here: a test that pinned the wire's
       strings would pass against a version that stopped consulting the
       catalogue and started rendering English on a Persian screen. */
    skills: async () => [{
      id: "sk-1", level: "system", slug: "tasks", name: "کارها", description: "",
      tools: [], model: null, editable: false, enabled: true, starter_questions: ["از سیم"],
      max_tool_calls: null,
    }],
    agents: async () => [],
    /* the hub reads the workflow cards to name an auto-run's opening
       line; EMPTY is the honest fixture here — with no card there is no
       run, which is what these files are about (none of them arrive with
       a workflow on the URL) */
    workflows: async () => [],
    /* the RECORD index, which is what the `@` picker asks. A TITLE hit and a
       TRANSCRIPT hit on a different record, because that is what the wire does
       and it is the distinction the picker turns on: `kind: "call"` means the
       record is CALLED that, while a transcript hit means some record said the
       word somewhere inside it. */
    search: async (query: string) => {
      sourceSearches.push(query);
      if (!"jalase".startsWith(query.toLowerCase()) && !query.toLowerCase().startsWith("jal")) return [];
      return [
        {
          call_id: "call-7", call_title: "جلسهٔ محصول", call_date: "2026-09-01T09:00:00Z",
          kind: "call" as const, start_ms: null, end_ms: null, snippet: "",
        },
        {
          call_id: "call-9", call_title: "تماس فروش", call_date: "2026-08-20T09:00:00Z",
          kind: "transcript" as const, start_ms: 0, end_ms: 1000, snippet: "",
        },
      ];
    },
    assistantTools: async () => visibleTools,
    sessionFeedback: async () => ({}),
    shareState: async () => false,
    agentSessions: async () => [],
    /* the composer stopped reading this when its ⊕ was replaced by the
       paperclip (2026-09-08) — the connectors submenu went with the menu. Kept
       because the hub is rendered inside surfaces that still ask, and an absent
       method throws inside a promise: the failure then surfaces as whatever
       died next rather than as the missing stub. */
    connectors: async () => [],
    /* the thread reads its own drafts on every run and resume */
    mailDrafts: async () => [],
  },
}));

const { Hub } = await import("./Hub");
const { AssistantMenu } = await import("./AssistantMenu");
const { AssistantConversationProvider } = await import("./AssistantConversationState");

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
   * BY ITS TITLE, not by a style class. `button.bg-accent` was "the first
   * accent-coloured button in the document", which is a fact about the
   * stylesheet rather than about the send control — and the day the toolbar
   * above the hub grew an accent button, this helper started clicking that
   * one instead and every test using it failed for a reason unrelated to its
   * subject.
   */
  const send = screen.getByTitle("ارسال") as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  send.click();
}

/**
 * Write into the box the way a keyboard does, CARET INCLUDED.
 *
 * The mention is decided by the run of characters between an `@` and the
 * CARET, so a helper that sets the value and leaves the selection at zero is
 * a helper that can never open the picker — it would report the feature
 * broken while measuring its own fixture.
 */
function type(box: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")!.set!;
  setter.call(box, text);
  box.selectionStart = text.length;
  box.selectionEnd = text.length;
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

function textFile(name: string, body: string): File {
  return new File([body], name, { type: "text/plain" });
}

/** a real `drop`, carrying the `dataTransfer` the browser would carry */
function dropOf(files: File[]): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } });
  return event;
}

describe("Hub — session continuity", () => {
  beforeEach(() => {
    askCalls.length = 0;
    sourceSearches.length = 0;
    visibleTools.length = 0;
    askedQuestions.length = 0;
    askedCalls.length = 0;
    errors.length = 0;
    persisted.length = 0;
  });

  it("starts without a session id, then sends the captured one back", async () => {
    render(<Hub />);

    await ask("سؤال یک");
    await waitFor(() => expect(askCalls.length).toBe(1));
    // first turn: no session exists yet, so none is sent
    expect(askCalls[0]).toBeUndefined();

    await waitFor(() => expect(screen.getByText("پاسخ")).toBeTruthy());

    await ask("سؤال دو");
    await waitFor(() => expect(askCalls.length).toBe(2));
    /*
     * The assertion that matters. If this is `undefined`, every message opens
     * a new conversation while the UI looks perfect — the failure with no
     * visual symptom.
     */
    expect(askCalls[1]).toBe(SESSION_ID);
  });

  it("keeps the same session across a third turn — not just the second", async () => {
    render(<Hub />);
    await ask("یک");
    await waitFor(() => expect(askCalls.length).toBe(1));
    await ask("دو");
    await waitFor(() => expect(askCalls.length).toBe(2));
    await ask("سه");
    await waitFor(() => expect(askCalls.length).toBe(3));
    // a ref that is written but never re-read would still pass a two-turn test
    expect(askCalls.slice(1)).toEqual([SESSION_ID, SESSION_ID]);
  });

  it("starts a fresh Home conversation from the enabled left-menu item", async () => {
    render(
      <AssistantConversationProvider>
        <AssistantMenu activeSlug="new" />
        <Hub />
      </AssistantConversationProvider>,
    );

    await ask("شروع گفتگو");
    await waitFor(() => expect(screen.getByText("پاسخ")).toBeTruthy());

    const fresh = screen.getByRole("button", { name: "گفتگوی تازه" });
    expect(fresh.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(fresh);

    await waitFor(() => expect(screen.queryByText("پاسخ")).toBeNull());
  });

  it("offers ONE attachment control and no menu — no Create, no Sources", async () => {
    /*
     * THE MENU LEFT.
     *
     * Asserted as an ABSENCE beside a PRESENCE, and the pair is the point: a
     * composer that lost the paperclip too would satisfy every absence line
     * below, and it is the version this directive is least likely to be read
     * as asking for.
     */
    render(<Hub />);

    expect(screen.getByRole("button", { name: "پیوست فایل" })).toBeTruthy();
    /* «افزودن» was the plus, and it was the ONLY door to all three submenus —
       so its absence is the absence of Create, Sources and Connectors here */
    expect(screen.queryByRole("button", { name: "افزودن" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "ساختن" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "منابع" })).toBeNull();
    expect(screen.queryByText("سند")).toBeNull();
    expect(screen.queryByText("پی‌دی‌اف")).toBeNull();
    /* the web toggle went with Sources: nothing may still be asking for it */
    expect(screen.queryByText("جست‌وجوی وب")).toBeNull();
    expect(sourceSearches, "nothing may still be searching the index").toEqual([]);
  });

  it("presses the paperclip straight into the file picker — no menu in between", async () => {
    /*
     * ONE PRESS, ONE ACT. The old route was plus → «منابع» → «پیوست فایل», and
     * what the directive asked for is the act itself. The hidden `<input>` is
     * where the browser's dialog comes from, so its `click` IS the feature —
     * a test that only found the button would pass against a control wired to
     * nothing, which is the failure this composer has already shipped once
     * (the `@` button that inserted a character and opened no picker).
     */
    render(<Hub />);
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker, "the composer still owns a file input").toBeTruthy();
    /* SEVERAL at a time: a drop and a multi-select both arrive as a list, and
       the single-file version silently kept the first one */
    expect(picker.multiple).toBe(true);

    const opened = vi.fn();
    picker.addEventListener("click", opened);
    await userEvent.click(screen.getByRole("button", { name: "پیوست فایل" }));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("attaches a dropped file, and refuses the one past the ceiling by name", async () => {
    /*
     * "allow drag and drop". The drop is the browser's only way to hand a file
     * over, so it is asserted through a real `drop` event carrying a
     * `dataTransfer` — not by calling the handler, which would test the
     * fixture. `preventDefault` is asserted on `dragover` because without it
     * the browser NAVIGATES to the file and the half-typed question is gone.
     */
    render(<Hub />);
    const box = screen.getByPlaceholderText(/بپرسید/).closest("div.relative")
      ?? screen.getByPlaceholderText(/بپرسید/).parentElement!;

    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"] } });
    fireEvent(box, over);
    expect(over.defaultPrevented, "a dropped file must not navigate the page").toBe(true);

    fireEvent(box, dropOf([textFile("notes.md", "salam"), textFile("more.md", "baaz")]));
    await waitFor(() => expect(screen.getByText("notes.md")).toBeTruthy());
    expect(screen.getByText("more.md")).toBeTruthy();

    /* the CEILING, and the refusal has to be its own sentence: a drop that
       silently loses the fourth file is the same defect one level up */
    fireEvent(box, dropOf([textFile("third.md", "se"), textFile("fourth.md", "chahaar")]));
    await waitFor(() => expect(screen.getByText("third.md")).toBeTruthy());
    expect(screen.queryByText("fourth.md")).toBeNull();
    expect(errors.some((m) => m.includes("۳") || m.includes("3")), errors.join(" | ")).toBe(true);
  });

  it("names a call with @, attaches it as an id, and sends it as context", async () => {
    /*
     * "add a feature to do @ and add a call" — and the whole feature is that
     * the ID travels while the TITLE is what a person reads. So this asserts
     * the wire (`callIds`), the chip, and that the handle does NOT survive in
     * the question: a leftover `@jalase` in the sentence would be a second,
     * weaker claim about the same record, and the one the model would read.
     */
    render(<Hub />);
    const box = screen.getByPlaceholderText(/بپرسید/) as HTMLTextAreaElement;

    type(box, "@jal");
    await waitFor(() => expect(sourceSearches).toContain("jal"));
    const row = await screen.findByText("جلسهٔ محصول");
    /* a transcript hit is not a record NAMED that, so it is not on offer -
       without this the picker could be a plain search box wearing an `@` */
    expect(screen.queryByText("تماس فروش")).toBeNull();
    fireEvent.mouseDown(row);

    await waitFor(() => expect(screen.getByLabelText(/جلسهٔ محصول/)).toBeTruthy());
    expect(box.value, "the handle is replaced, not left behind").toBe("");

    type(box, "چه تصمیمی گرفتیم؟");
    screen.getByTitle("ارسال").click();
    await waitFor(() => expect(askedCalls.length).toBe(1));
    expect(askedCalls[0]).toEqual(["call-7"]);
    expect(askedQuestions[0]).toBe("چه تصمیمی گرفتیم؟");
  });

  it("asks the index only for a real query, and stops asking once a call is chosen", async () => {
    /*
     * The two halves a picker gets wrong. A bare `@` must open the FRAME and
     * ask nothing (core refuses under two characters, so a request there can
     * only ever come back empty), and choosing a row must CLOSE it — a panel
     * left open over the box is what turns the next keystroke into a press on
     * a row nobody is looking at.
     */
    render(<Hub />);
    const box = screen.getByPlaceholderText(/بپرسید/) as HTMLTextAreaElement;

    type(box, "@");
    expect(await screen.findByText(/دو نویسه/)).toBeTruthy();
    expect(sourceSearches, "a bare @ asks the index nothing").toEqual([]);

    type(box, "@jal");
    await waitFor(() => expect(sourceSearches).toEqual(["jal"]));
    fireEvent.mouseDown(await screen.findByText("جلسهٔ محصول"));
    /* the LIST, by its own label - the title itself stays on screen as the
       chip, so asserting on the text would pass against a picker still
       standing open over the box */
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "رکوردهایی که می‌توانید پیوست کنید" })).toBeNull(),
    );
  });

  it("stands the suggestions ON the composer, and drops them once a turn exists", async () => {
    /*
     * "move the suggested items to be above the composer" (2026-09-08). They
     * had been pinned to the TOP of a `justify-start flex-1` scroller, so on a
     * tall screen the row a person is meant to press sat a screen away from
     * the box it fills.
     *
     * Asserted as DOCUMENT ORDER, because that is the claim: a class
     * assertion cannot tell "above the composer" from "at the top of the
     * page", and both versions render the same chip. `compareDocumentPosition`
     * answers the question actually being asked.
     */
    render(<Hub idleContent={<p>SNAPSHOT</p>} />);
    const chip = await screen.findByRole("button", { name: "کارهای این تماس را فهرست کن" });
    const box = screen.getByPlaceholderText(/بپرسید/);
    const snapshot = screen.getByText("SNAPSHOT");

    /* Node.DOCUMENT_POSITION_FOLLOWING = 4: the argument comes AFTER */
    expect(chip.compareDocumentPosition(box) & 4, "the composer follows the chips").toBe(4);
    expect(snapshot.compareDocumentPosition(chip) & 4, "the chips follow the page's own content").toBe(4);

    /* the CATALOGUE's words, not the wire's - a system skill's starters are
       translated, and the mock's `starter_questions` is deliberately a
       different string so this can tell the two apart */
    expect(screen.queryByText("از سیم")).toBeNull();

    /* one press FILLS the box; sending stays the person's act */
    fireEvent.click(chip);
    expect(box).toHaveValue("کارهای این تماس را فهرست کن");
    expect(askCalls, "a suggestion sends nothing by itself").toEqual([]);

    /* and they LEAVE once there is a conversation: four openers under an
       answer are an offer to start something that has already started */
    await ask("سلام");
    await waitFor(() => expect(screen.getByText("پاسخ")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "کارهای این تماس را فهرست کن" })).toBeNull();
  });

  it("offers NO Tools menu in the composer — removed by directive, guarded against return", () => {
    // The Tools registry menu was removed from the composer (user directive,
    // 2026-08-20). This is the absence half: the directive holds only while
    // something fails when the menu quietly comes back.
    render(<Hub />);
    expect(screen.queryByRole("button", { name: "ابزارها" })).toBeNull();
  });
});
