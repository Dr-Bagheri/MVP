import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/api/types";
import { GlobalSearch } from "./GlobalSearch";

const push = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const search = vi.fn();
vi.mock("@/api/client", () => ({ api: { search: (q: string) => search(q) } }));

vi.mock("@/lib/format", () => ({
  formatClock: () => "۰:۱۲",
  formatDate: () => "۱۷ شهریور",
}));

/** one hit of each kind — the grouping and the arrow order are both about kind */
const HITS: SearchHit[] = [
  {
    call_id: "c-title",
    call_title: "جلسهٔ دیتابیس صوتی",
    call_date: "2026-09-01T10:00:00Z",
    kind: "call",
    start_ms: null,
    end_ms: null,
    snippet: "جلسهٔ <mark>دیتابیس</mark> صوتی",
  },
  {
    call_id: "c-line",
    call_title: "هم‌فکری هفتگی",
    call_date: "2026-09-02T10:00:00Z",
    kind: "transcript",
    start_ms: 12_000,
    end_ms: 15_000,
    snippet: "درباره <mark>دیتابیس</mark> حرف زدیم",
  },
  {
    call_id: "c-sum",
    call_title: "بازبینی محصول",
    call_date: "2026-09-03T10:00:00Z",
    kind: "summary",
    start_ms: null,
    end_ms: null,
    snippet: "تصمیم دربارهٔ <mark>دیتابیس</mark>",
  },
];

beforeEach(() => {
  push.mockClear();
  search.mockReset();
  search.mockResolvedValue(HITS);
});

/** the field, by the label every locale gives it */
function field() {
  return screen.getByRole("combobox");
}

describe("the top bar's search box", () => {
  it("opens on TYPING, never on focus alone (the directive)", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.click(field());
    /*
     * The load-bearing half. A box that opened on focus would drop a panel
     * over the page every time a pointer passed through the field — and a
     * version that opens on focus satisfies every assertion below, because
     * typing focuses too. This is the only case that can tell them apart.
     */
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.keyboard("د");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("says WHICH nothing it has under two characters, and asks core nothing", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.click(field());
    await user.keyboard("د");

    expect(screen.getByText("دست‌کم دو نویسه بنویسید.")).toBeInTheDocument();
    /* core 400s below two characters — the box says so rather than asking */
    expect(search).not.toHaveBeenCalled();
  });

  it("shows the hits INSIDE the box, grouped by kind, with the marks as marks", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.click(field());
    await user.keyboard("دیتابیس");

    await waitFor(() => expect(search).toHaveBeenCalledWith("دیتابیس"));
    const list = await screen.findByRole("listbox");

    expect(within(list).getByText("رکوردها")).toBeInTheDocument();
    expect(within(list).getByText("متن گفتگو")).toBeInTheDocument();
    expect(within(list).getByText("خلاصه‌ها")).toBeInTheDocument();
    expect(within(list).getAllByRole("option")).toHaveLength(3);

    /*
     * The snippet arrives as `<mark>` text from core and is rendered through
     * the shared whitelist. Asserting the ELEMENT is what tells a highlight
     * apart from a literal "<mark>" printed on the row — which is what a
     * plain-text render of the same string looks like.
     */
    const marks = list.querySelectorAll("mark");
    expect(marks).toHaveLength(3);
    expect(marks[0]).toHaveTextContent("دیتابیس");
  });

  it("walks the rows with the arrows and opens the one under the cursor by CLICK", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.click(field());
    await user.keyboard("دیتابیس");
    /*
     * WAIT FOR THE ROWS, not for the box. The listbox renders from the first
     * keystroke — it carries the hint and the searching line — so
     * `findByRole("listbox")` resolves BEFORE the debounced answer lands, and
     * the arrows would then be walking an empty list. The first version of
     * this test did exactly that and reported the door to the page, which is
     * the correct behaviour for an empty panel and not what it was asking.
     */
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));

    /* the cursor starts on the first row, so one press moves to the second —
       the transcript hit, which is the group AFTER the title matches. The
       press MOVES the highlight; opening is the click, because Enter does
       nothing here now (see the two cases below). */
    await user.keyboard("{ArrowDown}");
    const rows = screen.getAllByRole("option");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");

    await user.click(rows[1]!);
    expect(push).toHaveBeenCalledWith("/calls/c-line");
  });

  /**
   * ENTER DOES NOTHING (user directive, 2026-09-15: "the search bar is
   * searching when you type and it is enough, when you enter it does not need
   * to do anything"), because the page it used to submit to is deleted.
   *
   * THE PAIR IS THE TEST, and the second half is the one that matters: "Enter
   * navigates nowhere" is also true of a box whose Enter RELOADS THE PAGE —
   * which is what a `<form>` does with no submit handler at all, and it would
   * take the panel, the query and the rest of the screen with it. So the
   * second case asserts the default was prevented, which is the only thing
   * that tells the two apart in jsdom.
   */
  it("does NOTHING on Enter — no navigation, over rows or over nothing", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.click(field());
    await user.keyboard("دیتابیس");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));

    await user.keyboard("{Enter}");
    expect(push, "Enter still went somewhere").not.toHaveBeenCalled();

    /* and with the cursor moved onto a row, which is where the old Enter
       opened a record — the directive is about the KEY, not about the query */
    await user.keyboard("{ArrowDown}{Enter}");
    expect(push).not.toHaveBeenCalled();

    /* over an answer with nothing in it, which is where the old Enter left
       for the results page */
    search.mockResolvedValue([]);
    await user.keyboard("تر");
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    await user.keyboard("{Enter}");
    expect(push).not.toHaveBeenCalled();
  });

  it("THE CONTROL: the submit is PREVENTED, not merely unhandled", () => {
    render(<GlobalSearch />);
    const form = screen.getByRole("search");

    const submit = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);

    expect(submit.defaultPrevented, "Enter would reload the page").toBe(true);
  });

  it("offers NO door to a results page — the page is gone", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.click(field());
    await user.keyboard("دیتابیس");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));

    /*
     * Asserted over a FULL answer, which is the only state the door was ever
     * drawn in: over an empty one it was already absent, so a test there
     * would pass against the version that still ships it.
     *
     * AND ASSERTED AS STRUCTURE, NOT AS WORDS. The first version of this
     * looked for «همهٔ نتایج …» — the door's own label — and it could not
     * have failed: that label came from `platform.searchAll`, which was
     * deleted in the same change, so a door put back today renders
     * `MISSING_MESSAGE` and the text query finds nothing either way. A test
     * whose subject was removed alongside the thing it checks is the vacuous
     * kind this repo keeps minting. The door was the panel's only BUTTON —
     * every row is an `<li role="option">` — so counting buttons inside the
     * panel is a question a restored door must answer wrongly, whatever it
     * ends up saying.
     */
    const panel = screen.getByRole("listbox").parentElement!;
    expect(
      within(panel).queryAllByRole("button"),
      "something is drawn under the rows again",
    ).toHaveLength(0);
    expect(panel.querySelector("kbd"), "a key badge is advertised again").toBeNull();
  });

  it("closes on Escape without losing what was typed", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.click(field());
    await user.keyboard("دیتابیس");
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(field()).toHaveValue("دیتابیس");
  });

  it("keeps the caret in the FIELD while the panel is open", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.click(field());
    await user.keyboard("دیتابیس");
    await screen.findByRole("listbox");

    /*
     * Radix focuses its content on open. If that were left alone the caret
     * would leave the input mid-word and the next keystroke would go
     * nowhere — the panel is a readout of what the field is doing, not a
     * place to stand.
     */
    expect(document.activeElement).toBe(field());
  });

  it("survives a search outage by rendering the empty state, not by throwing", async () => {
    const user = userEvent.setup();
    search.mockRejectedValue(new Error("upstream"));
    render(<GlobalSearch />);

    await user.click(field());
    await user.keyboard("دیتابیس");

    expect(await screen.findByText("نتیجه‌ای پیدا نشد.")).toBeInTheDocument();
  });
});
