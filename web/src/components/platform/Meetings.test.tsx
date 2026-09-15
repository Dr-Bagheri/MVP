import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingRecord } from "@/api/types";
import { meetingFixture } from "@/test/fixtures";

/**
 * The meetings LIST's contract facts, after the 2026-09-01 rebuild against
 * the reference's own product (the detail lives on its own page) and the
 * 2026-09-08 list pass:
 *
 *  1. The stage FILTER is derived, not decorative: «پیش‌رو» keeps only
 *     ahead-and-unrecorded rows — a meeting held early is not upcoming,
 *     and a past one never is. (Verified red by dropping the record
 *     clause: the held-early meeting reappeared under پیش‌رو.)
 *  2. «گذشته» is its exact COMPLEMENT and the DEFAULT. That pair is
 *     what let «همه» be removed: with a gap between the two chips,
 *     dropping the catch-all would have stranded rows.
 *  3. A row is a DOOR: clicking navigates to the meeting's page.
 *  4. The CREATE writes the wire's shape — the picked mode, an ISO time —
 *     and lands on the new meeting's page.
 *  5. The empty list is a NAMED state.
 *  6. The STATUS pill is the three-word pipeline, derived from the take.
 *  7. SEARCH and SORT are over the filtered rows, not the page.
 */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

const pushSpy = vi.fn();
const updateSpy = vi.fn();
let TOPICS: Array<{ id: string; name: string }> = [];
/** every folder write the page sent, in order */
const topicWrites: Array<[string, string]> = [];

/* THROUGH THE SHARED FIXTURE, not a second copy of it (2026-09-06). This
   was a hand-written twin of `meetingFixture`, and db/0202's one new field
   turned up in all three copies on the same typecheck — which is the drift
   `src/test/fixtures.ts` was extracted to prevent, arriving on schedule.
   Only this suite's own defaults stay here. */
function meeting(over: Partial<MeetingRecord>): MeetingRecord {
  return meetingFixture({
    title: "جلسهٔ برنامه‌ریزی",
    /* PAST by default (2026-09-08), because «گذشته» is the list's opening
       filter now: a fixture dated 2099 is a row the default screen correctly
       hides, and every test about menus and doors would have been asserting
       the filter instead of its own subject. */
    scheduled_at: "2020-01-01T09:00:00.000Z",
    ...over,
  });
}

let LIST: MeetingRecord[] = [];
const created: Record<string, unknown>[] = [];

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    meetings: async (opts?: { archived?: boolean }) => (opts?.archived === true ? [] : LIST),
    /* the FOLDERS (0151) are their own read now — the strip asks for rows
       rather than deriving chips from whatever the meetings happen to say */
    meetingTopics: async () => TOPICS,
    /* the row's avatar read (the stack's photos). Stubbed empty: this suite
       is about the list's own logic, and the stack falls back to initials */
    orgPeople: async () => [],
    createMeetingTopic: async (name: string) => { topicWrites.push(["create", name]); return { id: "t-new", name }; },
    updateMeetingTopic: async (id: string, patch: { name?: string; archived?: boolean }) => {
      topicWrites.push(["update", `${id}:${patch.name ?? (patch.archived === true ? "archived" : "")}`]);
    },
    updateMeeting: (id: string, body: Record<string, unknown>) => {
      updateSpy(id, body);
      return Promise.resolve(meeting({ id, ...body }));
    },
    deleteMeeting: vi.fn(async () => undefined),
    createMeeting: async (input: Record<string, unknown>) => {
      created.push(input);
      /* the created row carries back the MODE it was given — the caller
         decides where to go from THAT, so a fixture with a fixed mode would
         decide the branch for it */
      return meeting({
        id: "m-new",
        scheduled_at: String(input.scheduled_at),
        mode: input.mode as MeetingRecord["mode"],
      });
    },
  },
}));
/*
 * THE DIALOG NO LONGER SENDS THE BYTES (2026-09-08). It JUDGES the file —
 * the kind, the size and the length, all locally — and hands it to
 * `lib/pendingUpload` for the meeting's own page to upload under the
 * processing card.
 *
 * The rules module is stubbed rather than the uploader, because that is
 * where the judgement now lives; `readDurationSeconds` decodes real audio,
 * which jsdom cannot do.
 */
let DURATION_SECONDS: number | null = 120;
vi.mock("@/components/echo/uploadRules", async () => ({
  ...(await vi.importActual<typeof import("@/components/echo/uploadRules")>("@/components/echo/uploadRules")),
  readDurationSeconds: async () => DURATION_SECONDS,
}));
const stashSpy = vi.fn((_meetingId: string, _file: File) => undefined);
/* the refusal reaches the NOTIFICATION BUS now, not a paragraph in the
   dialog (changed 2026-09-08 by the platform's own every-outcome-goes-to-the-
   bus rule). The rule under test is unchanged — a refused file is NAMED and
   writes no meeting — so only the channel this reads moved. */
const notifyErrorSpy = vi.fn((_msg: string) => undefined);
vi.mock("@/lib/notify", () => ({
  notify: vi.fn(),
  notifyError: (msg: string) => notifyErrorSpy(msg),
}));
vi.mock("@/lib/pendingUpload", () => ({
  stashUpload: (meetingId: string, file: File) => stashSpy(meetingId, file),
}));

import { Meetings } from "./Meetings";

beforeEach(() => {
  LIST = [];
  created.length = 0;
  pushSpy.mockClear();
  updateSpy.mockClear();
  stashSpy.mockClear();
  notifyErrorSpy.mockClear();
  DURATION_SECONDS = 120;
  TOPICS = [];

  topicWrites.length = 0;
});

describe("Meetings", () => {
  it("opens on «گذشته», and «پیش‌رو» is its exact complement", async () => {
    LIST = [
      meeting({ id: "m-a", title: "جلسهٔ آینده", scheduled_at: "2099-01-01T09:00:00.000Z" }),
      meeting({ id: "m-b", title: "جلسهٔ گذشته", scheduled_at: "2020-01-01T09:00:00.000Z" }),
      /* still ahead by the clock but RECORDED — the record decides, not the
         date: a held meeting is not upcoming however early it was held */
      meeting({ id: "m-c", title: "جلسهٔ برگزارشده", scheduled_at: "2099-06-01T09:00:00.000Z", call_id: "c-1", call_title: "رکورد" }),
    ];
    render(<Meetings />);
    /* THE OPENING SCREEN is «گذشته» (user, 2026-09-08: "the held is the
       default front"), so the past one and the recorded one are on it and
       the plan is not. */
    await waitFor(() => expect(screen.getByText("جلسهٔ گذشته")).toBeInTheDocument());
    expect(screen.getByText("جلسهٔ برگزارشده")).toBeInTheDocument();
    expect(screen.queryByText("جلسهٔ آینده")).toBeNull();

    /* «همه» IS GONE — asserted, not assumed. Without this line the pair
       below would pass just as well on a screen that still offered a
       catch-all nobody asked to keep. */
    expect(screen.queryByRole("tab", { name: "همه" })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "پیش‌رو" }));
    await waitFor(() => expect(screen.getByText("جلسهٔ آینده")).toBeInTheDocument());
    /* the COMPLEMENT: everything «گذشته» held, «پیش‌رو» drops — and
       the recorded-but-future one is the case that makes the two chips a
       partition rather than a date split */
    expect(screen.queryByText("جلسهٔ گذشته")).toBeNull();
    expect(screen.queryByText("جلسهٔ برگزارشده")).toBeNull();
  });

  /* THE PILL SAYS WHERE THE TAKE IS (user, 2026-09-08: "in the status pill
     there should be Upcomming/Processing/Done"). It is derived from three
     wire fields and no stored word, which is why all four readings below can
     be produced from fixtures that differ only in those fields. */
  it("the status pill is the take's own position, and the row lost mode and agenda count", async () => {
    LIST = [
      meeting({ id: "m-1", title: "بدون ضبط" }),
      meeting({ id: "m-2", title: "در حال کار", call_id: "c-1", call_status: "summarizing" }),
      meeting({ id: "m-3", title: "آماده", call_id: "c-2", call_status: "ready" }),
      meeting({ id: "m-4", title: "بسته‌شده", call_id: "c-3", call_status: "recording", minutes_closed_at: "2026-09-01T10:00:00.000Z" }),
      /* the take being made RIGHT NOW. `recording` is the only call status
         that means the browser is still capturing, and the user was reading
         «در حال پردازش» while sitting in the room (2026-09-09) */
      meeting({ id: "m-5", title: "در جریان", call_id: "c-4", call_status: "recording" }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("بدون ضبط")).toBeInTheDocument());
    const rowOf = (title: string) =>
      screen.getByText(title).closest("[role=button]") as HTMLElement;
    expect(within(rowOf("بدون ضبط")).getByText("پیش‌رو")).toBeInTheDocument();
    expect(within(rowOf("در حال کار")).getByText("در حال پردازش")).toBeInTheDocument();
    expect(within(rowOf("آماده")).getByText("انجام‌شده")).toBeInTheDocument();
    /* closed minutes outrank a take still recording: the meeting is finished
       whatever the recorder is still doing with the bytes */
    expect(within(rowOf("بسته‌شده")).getByText("انجام‌شده")).toBeInTheDocument();
    expect(within(rowOf("در جریان")).getByText("در حال برگزاری")).toBeInTheDocument();

    /* and the two that were REMOVED are gone from the meta line: the
       holding mode («آنلاین» on this fixture) and the agenda count */
    expect(screen.queryByText("آنلاین")).toBeNull();
    expect(screen.queryByText(/بند$/)).toBeNull();
  });

  /* THE SEARCH reaches the people too, not only the title — "which meeting
     was Sara in" is the question a roster search exists to answer, and a
     title-only match would answer it wrong while looking like it worked. */
  it("the search filters by title and by participant", async () => {
    LIST = [
      meeting({ id: "m-a", title: "جلسهٔ فروش" }),
      meeting({
        id: "m-b", title: "جلسهٔ محصول",
        attendees: [{ user_id: "u-9", display_name: "سارا", display_name_en: "Sara", username: "sara", attended: true }],
      }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ فروش")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("جست‌وجوی جلسه"), "سارا");
    await waitFor(() => expect(screen.queryByText("جلسهٔ فروش")).toBeNull());
    expect(screen.getByText("جلسهٔ محصول")).toBeInTheDocument();
  });

  /* SORTING is a FIELD and a DIRECTION, two controls — so the direction key
     has to actually reverse the list, not merely light up */
  it("sorts by date, newest first, and the direction key reverses it", async () => {
    LIST = [
      meeting({ id: "m-old", title: "کهنه", scheduled_at: "2020-01-01T09:00:00.000Z" }),
      meeting({ id: "m-new", title: "تازه", scheduled_at: "2021-01-01T09:00:00.000Z" }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("کهنه")).toBeInTheDocument());
    const titles = () => screen.getAllByText(/^(کهنه|تازه)$/).map((n) => n.textContent);
    expect(titles()).toEqual(["تازه", "کهنه"]);

    await userEvent.click(screen.getByRole("button", { name: "تازه‌ترین اول" }));
    await waitFor(() => expect(titles()).toEqual(["کهنه", "تازه"]));
  });

  /**
   * THE SORT IS THE SECOND SUB-MENU (user directive, 2026-09-15: "for the
   * meeting table fix the sort as the second top sub menu like the last
   * image" — the security page's chip row).
   *
   * Three assertions, and the ABSENCE is the one that makes the others mean
   * something: chips that merely EXIST are equally true of a page that grew a
   * chip row and kept the dropdown, which is two controls for one setting and
   * the exact drift this move exists to end. The dropdown is asked for by its
   * own label, so the topic dropdown one control away cannot answer for it.
   */
  it("sorts from a CHIP ROW, and the dropdown is gone", async () => {
    LIST = [
      meeting({ id: "m-crowd", title: "پرجمعیت", invitees: ["الف", "ب", "ج"] }),
      meeting({ id: "m-alone", title: "تنها", invitees: [] }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("تنها")).toBeInTheDocument());

    /* the row: three tabs, each naming its value for a test, «تاریخ» chosen */
    const row = screen.getByRole("tablist", { name: "مرتب‌سازی" });
    expect(within(row).getAllByRole("tab").map((c) => c.getAttribute("data-key")))
      .toEqual(["date", "people", "status"]);
    expect(within(row).getByRole("tab", { name: /تاریخ/ })).toHaveAttribute("aria-selected", "true");

    /* it SORTS, rather than only lighting up: both meetings share a date, so
       the headcount is the only thing that can order them */
    await userEvent.click(within(row).getByRole("tab", { name: /شرکت‌کنندگان/ }));
    const titles = () => screen.getAllByText(/^(پرجمعیت|تنها)$/).map((n) => n.textContent);
    await waitFor(() => expect(titles()).toEqual(["پرجمعیت", "تنها"]));
    expect(within(row).getByRole("tab", { name: /شرکت‌کنندگان/ })).toHaveAttribute("aria-selected", "true");

    /* and the direction key came WITH the chips rather than staying behind */
    expect(within(row).getByRole("button", { name: "تازه‌ترین اول" })).toBeInTheDocument();

    expect(
      screen.queryByRole("combobox", { name: "مرتب‌سازی" }),
      "the sort dropdown is still on the page beside its chips",
    ).toBeNull();
  });

  it("a row opens the meeting's own page", async () => {
    LIST = [meeting({ id: "m-a", title: "جلسهٔ آینده" })];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ آینده")).toBeInTheDocument());
    await userEvent.click(screen.getByText("جلسهٔ آینده"));
    expect(pushSpy).toHaveBeenCalledWith("/meetings/m-a");
  });

  it("«همین حالا ضبط کن» writes a NOW meeting and lands in the live stage", async () => {
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("هنوز جلسه‌ای نیست. اولین جلسه را برنامه‌ریزی کن.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /جلسه جدید/ }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(screen.getByPlaceholderText("عنوان جلسه را بنویس"), "جلسهٔ فروش");

    /*
     * THE SCHEDULING IS GONE. Asserted as an ABSENCE, because the
     * version that still renders the pickers looks perfectly fine on its own
     * — it is only wrong against the sentence that removed them.
     */
    expect(within(dialog).queryByLabelText("تاریخ *")).toBeNull();
    expect(within(dialog).queryByLabelText("ساعت *")).toBeNull();
    expect(within(dialog).queryByText("طول جلسه")).toBeNull();

    /* ONLINE went with them, and the other two stayed */
    expect(within(dialog).queryByRole("radio", { name: "آنلاین" })).toBeNull();
    expect(within(dialog).getByRole("radio", { name: "حضوری" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "آپلود فایل" })).toBeInTheDocument();

    const before = Date.now();
    await userEvent.click(screen.getByRole("button", { name: /همین حالا ضبط کن/ }));

    await waitFor(() => expect(created).toHaveLength(1));
    const body = created[0]!;
    expect(body.title).toBe("جلسهٔ فروش");
    expect(body.mode).toBe("in_person");
    // an ISO instant, parseable back — never a local "YYYY-MM-DDTHH:mm"
    expect(String(body.scheduled_at)).toMatch(/Z$/);
    const at = new Date(String(body.scheduled_at)).getTime();
    expect(Number.isNaN(at)).toBe(false);
    // NOW, read at the press — not a moment the person chose
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());

    /* ONE address: the meeting page reads its own record now, so a meeting
       with no take and a microphone lane IS the live screen. A `?stage=`
       would be a second opinion about a thing the record already decides. */
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/meetings/m-new"));
  });

  /*
   * THE GREY DOOR. Its whole difference from the
   * green one is the two facts asserted at the bottom: the instant it writes
   * is in the FUTURE, and it does not navigate — a plan is a row on a list,
   * not a screen you are put inside. The filter moving with it is part of
   * the same fact: written into «پیش‌رو», shown in «پیش‌رو».
   */
  it("the grey button schedules a FUTURE meeting, stays on the list, and shows it", async () => {
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("هنوز جلسه‌ای نیست. اولین جلسه را برنامه‌ریزی کن.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /جلسه پیش‌رو/ }));
    const dialog = screen.getByRole("dialog");
    /* the pickers the OTHER dialog refuses are this one's subject */
    expect(within(dialog).getByText("تاریخ")).toBeInTheDocument();
    expect(within(dialog).getByText("ساعت")).toBeInTheDocument();
    /* and the mode question is not asked: a meeting that has not happened
       cannot arrive as a file, and «آنلاین» is offered nowhere */
    expect(within(dialog).queryByRole("radio")).toBeNull();

    await userEvent.type(within(dialog).getByPlaceholderText("عنوان جلسه را بنویس"), "جلسهٔ سه‌شنبه");
    await userEvent.click(within(dialog).getByRole("button", { name: /ثبت در تقویم/ }));

    await waitFor(() => expect(created).toHaveLength(1));
    const body = created[0]!;
    expect(body.title).toBe("جلسهٔ سه‌شنبه");
    expect(body.mode).toBe("in_person");
    expect(String(body.scheduled_at)).toMatch(/Z$/);
    expect(new Date(String(body.scheduled_at)).getTime()).toBeGreaterThan(Date.now());
    /* NO navigation: this is the pair's other half of «lands on the page» */
    expect(pushSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("tab", { name: "پیش‌رو" })).toHaveAttribute("aria-selected", "true"));
  });

  /*
   * THE UPLOAD LANE, and its two halves are one test because they are one
   * act: the file goes FIRST, so a refused file leaves no meeting behind,
   * and the record is linked to the row the upload paid for.
   */
  it("the upload lane sends the file before the meeting exists, then links it", async () => {
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("هنوز جلسه‌ای نیست. اولین جلسه را برنامه‌ریزی کن.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /جلسه جدید/ }));
    await userEvent.type(screen.getByPlaceholderText("عنوان جلسه را بنویس"), "ضبط قدیمی");
    await userEvent.click(screen.getByRole("radio", { name: "آپلود فایل" }));

    const dialog = screen.getByRole("dialog");
    /* the drop zone belongs to this lane alone, and «همین حالا ضبط کن» is
       not what an upload does */
    expect(within(dialog).getByText("فایل صوتی را اینجا رها کن")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /همین حالا ضبط کن/ })).toBeNull();

    const file = new File(["x"], "jalase.m4a", { type: "audio/mp4" });
    /* the input is the label's own, so a person clicking the zone reaches
       exactly this control — the drop and the click are one door */
    await userEvent.upload(within(dialog).getByLabelText(/فایل صوتی را اینجا رها کن/), file);
    expect(within(dialog).getByText("jalase.m4a")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /آپلود و پردازش/ }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.mode).toBe("upload");
    /* the file is STASHED against the new meeting's id and the page opens —
       the send happens there, under the processing card. The ORDER is the
       assertion: stashing after the navigation would race the page's own
       first render, which is where it reads the hand-off. */
    expect(stashSpy).toHaveBeenCalledWith("m-new", file);
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/meetings/m-new"));
  });

  it("a refused file leaves no meeting behind, and says which refusal", async () => {
    /* judged HERE and for free: the three refusals a person can act on are
       answered with no network, so the row is written only for a file that
       has already passed them */
    DURATION_SECONDS = 60 * 60 * 12;
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("هنوز جلسه‌ای نیست. اولین جلسه را برنامه‌ریزی کن.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /جلسه جدید/ }));
    await userEvent.type(screen.getByPlaceholderText("عنوان جلسه را بنویس"), "فایل بد");
    await userEvent.click(screen.getByRole("radio", { name: "آپلود فایل" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.upload(
      within(dialog).getByLabelText(/فایل صوتی را اینجا رها کن/),
      /* an AUDIO file the picker accepts — the refusal under test is
         `uploadAudioFile`'s, not the accept attribute's, and a .txt would
         never reach the upload at all */
      new File(["x"], "khaili-boland.m4a", { type: "audio/mp4" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /آپلود و پردازش/ }));

    /* NAMED, and by its own refusal — «this file is too long», never a
       generic failure. The channel is the notification bus; what matters to
       this test is that the person is told WHICH refusal and that nothing
       was written. */
    await waitFor(() => expect(notifyErrorSpy).toHaveBeenCalledWith("مدت ضبط بیش از حد مجاز است."));
    expect(created).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
    /* and the dialog stays open, so the file can be swapped for a good one */
    expect(dialog).toBeInTheDocument();
  });

  /* THE ROW MENU's topic mover, walked out of the reference product: the
     current topic carries the check, «بدون موضوع» is one of the choices
     rather than the absence of one, and picking the topic a meeting is
     ALREADY in writes nothing — a no-op patch would put an untrue line in
     the audit trail and move a row that never moved. */
  it("the row menu moves a meeting between topics, and writes nothing for the one it is in", async () => {
    TOPICS = [{ id: "t-p", name: "محصول" }, { id: "t-s", name: "فروش" }];
    LIST = [
      meeting({ id: "m-a", title: "جلسهٔ الف", topic_id: "t-p", topic: "محصول" }),
      meeting({ id: "m-b", title: "جلسهٔ ب", topic_id: "t-s", topic: "فروش" }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ الف")).toBeInTheDocument());

    /* THE THEME'S KEBAB now (2026-09-02): the row menu is KebabMenu, so the
       topics are a SUB flyout under «انتقال به موضوع» and every entry is a
       Radix menuitem in a portal — `parentElement` scoping and button roles
       both stop meaning anything. The flow is the one rowActions.menu.test
       drives: open, click the sub trigger, pick from the flyout. */
    const openTopics = async () => {
      await userEvent.click(screen.getAllByRole("button", { name: "گزینه‌ها" })[0]!);
      await userEvent.click(await screen.findByRole("menuitem", { name: /انتقال به موضوع/ }));
    };
    await openTopics();
    // every topic in the list, plus «بدون موضوع» as a real choice
    expect(await screen.findByRole("menuitem", { name: "بدون موضوع" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "فروش" })).toBeInTheDocument();

    // its OWN topic is the checked one, and choosing it writes nothing
    await userEvent.click(screen.getByRole("menuitem", { name: "محصول" }));
    expect(updateSpy).not.toHaveBeenCalled();

    await openTopics();
    await userEvent.click(await screen.findByRole("menuitem", { name: "فروش" }));
    expect(updateSpy).toHaveBeenCalledWith("m-a", { topic_id: "t-s" });

    // and «بدون موضوع» clears it — null, never the empty string
    updateSpy.mockClear();
    await openTopics();
    await userEvent.click(await screen.findByRole("menuitem", { name: "بدون موضوع" }));
    expect(updateSpy).toHaveBeenCalledWith("m-a", { topic_id: null });
  });

  /* THE DESTRUCTIVE ENTRY MUST NAME ITSELF. `deleteMeeting` held the ARCHIVE
     wording in both locales — a leftover from when the row archived — so the
     menu showed «بایگانی جلسه» twice and the red one permanently deleted.
     The confirm dialog's own title said «حذف شود؟», which means the control
     and its confirmation disagreed about what was about to happen, and only
     the screen showed it. */
  it("the row menu's two destructive entries are not the same word", async () => {
    LIST = [meeting({ id: "m-a", title: "جلسهٔ الف" })];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ الف")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "گزینه‌ها" }));

    /* menu ENTRIES are Radix menuitems now (KebabMenu, 2026-09-02); the
       confirmation's own control below is still an ordinary button */
    const archive = await screen.findByRole("menuitem", { name: "بایگانی جلسه" });
    const remove = screen.getByRole("menuitem", { name: "حذف جلسه" });
    expect(archive.textContent).not.toBe(remove.textContent);

    // and the confirmation agrees with the entry that opened it
    await userEvent.click(remove);
    expect(await screen.findByText(/حذف شود؟/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حذف جلسه" })).toBeInTheDocument();
  });

  /*
   * THE TOPIC IS A DROPDOWN NOW (user, 2026-09-08: "the filtering should be
   * topic with drop down and not folders … one row with dropdowns"), and the
   * strip's two properties had to survive the shape change:
   *
   *   · the COUNT, which was a badge on each chip and is now part of the
   *     option's own label — losing it would have traded a fact for a layout;
   *   · the rule that only a REAL folder can be renamed or removed, which the
   *     strip enforced by drawing a menu on folders and not on «همه جلسات».
   *     One menu serves every topic now, so the rule became `disabled`.
   */
  it("the topic dropdown filters, carries its counts, and guards the folder actions", async () => {
    TOPICS = [{ id: "t-p", name: "محصول" }];
    LIST = [
      meeting({ id: "m-a", title: "جلسهٔ الف", topic_id: "t-p", topic: "محصول" }),
      meeting({ id: "m-b", title: "جلسهٔ ب" }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ الف")).toBeInTheDocument());

    /* THE FOLDER STRIP IS GONE — asserted, because every check below would
       pass just as well on a screen that kept both. */
    expect(screen.queryByRole("button", { name: /همه جلسات/ })).toBeNull();

    const picker = screen.getByRole("combobox", { name: "موضوع (پوشه)" });
    expect(picker).toHaveTextContent("همه جلسات (۲)");

    /* on «همه جلسات» there is no folder to act on, so the two folder actions
       are offered and refused rather than hidden — a menu that changes its
       length as you move around is harder to learn than one that greys */
    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های موضوع" }));
    expect(await screen.findByRole("menuitem", { name: "ویرایش نام موضوع" }))
      .toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: "محصول (۱)" }));
    await waitFor(() => expect(screen.queryByText("جلسهٔ ب")).toBeNull());
    expect(screen.getByText("جلسهٔ الف")).toBeInTheDocument();

    // and with a real folder chosen, the same entry is live
    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های موضوع" }));
    expect(await screen.findByRole("menuitem", { name: "ویرایش نام موضوع" }))
      .not.toHaveAttribute("aria-disabled", "true");
  });

  /*
   * «موضوع جدید» IS THE DROPDOWN'S LAST ROW (user, 2026-09-08), and it is the
   * one option that is not a value. The contract has two halves and the
   * second is the one worth a test: choosing it must open the name box
   * WITHOUT the sentinel reaching the filter — `topic_id === "__new"` matches
   * no meeting, so a leak would empty the list and look like a broken filter
   * rather than like a mis-wired option.
   */
  it("«موضوع جدید» is the dropdown's last row, and picking it never becomes a filter", async () => {
    TOPICS = [{ id: "t-p", name: "محصول" }];
    LIST = [meeting({ id: "m-a", title: "جلسهٔ الف" })];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ الف")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "موضوع (پوشه)" }));
    const options = await screen.findAllByRole("option");
    expect(options.at(-1)).toHaveTextContent("موضوع جدید");

    await userEvent.click(options.at(-1)!);
    // the name box opened…
    expect(await screen.findByPlaceholderText("نام موضوع…")).toBeInTheDocument();
    // …and the list did not become empty behind it
    expect(screen.getByText("جلسهٔ الف")).toBeInTheDocument();
  });

  it("an empty list names its state", async () => {
    render(<Meetings />);
    await waitFor(() =>
      expect(screen.getByText("هنوز جلسه‌ای نیست. اولین جلسه را برنامه‌ریزی کن.")).toBeInTheDocument());
  });
});

/*
 * NAMING A FOLDER.
 */
describe("the folder picker", () => {
  it("marks «موضوع جدید» as an action rather than a value, and opens a dialog", async () => {
    TOPICS = [{ id: "t-p", name: "محصول" }];
    LIST = [meeting({ id: "m-a", topic_id: "t-p", topic: "محصول" })];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "موضوع (پوشه)" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "موضوع (پوشه)" }));
    const row = screen.getByRole("option", { name: /موضوع جدید/ });
    /* the + rides the row's leading slot — a value's colour dot would be in
       the same place, which is why a row may carry one mark and not both */
    expect(row.querySelector("svg")).not.toBeNull();
    /* the CONTROL: an ordinary value carries no glyph, so "there is an svg"
       cannot pass by every row having one */
    expect(screen.getByRole("option", { name: /محصول/ }).querySelector("svg")).toBeNull();

    await userEvent.click(row);
    /* a DIALOG, not the picker replaced by a 144px field */
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByPlaceholderText("نام موضوع…")).toBeInTheDocument();
    /* AND THE PICKER IS STILL THERE BEHIND IT — the whole point of the move,
       and the thing the inline box destroyed. Asserted by TEXT, not by role:
       Radix marks everything outside an open modal `aria-hidden`, so the
       picker is correctly out of the accessibility tree while the dialog is
       up and a role query would report the right behaviour as a failure. */
    expect(screen.getByText(/همه جلسات/)).toBeInTheDocument();
  });

  it("writes the new folder's name and closes", async () => {
    render(<Meetings />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "موضوع (پوشه)" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("combobox", { name: "موضوع (پوشه)" }));
    await userEvent.click(screen.getByRole("option", { name: /موضوع جدید/ }));

    await userEvent.type(await screen.findByPlaceholderText("نام موضوع…"), "  بازاریابی  ");
    await userEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    /* TRIMMED — a folder named with a trailing space is one nobody can match
       against by eye */
    await waitFor(() => expect(topicWrites).toEqual([["create", "بازاریابی"]]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the SAME dialog renames, carrying the folder's current name", async () => {
    TOPICS = [{ id: "t-p", name: "محصول" }];
    LIST = [meeting({ id: "m-a", topic_id: "t-p", topic: "محصول" })];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "موضوع (پوشه)" })).toBeInTheDocument());
    /* pick the folder first — rename acts on the SELECTED one and is refused
       while «همه جلسات» is chosen */
    await userEvent.click(screen.getByRole("combobox", { name: "موضوع (پوشه)" }));
    await userEvent.click(screen.getByRole("option", { name: /محصول/ }));

    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های موضوع" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "ویرایش نام موضوع" }));

    const field = await screen.findByPlaceholderText("نام موضوع…");
    expect(field).toHaveValue("محصول");
    await userEvent.clear(field);
    await userEvent.type(field, "محصولات{Enter}");
    /* ENTER commits: a one-field form the keyboard cannot finish is a form
       that asks for the mouse back — the habit the inline box taught */
    await waitFor(() => expect(topicWrites).toEqual([["update", "t-p:محصولات"]]));
  });
});
