import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  _ctx: { page: string; callIds: string[] },
  sessionId?: string,
): AsyncGenerator<AgentEvent> {
  askCalls.push(sessionId);
  askedQuestions.push(q);
  // mirrors the wire: `session` first, `created` false when continuing
  yield { type: "session", id: sessionId ?? SESSION_ID, created: sessionId === undefined };
  persisted.push({ id: `m-${persisted.length}`, role: "user", content: q });
  yield { type: "text_delta", delta: "پاسخ" };
  persisted.push({ id: `m-${persisted.length}`, role: "assistant", content: "پاسخ" });
  yield { type: "done", runId: "run-1", failed: false };
}

vi.mock("@/api/client", () => ({
  api: {
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
      avatar_url: null, role: "admin", status: "active", locale: "fa",
      model_id: null, created_at: new Date().toISOString(),
    }),
    ask: (...args: Parameters<typeof scriptedAsk>) => scriptedAsk(...args),
    agentMessages: async () =>
      persisted.map((m) => ({ ...m, tool_calls: [], proposal: null })),
    // the Part-1 surface the hub now touches on mount / after done — empty
    // answers keep the pickers unrendered and the subject of THIS file
    // (session continuity) unchanged
    models: async () => ({ models: [], preferred_model: null, curated: false, tool_capability_filtered: false }),
    skills: async () => [],
    agents: async () => [],
    search: async (query: string) => {
      sourceSearches.push(query);
      return [];
    },
    assistantTools: async () => visibleTools,
    sessionFeedback: async () => ({}),
    shareState: async () => false,
  },
}));

const { Hub } = await import("./Hub");
const { AssistantMenu } = await import("./AssistantMenu");
const { AssistantConversationProvider } = await import("./AssistantConversationState");

async function ask(text: string) {
  const box = screen.getByPlaceholderText(/بپرسید/);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  const send = document.querySelector("button.bg-accent") as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  send.click();
}

describe("Hub — session continuity", () => {
  beforeEach(() => {
    askCalls.length = 0;
    sourceSearches.length = 0;
    visibleTools.length = 0;
    askedQuestions.length = 0;
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
        <AssistantMenu activeSlug="new" showNewConversation />
        <Hub />
      </AssistantConversationProvider>,
    );

    await ask("شروع گفتگو");
    await waitFor(() => expect(screen.getByText("پاسخ")).toBeTruthy());

    const fresh = screen.getByRole("link", { name: "گفتگوی تازه" });
    expect(fresh.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(fresh);

    await waitFor(() => expect(screen.queryByText("پاسخ")).toBeNull());
  });

  it("searches Sources from the first character, without an instruction or Echo shortcut", async () => {
    render(<Hub />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "منابع" }));
    const search = screen.getByPlaceholderText("جست‌وجو در تماس‌ها و جلسه‌ها…");
    fireEvent.change(search, { target: { value: "ا" } });

    await waitFor(() => expect(sourceSearches).toEqual(["ا"]));
    expect(screen.queryByText("برای جست‌وجو در رونوشت‌ها و خلاصه‌ها دست‌کم دو نویسه بنویسید.")).toBeNull();
    expect(screen.queryByText("جلسه‌ها — بازکردن اکو")).toBeNull();
  });

  it("selects Doc without putting an instruction inside the composer", async () => {
    render(<Hub />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "ساختن" }));
    const doc = screen.getByRole("menuitem", { name: /^سند/ });
    expect(doc).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^PDF/ })).toBeTruthy();
    expect(screen.queryByText("ضبط تماس")).toBeNull();
    expect(screen.queryByText("بارگذاری صدا")).toBeNull();
    expect(screen.queryByText("پرامپت تازه")).toBeNull();

    fireEvent.click(doc);
    await waitFor(() => expect(screen.getByRole("button", { name: "حذف سند" })).toBeTruthy());
    expect(screen.getByPlaceholderText(/بپرسید/)).toHaveValue("");

    await ask("گزارش جلسه");
    await waitFor(() => expect(askedQuestions).toContain("بر اساس این درخواست یک سند بساز:\n\nگزارش جلسه"));
  });

  it("shows Persian command names in the Persian tools menu", async () => {
    visibleTools.push("search_transcripts", "replace_summary");
    render(<Hub />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "ابزارها" }));
    expect(await screen.findByText("جست‌وجوی رونوشت‌ها")).toBeTruthy();
    expect(screen.getByText("جایگزینی خلاصه")).toBeTruthy();
    expect(screen.queryByText("search_transcripts")).toBeNull();
  });
});
