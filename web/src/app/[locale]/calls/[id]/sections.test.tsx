import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Call, CallNote, SummaryVersion } from "@/api/types";

/**
 * The record page's ACTIONS & DECISIONS and NOTES & ATTACHMENTS sections
 * (user directive, 2026-08-28: the only ⋯ in view there was the record-wide
 * one, and neither section could take data).
 *
 * Three claims under test, each with the failure mode that renders fine:
 *
 *  - **The note composer posts what it says and the list adopts the
 *    SERVER'S row.** A composer that refetched would also show the note —
 *    so the adoption assert is paired with a call-count on the list read:
 *    one fetch, at mount, ever.
 *  - **A manual action item travels through the 0092 door as ONE inserted
 *    line.** The expected body is a hand-written literal, not a call to the
 *    same helper the page uses — an expectation computed by the code under
 *    test can only ever agree with it.
 *  - **The kebabs, as WHOLE lists.** An absence check cannot catch a stray
 *    extra (the workflow page's precedent) — so each menu is compared as
 *    one ordered list, including the page header's, which pins "the
 *    record-wide menu lives on the header alone" from both directions.
 */

const CALL: Call = {
  id: "c-1",
  title: "جلسهٔ بودجه",
  scope: "private",
  status: "ready",
  language: "fa",
  started_at: "2026-08-27T10:00:00.000Z",
  duration_ms: 60000,
  owner_id: "u-1",
  source: null,
  archived_at: null,
  deleted_at: null,
  purge_after: null,
  current_summary_id: "s-1",
  updated_at: "2026-08-27T11:00:00.000Z",
  transcript_timing: "full",
  tags: [],
};

/** the models' own house style — matches the unit fixture's dialect, but the
    EXPECTED string below is hand-computed, never derived via the helper */
const DOC = "**اقدام‌ها:**\n- تهیهٔ گزارش هزینه‌ها\n\n**تصمیم‌ها:**\n- بودجه ثابت می‌ماند";
const DOC_AFTER =
  "**اقدام‌ها:**\n- تهیهٔ گزارش هزینه‌ها\n- پیگیری قرارداد\n\n**تصمیم‌ها:**\n- بودجه ثابت می‌ماند";

let SUMMARIES: SummaryVersion[] = [];
let NOTES: CallNote[] = [];

vi.mock("@/components/echo/EchoAppShell", () => ({
  EchoAppShell: ({ children, menu }: { children: React.ReactNode; menu?: React.ReactNode }) => (
    <div>{menu}{children}</div>
  ),
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/calls/c-1",
}));

vi.mock("@/api/client", () => ({
  api: {
    getCall: async () => CALL,
    getTranscript: async () => [],
    getSpeakers: async () => [],
    directory: async () => [],
    me: async () => ({
      id: "u-1", org_id: "o-1", username: "member", email: "member@example.test",
      display_name: "عضو", avatar_url: null, role: "member", status: "active",
      locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
      calendar: "auto", timezone: "auto",
    }),
    listCalls: async () => [],
    getCallAudio: async () => null,
    getSummaries: vi.fn(async () => SUMMARIES),
    callNotes: vi.fn(async () => NOTES),
    addCallNote: vi.fn(async (
      _id: string,
      input: { kind: "note" | "chapter"; at_ms?: number | null; body: string },
    ): Promise<CallNote> => ({
      id: "n-9",
      kind: input.kind,
      at_ms: input.at_ms ?? null,
      body: input.body,
      created_by: "u-1",
      created_at: "2026-08-28T09:00:00.000Z",
    })),
    editSummary: vi.fn(async (_id: string, body: string) => {
      SUMMARIES = [
        ...SUMMARIES,
        {
          id: "s-2", version: (SUMMARIES.at(-1)?.version ?? 0) + 1, body,
          created_at: "2026-08-28T09:05:00.000Z", model: "human",
          agent_run_id: null, template: null,
        },
      ];
      return { version: SUMMARIES.at(-1)!.version };
    }),
  },
}));

const { default: CallDetailPage } = await import("./page");
const { CrumbTitleProvider } = await import("@/components/platform/CrumbTitle");
const { api } = await import("@/api/client");

async function open(): Promise<void> {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <CrumbTitleProvider>
          <CallDetailPage params={Promise.resolve({ id: "c-1" })} />
        </CrumbTitleProvider>
      </Suspense>,
    );
  });
}

/** the side menu's entry — the section state is local, so this is the door */
async function openSection(label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: label }));
  });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  SUMMARIES = [{
    id: "s-1", version: 1, body: DOC, created_at: "2026-08-27T11:00:00.000Z",
    model: "google/gemini-3.6-pro", agent_run_id: null, template: null,
  }];
  NOTES = [];
  window.history.replaceState(null, "", "/calls/c-1");
});

describe("the notes section takes data", () => {
  it("posts the typed body un-anchored, and the list adopts the returned row without a refetch", async () => {
    await open();
    await openSection("یادداشت‌ها و پیوست‌ها");

    const box = screen.getByRole("textbox", { name: "افزودن یادداشت" });
    fireEvent.change(box, { target: { value: "پیگیری با تیم مالی" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "افزودن یادداشت" }));
    });

    expect((api.addCallNote as Mock).mock.calls).toEqual([
      ["c-1", { kind: "note", at_ms: null, body: "پیگیری با تیم مالی" }],
    ]);
    // the SERVER'S row is on screen…
    expect(await screen.findByText("پیگیری با تیم مالی")).toBeTruthy();
    // …and it got there by adoption: the list was read once, at mount
    expect((api.callNotes as Mock).mock.calls.length).toBe(1);
    // the composer is ready for the next note
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("anchors at the playhead when asked — at_ms 0 is a moment, not the null it would otherwise be", async () => {
    await open();
    await openSection("یادداشت‌ها و پیوست‌ها");

    fireEvent.click(screen.getByRole("checkbox", { name: "ثبت در لحظهٔ ۰:۰۰" }));
    fireEvent.change(screen.getByRole("textbox", { name: "افزودن یادداشت" }), {
      target: { value: "نکتهٔ همین لحظه" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "افزودن یادداشت" }));
    });

    expect((api.addCallNote as Mock).mock.calls).toEqual([
      ["c-1", { kind: "note", at_ms: 0, body: "نکتهٔ همین لحظه" }],
    ]);
  });
});

describe("the actions section takes data", () => {
  it("sends the document through the 0092 door with exactly one line added, and shows the new version's lane", async () => {
    await open();
    await openSection("کارها و تصمیم‌ها");

    fireEvent.change(screen.getByRole("textbox", { name: "افزودن اقدام" }), {
      target: { value: "پیگیری قرارداد" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "افزودن اقدام" }));
    });

    /* the whole travelling body, as a literal: the item inside the actions
       lane, every other byte untouched */
    expect((api.editSummary as Mock).mock.calls).toEqual([["c-1", DOC_AFTER]]);
    // the page adopted the door's new version — the lane shows the item
    expect(await screen.findByText("پیگیری قرارداد")).toBeTruthy();
  });
});

describe("the section kebabs", () => {
  it("gives the actions section its own menu — the whole list — and its jump really leaves", async () => {
    await open();
    await openSection("کارها و تصمیم‌ها");

    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های کارها و تصمیم‌ها" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "کپی کارها و تصمیم‌ها",
      "بازتولید خلاصه",
      "رفتن به خلاصه",
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "رفتن به خلاصه" }));
    });
    // the item is a door, not a label: the actions composer is gone…
    expect(screen.queryByRole("textbox", { name: "افزودن اقدام" })).toBeNull();
    // …and the summary's version picker is in view
    expect(screen.getByRole("button", { name: "نسخه‌ها" })).toBeTruthy();
  });

  it("gives the notes section its own menu — the whole list — and «افزودن یادداشت» lands the cursor in the box", async () => {
    await open();
    await openSection("یادداشت‌ها و پیوست‌ها");

    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های یادداشت‌ها" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "افزودن یادداشت",
      "کپی یادداشت‌ها",
    ]);

    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "افزودن یادداشت" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "افزودن یادداشت" }));
  });

  it("keeps the record-wide menu on the page header, unchanged — the whole list", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "عملیات بیشتر" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "دربارهٔ این رکورد بپرس",
      "ترجمه",
      "خروجی",
      "کپی خلاصه",
      "چاپ",
      "برای سازمان",
      "بایگانی",
      "برچسب‌ها",
    ]);
  });
});
