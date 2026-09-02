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

const { CalendarWidget, IntegrationsWidget, LatestMeetingsWidget, RecordsMiniWidget, StatsWidget, UpcomingWidget, WeekWidget } = await import("./miniWidgets");

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
      can_drive: true, can_meet: true,
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


function meetingRow(over: Partial<import("@/api/types").MeetingRecord>): import("@/api/types").MeetingRecord {
  return {
    id: "m-1", title: "جلسه", scheduled_at: "2099-01-01T09:00:00.000Z",
    duration_minutes: null, mode: "online", topic: null, location: null,
    description: "", invitees: [], agenda: [], call_id: null, call_title: null,
    archived: false, created_by: "u-1", created_at: "2026-08-31T08:00:00.000Z",
    video_url: null, video_provider: null,
    minutes_approved_at: null, minutes_closed_at: null, minutes_signatures: [],
    ...over,
  };
}

describe("the stat strip (the reference's four figures)", () => {
  it("counts from its own reads, and a failed read dashes ITS cards alone", async () => {
    /*
     * Meetings answer (one ahead, one this month is not guaranteed by the
     * fixture clock, so only the ahead-count is pinned); the TASK read
     * refuses. The task cards must dash — and never show a fabricated ۰ —
     * while the meeting card still carries its number.
     */
    MEETINGS = async () => [
      meetingRow({ id: "m-a", scheduled_at: "2099-01-01T09:00:00.000Z" }),
      meetingRow({ id: "m-b", scheduled_at: "2020-01-01T09:00:00.000Z" }),
    ];
    TASKS = async () => { throw new BffError(403, "forbidden"); };
    await act(async () => { render(<StatsWidget />); });

    const upcomingCard = screen.getByText("جلسات پیش‌رو").closest("a")!;
    expect(upcomingCard.textContent).toContain("۱");
    const rateCard = screen.getByText("نرخ انجام تسک‌ها").closest("a")!;
    expect(rateCard.textContent).toContain("—");
    expect(rateCard.textContent).not.toContain("۰");
    const totalCard = screen.getByText("تسک‌های ثبت‌شده").closest("a")!;
    expect(totalCard.textContent).toContain("—");
  });

  it("computes the task rate from done over live tasks", async () => {
    MEETINGS = async () => [];
    TASKS = async () => ({
      columns: [], topics: [],
      tasks: [
        { done: true, archived: false }, { done: false, archived: false },
        { done: true, archived: true }, /* archived rows are OFF the rate */
      ],
    } as never);
    await act(async () => { render(<StatsWidget />); });
    const rateCard = screen.getByText("نرخ انجام تسک‌ها").closest("a")!;
    expect(rateCard.textContent).toContain("۵۰");
  });
});

describe("جلسات پیش‌رو (the product's own upcoming)", () => {
  it("keeps ahead-and-unrecorded rows only — a held meeting is not upcoming", async () => {
    MEETINGS = async () => [
      meetingRow({ id: "m-a", title: "جلسهٔ آینده", scheduled_at: "2099-01-01T09:00:00.000Z" }),
      meetingRow({ id: "m-b", title: "جلسهٔ گذشته", scheduled_at: "2020-01-01T09:00:00.000Z" }),
      meetingRow({ id: "m-c", title: "برگزارشدهٔ زودهنگام", scheduled_at: "2099-06-01T09:00:00.000Z", call_id: "c-1" }),
    ];
    await act(async () => { render(<UpcomingWidget size="column" />); });
    expect(screen.getByText("جلسهٔ آینده")).toBeTruthy();
    expect(screen.queryByText("جلسهٔ گذشته")).toBeNull();
    expect(screen.queryByText("برگزارشدهٔ زودهنگام")).toBeNull();
  });

  it("a failed read never wears the empty state's face", async () => {
    MEETINGS = async () => { throw new Error("down"); };
    await act(async () => { render(<UpcomingWidget size="column" />); });
    expect(screen.queryByText("جلسه‌ای در پیش نداری.")).toBeNull();
  });
});

describe("آخرین جلسات", () => {
  it("lists newest first with the review chip on recorded rows", async () => {
    MEETINGS = async () => [
      meetingRow({ id: "m-old", title: "قدیمی", scheduled_at: "2026-01-01T09:00:00.000Z" }),
      meetingRow({ id: "m-new", title: "تازه", scheduled_at: "2026-06-01T09:00:00.000Z", call_id: "c-1" }),
    ];
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<LatestMeetingsWidget size="column" />); });
    const titles = [...view!.container.querySelectorAll("li a span span:first-child")].map((el) => el.textContent);
    expect(titles.indexOf("تازه")).toBeLessThan(titles.indexOf("قدیمی"));
    // the chip sits on the RECORDED row only
    const rows = [...view!.container.querySelectorAll("li")];
    const recorded = rows.find((r) => r.textContent!.includes("تازه"))!;
    const bare = rows.find((r) => r.textContent!.includes("قدیمی"))!;
    expect(recorded.textContent).toContain("بازبینی");
    expect(bare.textContent).not.toContain("بازبینی");
  });
});

describe("the week hour grid", () => {
  /* THE CLOCK IS PINNED, and that is the point. The first version of this
     test built its fixture with `new Date(); setHours(10, 30)` — machine-
     LOCAL time — while the widget buckets by the resolved TIMEZONE
     PREFERENCE. The two agree for most of the day and disagree either side
     of midnight, so the test passed for weeks and then failed at 00:24 with
     nothing changed but the hour. Two clocks in one test is the fixture
     problem wearing a date: pin one instant and derive the fixture from it.
     Midday UTC, so both instants land on the same local day in every zone
     a person could plausibly be in. A SUNDAY, so that the three day names
     asserted below are never the one carrying the «امروز» suffix. */
  it("renders seven FULL day names and places a meeting in ITS day column", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-17T12:00:00.000Z"));
    MEETINGS = async () => [
      meetingRow({ id: "m-1", title: "جلسهٔ این هفته", scheduled_at: "2026-05-17T12:30:00.000Z" }),
      meetingRow({ id: "m-2", title: "جلسهٔ سال دیگر", scheduled_at: "2099-01-01T09:00:00.000Z" }),
    ];
    await act(async () => { render(<WeekWidget />); });

    /* EXACT text, never a substring — «شنبه» lives inside یکشنبه/دوشنبه/…
       (the «دی»-inside-«محمدی» trap, rule 12) */
    expect(screen.getByText("جمعه")).toBeTruthy();
    expect(screen.getByText("دوشنبه")).toBeTruthy();
    expect(screen.getByText("چهارشنبه")).toBeTruthy();
    // exactly one TODAY header
    expect(screen.getAllByText(/امروز/).length).toBe(1);
    // this week's meeting is on the grid; the far one is not
    expect(screen.getByText("جلسهٔ این هفته")).toBeTruthy();
    expect(screen.queryByText("جلسهٔ سال دیگر")).toBeNull();
    // and it sits INSIDE the today column (the accent-tinted body)
    const chip = screen.getByText("جلسهٔ این هفته").closest("a")!;
    expect(chip.parentElement!.className).toContain("bg-accent-soft");
    vi.useRealTimers();
  });

  it("loading claims nothing; failure is named, not rendered as an empty week", async () => {
    MEETINGS = () => pending<import("@/api/types").MeetingRecord[]>();
    await act(async () => { render(<WeekWidget />); });
    expect(screen.queryByText("بدون جلسه")).toBeNull();

    cleanup();
    MEETINGS = async () => { throw new Error("down"); };
    await act(async () => { render(<WeekWidget />); });
    expect(screen.getAllByText("فعلاً نمی‌توان رکوردهای شما را خواند.").length).toBeGreaterThan(0);
  });
});
