import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingRecord } from "@/api/types";

/**
 * The meetings LIST's contract facts (the detail moved to its own page —
 * MeetingPage.test.tsx owns that):
 *
 *  1. GROUPING is derived, not decorative: still-ahead-and-unrecorded rows
 *     sit under «پیش رو», everything else under «گذشته» — asserted inside
 *     each group's scope, because a flat list satisfies bare presence.
 *     (Verified red by deleting the record-decides clause: the held-early
 *     meeting jumped groups.)
 *  2. A row is a DOOR: clicking navigates to the meeting's page.
 *  3. The CREATE writes the wire's shape — mode from the picker, an ISO
 *     time — and lands on the new meeting's page.
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

function meeting(over: Partial<MeetingRecord>): MeetingRecord {
  return {
    id: "m-1", title: "جلسهٔ برنامه‌ریزی", scheduled_at: "2099-01-01T09:00:00.000Z",
    duration_minutes: 60, mode: "online", topic: null, location: null,
    description: "", invitees: [], agenda: [], call_id: null, call_title: null,
    archived: false, created_by: "u-1", created_at: "2026-08-31T08:00:00.000Z",
    minutes_approved_at: null, minutes_closed_at: null, minutes_signatures: [],
    ...over,
  };
}

let LIST: MeetingRecord[] = [];
const created: Record<string, unknown>[] = [];

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    meetings: async () => LIST,
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
});

function group(label: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: label });
  return heading.closest("section")!;
}

describe("Meetings", () => {
  it("groups by the derived stage: ahead-and-unrecorded is upcoming, the rest is past", async () => {
    LIST = [
      meeting({ id: "m-a", title: "جلسهٔ آینده", scheduled_at: "2099-01-01T09:00:00.000Z" }),
      meeting({ id: "m-b", title: "جلسهٔ گذشته", scheduled_at: "2020-01-01T09:00:00.000Z" }),
      /* still ahead by the clock but RECORDED — the record decides, not the
         date: a held meeting is past however early it was held */
      meeting({ id: "m-c", title: "جلسهٔ برگزارشده", scheduled_at: "2099-06-01T09:00:00.000Z", call_id: "c-1", call_title: "رکورد" }),
    ];
    render(<Meetings />);
    await waitFor(() => expect(screen.getByText("جلسهٔ آینده")).toBeInTheDocument());

    expect(within(group("پیش رو")).getByText("جلسهٔ آینده")).toBeInTheDocument();
    expect(within(group("گذشته")).getByText("جلسهٔ گذشته")).toBeInTheDocument();
    expect(within(group("گذشته")).getByText("جلسهٔ برگزارشده")).toBeInTheDocument();
    expect(within(group("پیش رو")).queryByText("جلسهٔ برگزارشده")).toBeNull();
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

  it("an empty list names its state", async () => {
    render(<Meetings />);
    await waitFor(() =>
      expect(screen.getByText("هنوز جلسه‌ای نیست. اولین جلسه را برنامه‌ریزی کن.")).toBeInTheDocument());
  });
});
