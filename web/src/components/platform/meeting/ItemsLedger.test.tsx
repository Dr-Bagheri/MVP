import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0211 — what a meeting item gained: the colleague who owes it, the day it is
 * owed, and whether it still stands.
 *
 * Its own file rather than more of `ItemsPanel.test.tsx`, for one reason that
 * matters: that file stubs next-intl to return the KEY verbatim, which is
 * right for asserting WHICH string a control uses and useless for asserting
 * what a reader sees. Here the real catalogue answers, so «تا …» and
 * «جایگزین شد» are the words on screen — and a missing key would render as
 * `meetings.itemDue` and fail loudly rather than quietly matching a key.
 */

vi.mock("@/i18n/routing", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

const meetingItems = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    meetingItems: (...a: unknown[]) => meetingItems(...a),
    addMeetingItem: vi.fn(),
    updateMeetingItem: vi.fn(),
    deleteMeetingItem: vi.fn(),
    createTask: vi.fn(),
    /* two colleagues, because a roster of one cannot tell a RESOLVED name
       from a lucky first row */
    orgPeople: async () => [
      { id: "u-1", display_name: "سینا سپاسی", display_name_en: null, role: "member", username: "sina" },
      { id: "u-2", display_name: "بهناز بهجتی", display_name_en: null, role: "member", username: "behnaaz" },
    ],
  },
}));

const { ItemsPanel, dayAsInstant } = await import("./ItemsPanel");

const row = (over: Record<string, unknown> = {}) => ({
  id: "i1", kind: "decision", body: "قرارداد امضا شود", source: "user",
  done: false, owner: null, at_ms: null, created_at: "2026-09-02T10:00:00Z",
  owner_id: null, due_on: null, supersedes_id: null, status: "standing", ...over,
});

const draw = () => render(<ItemsPanel meetingId="m1" locale="fa" />);

beforeEach(() => { meetingItems.mockReset(); });

describe("a row says who owes it and by when (0211)", () => {
  it("names the RESOLVED colleague, never their id", async () => {
    meetingItems.mockResolvedValue([row({ owner_id: "u-2", owner: "بهناز" })]);
    draw();
    /* a uuid on screen is a database key where a name goes — the exact defect
       the transcript surfaces were fixed for on 2026-09-06 */
    await waitFor(() => expect(screen.getByText("بهناز بهجتی")).toBeInTheDocument());
    expect(screen.queryByText("u-2")).toBeNull();
  });

  it("falls back to the SPOKEN name when the roster cannot match it", async () => {
    /* somebody with no account here is still somebody the meeting heard;
       showing nothing would lose the only record that anybody was named */
    meetingItems.mockResolvedValue([row({ owner_id: null, owner: "مهمان" })]);
    draw();
    await waitFor(() => expect(screen.getByText("مهمان")).toBeInTheDocument());
  });

  it("marks an overdue commitment and leaves a future one alone", async () => {
    meetingItems.mockResolvedValue([
      row({ id: "i1", body: "دیرکرد", due_on: "2020-01-01" }),
      row({ id: "i2", body: "بعداً", due_on: "2099-01-01" }),
    ]);
    draw();
    const late = await screen.findByText("دیرکرد");
    const soon = await screen.findByText("بعداً");
    const metaOf = (el: HTMLElement) => el.parentElement?.querySelector(".badge-num");
    /* the PAIR. "an overdue row is red" alone passes against a panel that
       paints every deadline red, which tells a reader nothing. */
    expect(metaOf(late)?.className ?? "").toContain("text-danger");
    expect(metaOf(soon)?.className ?? "").not.toContain("text-danger");
  });

  it("says a decision was superseded rather than hiding it", async () => {
    meetingItems.mockResolvedValue([
      row({ id: "i1", body: "بودجه کم می‌شود", status: "superseded" }),
      row({ id: "i2", body: "بودجه ثابت می‌ماند", supersedes_id: "i1" }),
    ]);
    draw();
    /* BOTH are on screen: a ledger whose reader cannot see what changed
       answers today's question with last quarter's decision */
    await waitFor(() => expect(screen.getByText("بودجه کم می‌شود")).toBeInTheDocument());
    expect(screen.getByText("بودجه ثابت می‌ماند")).toBeInTheDocument();
    expect(screen.getByText("جایگزین شد")).toBeInTheDocument();
    /* and the standing one wears no chip — without this, "the chip appears"
       is satisfied by a panel that labels every row */
    expect(screen.queryByText("برگشت خورد")).toBeNull();
  });

  it("renders a deadline in the reader's own words, not a raw date", async () => {
    meetingItems.mockResolvedValue([row({ due_on: "2026-10-02" })]);
    draw();
    await waitFor(() => expect(screen.getByText(/تا /)).toBeInTheDocument());
    expect(screen.queryByText("2026-10-02")).toBeNull();
  });

  it("hands a DAY over at local noon, so no zone can move it", () => {
    /*
     * ASSERTED ON THE CONVERTER, not through the screen — and that is the
     * finding rather than a shortcut. The rendered version of this cannot
     * fail here: the suite runs at +03:30, where a midnight instant still
     * formats to the same day, so the mutation that hands over
     * `${day}T00:00:00Z` came back GREEN through the DOM. The defect only
     * appears west of Greenwich, which is a reader this test cannot be.
     *
     * The mechanism is what makes it true everywhere: local noon is twelve
     * hours from either edge of the day, so no offset the platform accepts
     * (−12…+14) can push it across one.
     */
    const at = new Date(dayAsInstant("2026-10-02"));
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(2);
    expect(at.getHours()).toBe(12);
  });
});
