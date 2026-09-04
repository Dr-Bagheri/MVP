import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/* the shell moved out of the deleted Echo folder (2026-09-04) and took its
   prop's name with it: `menu` became `toolbar`, because the row this page
   hands it is its OWN four tabs and never was Echo's section menu */
vi.mock("@/components/platform/ToolbarShell", () => ({
  ToolbarShell: ({ children, toolbar }: { children: React.ReactNode; toolbar?: React.ReactNode }) => (
    <div>{toolbar}{children}</div>
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
    resummarize: vi.fn(async () => ({ id: "r-1", status: "queued" })),
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
    /* the section switcher is the toolbar's BUTTONS now (2026-09-02, the
       audit): it was a vertical SectionMenu of links that prevented their
       own navigation — a link that goes nowhere is a button wearing an href */
    fireEvent.click(screen.getByRole("button", { name: label }));
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

    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های کارها و تصمیم‌ها" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "کپی کارها و تصمیم‌ها",
      "بازتولید خلاصه",
      "رفتن به خلاصه",
    ]);

    await act(async () => {
      await userEvent.click(screen.getByRole("menuitem", { name: "رفتن به خلاصه" }));
    });
    // the item is a door, not a label: the actions composer is gone…
    expect(screen.queryByRole("textbox", { name: "افزودن اقدام" })).toBeNull();
    // …and the summary's version picker is in view
    expect(screen.getByRole("button", { name: "نسخه‌ها" })).toBeTruthy();
  });

  it("gives the notes section its own menu — the whole list — and «افزودن یادداشت» lands the cursor in the box", async () => {
    await open();
    await openSection("یادداشت‌ها و پیوست‌ها");

    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های یادداشت‌ها" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "افزودن یادداشت",
      "کپی یادداشت‌ها",
    ]);

    await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "افزودن یادداشت" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "افزودن یادداشت" }));
  });

  it("keeps the record-wide menu on the page header, unchanged — the whole list", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "عملیات بیشتر" }));
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

/**
 * ── TASK 1 · each section owns its scroll ───────────────────────────────────
 *
 * User directive (2026-08-29): *"for transcription page and summary page they
 * have to have their own scroll and not make the page scroll mode."*
 *
 * jsdom computes no layout, so nothing here can prove a box actually scrolls —
 * that is a live-render claim and it is reported as unmeasured. What IS
 * checkable, and is the thing that broke, is WHERE the split falls: the
 * section's body inside one scroller, the section's frame outside it. The
 * outside half is the assertion that can answer NO — a scroller wrapped
 * around the whole section satisfies every "is the body inside" check and is
 * exactly the wrong shape.
 */
describe("each section owns its scroll", () => {
  it("puts the summary document inside ONE scroller and leaves its header outside", async () => {
    await open();
    const boxes = document.querySelectorAll("[data-section-scroll]");
    // one per rendered section — not one per branch, and not one per page
    expect(boxes.length).toBe(1);
    const box = boxes[0] as HTMLElement;

    // the document moves…
    expect(box.textContent).toContain("تهیهٔ گزارش هزینه‌ها");
    // …the frame does not: version picker, warnings slot and the ⋯ stay put
    expect(box.contains(screen.getByRole("button", { name: "نسخه‌ها" }))).toBe(false);
    expect(box.contains(screen.getByRole("button", { name: "گزینه‌های خلاصه" }))).toBe(false);
    expect(box.contains(screen.getByRole("heading", { name: "خلاصه" }))).toBe(false);
  });

  it("gives the transcript the same one box, with its own header outside it", async () => {
    await open();
    await openSection("رونوشت");
    const boxes = document.querySelectorAll("[data-section-scroll]");
    expect(boxes.length).toBe(1);
    const box = boxes[0] as HTMLElement;

    /* this fixture's transcript is empty, so the body is the which-nothing
       sentence — still the body, and still the part that scrolls */
    expect(box.textContent).toContain("رونویسی تمام شد");
    expect(box.contains(screen.getByRole("button", { name: "نمایش" }))).toBe(false);
    expect(box.contains(screen.getByRole("heading", { name: "رونوشت" }))).toBe(false);
  });

  it("is ONE mechanism, not four: every section renders exactly one, and its ⋯ stays outside", async () => {
    /* the whole point of extracting it — four sections that each picked a
       height is how the page ended up with one capped box and one that grew
       forever (and how M45's five page columns happened one level up) */
    await open();
    for (const [section, menu] of [
      ["خلاصه", "گزینه‌های خلاصه"],
      ["رونوشت", "نمایش"],
      ["کارها و تصمیم‌ها", "گزینه‌های کارها و تصمیم‌ها"],
      ["یادداشت‌ها و پیوست‌ها", "گزینه‌های یادداشت‌ها"],
    ] as const) {
      await openSection(section);
      const boxes = document.querySelectorAll("[data-section-scroll]");
      expect(`${section}: ${boxes.length}`).toBe(`${section}: 1`);
      expect(
        (boxes[0] as HTMLElement).contains(screen.getByRole("button", { name: menu })),
      ).toBe(false);
    }
  });
});

/**
 * ── TASK 2 · the regenerate offer moved into the summary's kebab ────────────
 *
 * User directive (2026-08-29): *"put the regenerate summary into the kebab
 * menu with sub menu in the kebab menu as well for its options"* — reversing
 * the 2026-08-25 cards, which took a section of the body to say it.
 *
 * The load-bearing pair: the cards are GONE from the body (a menu that merely
 * ALSO offers regeneration would pass every positive check below), and a
 * template chosen inside the submenu reaches `resummarize` with exactly the
 * arguments the card sent.
 */
describe("the regenerate offer lives in the summary's kebab", () => {
  it("no longer renders template cards in the page body", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "جلسهٔ هیئت‌مدیره" })).toBeNull();
    expect(screen.queryByRole("button", { name: "الگوی تازه" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "بازتولید خلاصه" })).toBeNull();
  });

  it("opens the whole template list as a submenu, and a pick regenerates exactly as the card did", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های خلاصه" }));

    const parents = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(parents.map((item) => item.textContent)).toEqual(["بازتولید خلاصه"]);

    // the parent OPENS the list rather than regenerating something itself
    fireEvent.click(parents[0]!);
    expect((api.resummarize as Mock).mock.calls).toEqual([]);

    const menus = screen.getAllByRole("menu");
    expect(menus.length).toBe(2);
    const templates = within(menus[1]!).getAllByRole("menuitem");
    expect(templates.map((item) => item.textContent)).toEqual([
      "جلسهٔ هیئت‌مدیره",
      "جلسهٔ گروهی",
      "جلسهٔ تیمی",
      "جلسهٔ تیم فنی",
      "مصاحبه",
      "الگوی تازه",
    ]);

    await act(async () => {
      await userEvent.click(within(menus[1]!).getByRole("menuitem", { name: "جلسهٔ تیمی" }));
    });
    /* the card's own call, argument for argument (page.tsx: regenerate({
       template: k, label: k })) — a menu that regenerated with no template
       would look identical on screen */
    expect((api.resummarize as Mock).mock.calls).toEqual([
      ["c-1", { template: "team", label: "team" }],
    ]);
  });

  it("«الگوی تازه» opens the composer instead of regenerating anything", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های خلاصه" }));
    await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "بازتولید خلاصه" }));
    await userEvent.click(
      within(screen.getAllByRole("menu")[1]!).getByRole("menuitem", { name: "الگوی تازه" }),
    );

    expect((api.resummarize as Mock).mock.calls).toEqual([]);
    const dialog = screen.getByRole("alertdialog", { name: "الگوی تازه" });
    expect(within(dialog).getByRole("textbox", { name: "نام الگو" })).toBeTruthy();
    // an unnamed template cannot be saved — the button says so by staying off
    expect(
      (within(dialog).getByRole("button", { name: "ذخیرهٔ الگو" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

/**
 * ── TASK 3 · the grounding flags moved behind a warning icon ────────────────
 *
 * User directive (2026-08-29): *"add a warning small icon next to kebab menu
 * icon and put these kind of warning that are related to the summary there."*
 *
 * The load-bearing assertion is the NEGATIVE one: a clean pass renders no
 * icon at all. Everything else here would pass against a component that
 * always shows the icon — which is the version that teaches people to ignore
 * it. Verified red by making `SummaryWarnings` ignore `clean` before this was
 * trusted.
 */
describe("the summary's warnings", () => {
  const withGrounding = (
    grounding: { clean: boolean; model: string; flags: { claim: string; note: string }[] },
  ) => {
    SUMMARIES = [{
      id: "s-1", version: 1, body: DOC, created_at: "2026-08-27T11:00:00.000Z",
      model: "google/gemini-3.6-pro", agent_run_id: null, template: null, grounding,
    }];
  };

  it("renders NO icon when the pass is clean — and says so in one quiet line instead", async () => {
    withGrounding({ clean: true, model: "google/gemini-3.6-pro", flags: [] });
    await open();
    expect(screen.queryByRole("button", { name: "هشدارهای خلاصه" })).toBeNull();
    /* the positive control: the verdict DID render, so the absence above is
       "nothing to warn about" and not "the grounding block never arrived" */
    expect(screen.getByText(/سنجیده شد/)).toBeTruthy();
  });

  it("still renders no icon when a CLEAN verdict arrives carrying flags — the verdict's own word decides", async () => {
    /*
     * THE DISCRIMINATING CASE, and the reason the test above cannot stand
     * alone: a clean verdict normally carries an empty array, so "no icon"
     * there is satisfied by a component that never reads `clean` at all.
     *
     * The fixture is not invented: core's own parser
     * (worker/summarizer.ts · parseGroundingVerdict) refuses `clean:false`
     * with no flags — and accepts `clean:true` WITH them, storing it
     * verbatim. So this shape can reach the wire, and the rule that decides
     * it is the one under test.
     */
    withGrounding({
      clean: true,
      model: "google/gemini-3.6-pro",
      flags: [{ claim: "ادعا", note: "یادداشت" }],
    });
    await open();
    expect(screen.queryByRole("button", { name: "هشدارهای خلاصه" })).toBeNull();
  });

  it("renders no icon when the version was never checked — absent is not clean and neither is a warning", async () => {
    SUMMARIES = [{
      id: "s-1", version: 1, body: DOC, created_at: "2026-08-27T11:00:00.000Z",
      model: "google/gemini-3.6-pro", agent_run_id: null, template: null,
    }];
    await open();
    expect(screen.queryByRole("button", { name: "هشدارهای خلاصه" })).toBeNull();
    expect(screen.queryByText(/سنجیده شد/)).toBeNull();
  });

  it("shows the icon when claims are flagged, lists them in its panel, and Escape closes it", async () => {
    withGrounding({
      clean: false,
      model: "google/gemini-3.6-pro",
      flags: [{ claim: "بودجه دو برابر شد", note: "در رونوشت پشتوانه‌ای ندارد" }],
    });
    await open();

    // the amber box is out of the document body…
    const summaryBody = document.querySelector("[data-section-scroll]") as HTMLElement;
    expect(summaryBody.textContent).not.toContain("بودجه دو برابر شد");

    // …and behind the icon beside the ⋯
    await userEvent.click(screen.getByRole("button", { name: "هشدارهای خلاصه" }));
    const panel = screen.getByRole("dialog", { name: "هشدارهای خلاصه" });
    expect(panel.textContent).toContain("بودجه دو برابر شد");
    expect(panel.textContent).toContain("در رونوشت پشتوانه‌ای ندارد");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "هشدارهای خلاصه" })).toBeNull();
  });
});
