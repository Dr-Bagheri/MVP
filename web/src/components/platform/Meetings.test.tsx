import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingRecord } from "@/api/types";

/**
 * The meetings LIST's contract facts, after the 2026-09-01 rebuild against
 * the reference's own product (the detail lives on its own page):
 *
 *  1. The stage FILTER is derived, not decorative: «پیش‌رو» keeps only
 *     ahead-and-unrecorded rows — a meeting held early is not upcoming,
 *     and a past one never is. (Verified red by dropping the record
 *     clause: the held-early meeting reappeared under پیش‌رو.)
 *  2. A row is a DOOR: clicking navigates to the meeting's page.
 *  3. The CREATE writes the wire's shape — the picked mode, an ISO time —
 *     and lands on the new meeting's page.
 *  4. The empty list is a NAMED state.
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

function meeting(over: Partial<MeetingRecord>): MeetingRecord {
  return {
    id: "m-1", title: "جلسهٔ برنامه‌ریزی", scheduled_at: "2099-01-01T09:00:00.000Z",
    duration_minutes: 60, mode: "online", topic: null, location: null,
    description: "", invitees: [], agenda: [], call_id: null, call_title: null,
    archived: false, created_by: "u-1", created_at: "2026-08-31T08:00:00.000Z",
    video_url: null, video_provider: null,
    minutes_approved_at: null, minutes_closed_at: null, minutes_signatures: [],
    ...over,
  };
}

let LIST: MeetingRecord[] = [];
const created: Record<string, unknown>[] = [];

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    meetings: async (opts?: { archived?: boolean }) => (opts?.archived === true ? [] : LIST),
    updateMeeting: (id: string, body: Record<string, unknown>) => {
      updateSpy(id, body);
      return Promise.resolve(meeting({ id, ...body }));
    },
    deleteMeeting: vi.fn(async () => undefined),
    createMeeting: async (input: Record<string, unknown>) => {
      created.push(input);
      return meeting({ id: "m-new" });
    },
  },
}));

import { Meetings } from "./Meetings";

beforeEach(() => {
  LIST = [];
  created.length = 0;
  pushSpy.mockClear();
  updateSpy.mockClear();
});

describe("Meetings", () => {
  it("the پیش‌رو filter keeps only ahead-and-unrecorded rows", async () => {
    LIST = [
      meeting({ id: "m-a", title: "جلسهٔ آینده", scheduled_at: "2099-01-01T09:00:00.000Z" }),
      meeting({ id: "m-b", title: "جلسهٔ گذشته", scheduled_at: "2020-01-01T09:00:00.000Z" }),
      /* still ahead by the clock but RECORDED — the record decides, not the
         date: a held meeting is not upcoming however early it was held */
      meeting({ id: "m-c", title: "جلسهٔ برگزارشده", scheduled_at: "2099-06-01T09:00:00.000Z", call_id: "c-1", call_title: "رکورد" }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ آینده")).toBeInTheDocument());
    // «همه» shows all three
    expect(screen.getByText("جلسهٔ گذشته")).toBeInTheDocument();
    expect(screen.getByText("جلسهٔ برگزارشده")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "پیش‌رو" }));
    await waitFor(() => expect(screen.queryByText("جلسهٔ گذشته")).toBeNull());
    expect(screen.getByText("جلسهٔ آینده")).toBeInTheDocument();
    expect(screen.queryByText("جلسهٔ برگزارشده")).toBeNull();

    // and «انجام‌شده» is its mirror: only the recorded one
    await userEvent.click(screen.getByRole("button", { name: "انجام‌شده" }));
    await waitFor(() => expect(screen.getByText("جلسهٔ برگزارشده")).toBeInTheDocument());
    expect(screen.queryByText("جلسهٔ آینده")).toBeNull();
  });

  it("a row opens the meeting's own page", async () => {
    LIST = [meeting({ id: "m-a", title: "جلسهٔ آینده" })];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ آینده")).toBeInTheDocument());
    await userEvent.click(screen.getByText("جلسهٔ آینده"));
    expect(pushSpy).toHaveBeenCalledWith("/meetings/m-a");
  });

  it("creating writes the wire's shape and lands on the new page", async () => {
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("هنوز جلسه‌ای نیست. اولین جلسه را برنامه‌ریزی کن.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /جلسه جدید/ }));
    await userEvent.type(screen.getByPlaceholderText("عنوان جلسه را بنویس"), "جلسهٔ فروش");
    await userEvent.click(screen.getByRole("radio", { name: "حضوری" }));
    const dialog = screen.getByRole("dialog");
    // date and time arrive PRE-FILLED with the click moment (the directive's
    // own sentence); the test only retargets the date
    const date = within(dialog).getByLabelText("تاریخ *") as HTMLInputElement;
    expect(date.value).not.toBe("");
    const time = within(dialog).getByLabelText("ساعت *") as HTMLInputElement;
    expect(time.value).not.toBe("");
    date.value = "";
    await userEvent.type(date, "2099-05-01");
    await userEvent.click(screen.getByRole("button", { name: /ساختن جلسه/ }));

    await waitFor(() => expect(created).toHaveLength(1));
    const body = created[0]!;
    expect(body.title).toBe("جلسهٔ فروش");
    expect(body.mode).toBe("in_person");
    // an ISO instant, parseable back — never a local "YYYY-MM-DDTHH:mm"
    expect(Number.isNaN(new Date(String(body.scheduled_at)).getTime())).toBe(false);
    expect(String(body.scheduled_at)).toMatch(/Z$/);
    // and the flow walks onto the created meeting's page
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/meetings/m-new"));
  });

  /* THE ROW MENU's topic mover, walked out of the reference product: the
     current topic carries the check, «بدون موضوع» is one of the choices
     rather than the absence of one, and picking the topic a meeting is
     ALREADY in writes nothing — a no-op patch would put an untrue line in
     the audit trail and move a row that never moved. */
  it("the row menu moves a meeting between topics, and writes nothing for the one it is in", async () => {
    LIST = [
      meeting({ id: "m-a", title: "جلسهٔ الف", topic: "محصول" }),
      meeting({ id: "m-b", title: "جلسهٔ ب", topic: "فروش" }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ الف")).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole("button", { name: "گزینه‌ها" })[0]!);
    const menu = screen.getByText("انتقال به موضوع").parentElement!;
    // every topic in the list, plus «بدون موضوع» as a real choice
    expect(within(menu).getByText("بدون موضوع")).toBeInTheDocument();
    expect(within(menu).getByText("فروش")).toBeInTheDocument();

    // its OWN topic is the checked one, and choosing it writes nothing
    await userEvent.click(within(menu).getByText("محصول"));
    expect(updateSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole("button", { name: "گزینه‌ها" })[0]!);
    await userEvent.click(within(screen.getByText("انتقال به موضوع").parentElement!).getByText("فروش"));
    expect(updateSpy).toHaveBeenCalledWith("m-a", { topic: "فروش" });

    // and «بدون موضوع» clears it — null, never the empty string
    updateSpy.mockClear();
    await userEvent.click(screen.getAllByRole("button", { name: "گزینه‌ها" })[0]!);
    await userEvent.click(within(screen.getByText("انتقال به موضوع").parentElement!).getByText("بدون موضوع"));
    expect(updateSpy).toHaveBeenCalledWith("m-a", { topic: null });
  });

  it("an empty list names its state", async () => {
    render(<Meetings />);
    await waitFor(() =>
      expect(screen.getByText("هنوز جلسه‌ای نیست. اولین جلسه را برنامه‌ریزی کن.")).toBeInTheDocument());
  });
});
