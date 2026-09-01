import { act, cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BffError } from "@/api/client";
import { __setPreferencesForTest } from "@/lib/preferences";
import type { Call, ConnectorItem, ConnectorStatus } from "@/api/types";

/**
 * THE KINDS OF NOTHING, on a glance surface.
 *
 * Every tile on this board can be empty for several different reasons, and on
 * screen they are one blank rectangle apiece unless something makes them
 * differ:
 *
 *   · we have not asked yet     → resolves on its own; say nothing yet
 *   · asked, nothing there      → a sentence about the ORGANIZATION
 *   · a 403                     → a permission, not a fault
 *   · a 404                     → for the calendar, nobody connected Google,
 *                                 which is an invitation rather than an error
 *   · anything else             → the only one worth an apology
 *
 * A tile that showed the waiting state forever would be lying by waiting, and
 * one that reported an outage as "you have no records" would make a false
 * claim about the organization. So each case checks that the state it is
 * about renders AND that the others do not: "the empty sentence is on screen"
 * is satisfied by a widget that shows it unconditionally.
 */

let CALLS: () => Promise<Call[]>;
let CALENDAR: () => Promise<ConnectorItem[]>;
let CONNECTORS: () => Promise<ConnectorStatus[]>;
let TASKS: () => Promise<{ columns: never[]; topics: never[]; tasks: never[] }>;
let MEETINGS: () => Promise<import("@/api/types").MeetingRecord[]>;

/* the shape is the PRODUCER's `CallSummary`, inherited through `Call` — a
   field this fixture invented would compile here and be undefined on the
   wire, which is the words-shape incident in miniature */
const call = (id: string, title: string): Call => ({
  id,
  title,
  status: "ready",
  source: "live",
  scope: "private",
  language: "fa",
  started_at: "2026-08-20T09:00:00.000Z",
  updated_at: "2026-08-20T09:30:00.000Z",
  duration_ms: 60_000,
  owner_id: "u-1",
  archived_at: null,
  deleted_at: null,
  purge_after: null,
  current_summary_id: null,
  transcript_timing: "full",
});

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/",
}));

/*
 * `BffError` is NOT stubbed — the real class is re-exported, because the hook
 * branches on `instanceof`. A hand-written stand-in would be a second
 * definition of the thing under test, and every `instanceof` would answer
 * false while the fixture looked right.
 */
vi.mock("@/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/api/client")>("@/api/client")),
  api: {
    listCalls: () => CALLS(),
    connectorItems: () => CALENDAR(),
    connectors: () => CONNECTORS(),
    taskBoard: () => TASKS(),
    meetings: () => MEETINGS(),
  },
}));

const { CalendarWidget, IntegrationsWidget, RecordsMiniWidget, StatsWidget, UpcomingWidget, WeekWidget } = await import("./miniWidgets");

/** a promise nobody resolves — the "not answered yet" state, held open */
const pending = <T,>() => new Promise<T>(() => {});

beforeEach(() => {
  cleanup();
  __setPreferencesForTest({ calendar: "auto", timezone: "UTC" });
  CALLS = async () => [call("c-1", "جلسه ۱")];
  CALENDAR = async () => [];
  CONNECTORS = async () => [];
  TASKS = async () => ({ columns: [], topics: [], tasks: [] });
  MEETINGS = async () => [];
});

describe("a list tile's kinds of nothing", () => {
  it("says nothing at all while the read is still out", async () => {
    CALLS = () => pending<Call[]>();
    await act(async () => { render(<RecordsMiniWidget size="small" />); });

    // neither claim has been earned yet: not "there is nothing", not "we
    // could not look"
    expect(screen.queryByText(/هنوز رکوردی نیست/)).toBeNull();
    expect(screen.queryByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeNull();
  });

  it("says the ORGANIZATION is empty when the read lands with nothing", async () => {
    CALLS = async () => [];
    await act(async () => { render(<RecordsMiniWidget size="small" />); });

    expect(screen.getByText(/هنوز رکوردی نیست/)).toBeTruthy();
    expect(screen.queryByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeNull();
  });

  it("says the READ failed when it does — never that there is nothing", async () => {
    CALLS = async () => { throw new Error("no"); };
    await act(async () => { render(<RecordsMiniWidget size="small" />); });

    expect(screen.getByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeTruthy();
    expect(screen.queryByText(/هنوز رکوردی نیست/)).toBeNull();
  });

  it("calls a REFUSAL a permission, never an outage", async () => {
    /*
     * A 403 is a fact about what this person may see. Told the read failed,
     * they would go looking for a problem that does not exist — and the same
     * sentence would be wrong in the other direction during a real outage.
     */
    CALLS = async () => { throw new BffError(403, "forbidden"); };
    await act(async () => { render(<RecordsMiniWidget size="small" />); });

    expect(screen.getByText("به این فهرست دسترسی ندارید.")).toBeTruthy();
    expect(screen.queryByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeNull();
  });

  it("shows only as many rows as the tier has room for", async () => {
    CALLS = async () => Array.from({ length: 9 }, (_, i) => call(`c-${i}`, `جلسه ${i}`));
    /*
     * `small` is three rows and `large` is six — the ladder lives in
     * `rowsFor`, and this asserts the widget READS it rather than slicing to a
     * number of its own. Both tiers in one test because a widget ignoring the
     * tier satisfies either half alone.
     */
    await act(async () => { render(<RecordsMiniWidget size="small" />); });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    cleanup();
    await act(async () => { render(<RecordsMiniWidget size="large" />); });
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("the calendar tile", () => {
  /**
   * The month is the SUBJECT, and it renders whatever the connection is
   * doing. An unconnected calendar that replaced the grid with an invitation
   * would hide the thing the tile is for — the person would not even know
   * what they were being offered instead.
   */
  it("draws the month even with no connection, and offers the connection", async () => {
    CALENDAR = async () => { throw new BffError(404); };
    await act(async () => { render(<CalendarWidget />); });

    expect(screen.getByText("وصل کردن حساب")).toBeTruthy();
    // the squares are there regardless: seven weekday heads plus whole weeks
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(7 + 27);
  });

  it("apologises for a real fault instead of blaming the connection", async () => {
    /*
     * The control for the case above. The connector throws NotFoundError when
     * nobody has connected Google — a 404 — so a 500 is something else, and
     * offering "connect an account" there sends someone to reconnect a
     * connection that is fine.
     */
    CALENDAR = async () => { throw new BffError(500); };
    await act(async () => { render(<CalendarWidget />); });

    expect(screen.getByText("فعلاً نمی‌توان رکوردهای شما را خواند.")).toBeTruthy();
    expect(screen.queryByText("وصل کردن حساب")).toBeNull();
  });

  it("puts an event on ITS OWN day, and on no other", async () => {
    /*
     * The assertion the whole tile exists for. A calendar that marked every
     * square, or the wrong one, renders exactly as convincingly as a correct
     * one — so the control is that PRECISELY ONE square carries the mark.
     *
     * 2026-08-25 is 3 Shahrivar 1405. The square is found by its own mark
     * rather than by index, because an index would encode the leading padding
     * this test should know nothing about.
     */
    CALENDAR = async () => [{
      id: "e-1",
      title: "بازبینی هفتگی",
      subtitle: "اتاق ۲",
      occurred_at: "2026-08-25T06:30:00.000Z",
    }];
    await act(async () => { render(<CalendarWidget />); });

    const marked = screen.getAllByRole("listitem").filter((li) => li.title !== "");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.title).toBe("بازبینی هفتگی");
    expect(marked[0]!.textContent).toContain("۳");
  });
});

describe("the connections tile", () => {
  /**
   * The catalogue is the subject, not the grants: an organization that has
   * connected nothing must still see what there IS to connect. A tile that
   * listed only live grants would render blank on exactly the account that
   * needs the list most, and blank reads as "nothing here".
   */
  it("shows every offered connection even when none is connected", async () => {
    CONNECTORS = async () => [];
    await act(async () => { render(<IntegrationsWidget />); });

    expect(screen.getByText("جی‌میل")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getAllByText("وصل نشده")).toHaveLength(4);
    expect(screen.queryByText("فعال")).toBeNull();
  });

  it("marks the connected provider's sources active — and only those", async () => {
    CONNECTORS = async () => [{
      provider: "google",
      configured: true,
      status: "connected",
      account_label: "amir@example.test",
      expires_at: null,
      can_draft: true,
      can_drive: true,
      polled_at: null,
      messages_seen: 0,
    }];
    await act(async () => { render(<IntegrationsWidget />); });

    /* the control: with google connected, "not connected" must STOP being
       said about google's own sources — an unconditional word satisfies the
       positive half on its own */
    expect(screen.getAllByText("فعال")).toHaveLength(4);
    expect(screen.queryByText("وصل نشده")).toBeNull();
  });
});

describe("the stat strip (reference adoption)", () => {
  it("renders each count from its own read, and a failed one dashes ALONE", async () => {
    /*
     * The four reads are independent — the whole point of per-card fetches.
     * Tasks refuses here while the rest answer, so the open-tasks card must
     * dash and the records card must still carry its number. A widget that
     * blanked the strip on one refusal would report an outage about three
     * lists it read fine.
     */
    CALLS = async () => [call("c-1", "جلسه ۱"), call("c-2", "جلسه ۲")];
    TASKS = async () => { throw new BffError(403, "forbidden"); };
    CALENDAR = async () => [];
    CONNECTORS = async () => [];
    await act(async () => { render(<StatsWidget />); });

    // records: a real ۲ (locale digits — the strip counts in the reader's own)
    expect(screen.getByText("۲")).toBeTruthy();
    // tasks: the dash, not a fabricated ۰
    const taskCard = screen.getByText("تسک‌های باز").closest("a")!;
    expect(taskCard.textContent).toContain("—");
    expect(taskCard.textContent).not.toContain("۰");
    // and the doors go where they claim
    expect(taskCard.getAttribute("href")).toBe("/tasks");
  });

  it("counts only TODAY's meetings, not the whole feed", async () => {
    const today = new Date().toISOString();
    CALENDAR = async () => [
      { id: "e-1", title: "امروز", subtitle: "", occurred_at: today },
      { id: "e-2", title: "ماه بعد", subtitle: "", occurred_at: "2099-01-01T09:00:00.000Z" },
    ];
    TASKS = async () => ({ columns: [], topics: [], tasks: [] });
  MEETINGS = async () => [];
    await act(async () => { render(<StatsWidget />); });

    const meetingsCard = screen.getByText("جلسات امروز").closest("a")!;
    expect(meetingsCard.textContent).toContain("۱");
    expect(meetingsCard.textContent).not.toContain("۲");
  });
});

describe("the upcoming tile", () => {
  it("lists what is AHEAD, nearest first, and drops the past", async () => {
    CALENDAR = async () => [
      { id: "e-p", title: "گذشته", subtitle: "", occurred_at: "2020-01-01T09:00:00.000Z" },
      { id: "e-2", title: "دورتر", subtitle: "", occurred_at: "2099-06-01T09:00:00.000Z" },
      { id: "e-1", title: "نزدیک‌تر", subtitle: "", occurred_at: "2099-01-01T09:00:00.000Z" },
    ];
    await act(async () => { render(<UpcomingWidget size="column" />); });

    expect(screen.queryByText("گذشته")).toBeNull();
    const titles = screen.getAllByTitle(/./).map((el) => el.getAttribute("title"));
    expect(titles.indexOf("نزدیک‌تر")).toBeLessThan(titles.indexOf("دورتر"));
  });

  it("an unconnected calendar OFFERS the connection instead of apologising", async () => {
    CALENDAR = async () => { throw new BffError(404, "absent"); };
    await act(async () => { render(<UpcomingWidget size="column" />); });

    const link = screen.getByText("وصل کردن حساب");
    expect(link.closest("a")!.getAttribute("href")).toBe("/integrations");
    expect(screen.queryByText(/فعلاً نمی‌توان/)).toBeNull();
  });
});

describe("the week strip", () => {
  it("renders seven FULL day names with exactly one today, and lists only THIS week's meetings", async () => {
    const today = new Date();
    MEETINGS = async () => [
      { id: "m-1", title: "جلسهٔ این هفته", scheduled_at: today.toISOString(),
        duration_minutes: null, mode: "online", topic: null, location: null,
        description: "", invitees: [], agenda: [], call_id: null, call_title: null,
        archived: false, created_by: "u-1", created_at: today.toISOString() },
      { id: "m-2", title: "جلسهٔ سال دیگر", scheduled_at: "2099-01-01T09:00:00.000Z",
        duration_minutes: null, mode: "online", topic: null, location: null,
        description: "", invitees: [], agenda: [], call_id: null, call_title: null,
        archived: false, created_by: "u-1", created_at: today.toISOString() },
    ];
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<WeekWidget />); });

    // the strip: seven pills wearing the FULL short names, not single letters
    const strip = view!.container.querySelectorAll("ul")[0]!;
    expect(strip.querySelectorAll("li").length).toBe(7);
    expect(strip.textContent).toContain("شنبه");
    expect(strip.textContent).toContain("جمعه");
    // one — and only one — cell wears today's accent
    expect(strip.querySelectorAll("li.border-accent\\/40").length).toBe(1);

    // the meeting list below carries THIS week's meeting and drops the far one
    expect(screen.getByText("جلسهٔ این هفته")).toBeTruthy();
    expect(screen.queryByText("جلسهٔ سال دیگر")).toBeNull();
  });

  it("an empty week is a NAMED state with the door to scheduling", async () => {
    MEETINGS = async () => [];
    await act(async () => { render(<WeekWidget />); });
    expect(screen.getByText("این هفته جلسه‌ای نداری.")).toBeTruthy();
    const door = screen.getByText("جلسه جدید").closest("a")!;
    expect(door.getAttribute("href")).toBe("/meetings");
  });
});
