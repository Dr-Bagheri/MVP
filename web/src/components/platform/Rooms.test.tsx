import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE ROOMS LANDING.
 *
 * Two things worth a test, and neither is "the list renders":
 *
 *  1. **Opening a room sends the HANDLES the person ticked.** The wire keys on
 *     handles (core resolves them through the agent store, which owns the
 *     system < org < user collapse), and a screen that sent ids — or sent the
 *     first agent because the tick state never reached the call — would fail
 *     with a refusal about an unknown agent, or worse, open a room with the
 *     wrong colleague in it. The assertion is on the ARGUMENT: "the dialog
 *     submitted" is true in every broken version of this.
 *
 *  2. **A room that has never been spoken in says so.** `last_message_at` is
 *     null there, and the tempting fallback is the room's creation time — a
 *     plausible number standing where a fact should be, which is the family of
 *     bug this codebase keeps finding. Its control is the room that HAS been
 *     spoken in, on the same render.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const pushed: string[] = [];
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => "/agents",
  useRouter: () => ({ replace: vi.fn(), push: (to: string) => { pushed.push(to); } }),
}));

const opened: { title: string; agents: string[] }[] = [];

const ROYA = { id: "ag-roya", handle: "roya", name: "رؤیا", icon: "sparkles", color: "violet" };
const AVA = { id: "ag-ava", handle: "ava", name: "آوا", icon: "chart", color: "blue" };

function room(id: string, title: string, lastMessageAt: string | null) {
  return {
    id, title,
    subject_kind: null, subject_id: null, archived: false,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: "2026-09-03T09:00:00.000Z",
    last_message_at: lastMessageAt,
    agents: [ROYA, AVA],
  };
}

let rooms = [room("r-1", "پورت به فلاتر", "2026-09-03T09:00:00.000Z")];

vi.mock("@/api/client", () => ({
  api: {
    rooms: () => Promise.resolve(rooms),
    agents: () => Promise.resolve([
      { ...ROYA, level: "system", description: "کارها را انجام می‌دهد", tools: [] },
      { ...AVA, level: "system", description: "می‌خواند و گزارش می‌دهد", tools: [] },
    ]),
    openRoom: (input: { title: string; agents: string[] }) => {
      opened.push(input);
      return Promise.resolve(room("r-new", input.title, null));
    },
  },
}));

import { Rooms } from "./Rooms";

beforeEach(() => {
  opened.length = 0;
  pushed.length = 0;
  rooms = [room("r-1", "پورت به فلاتر", "2026-09-03T09:00:00.000Z")];
});

describe("opening a room", () => {
  it("sends the handles that were ticked, and goes into the room", async () => {
    const user = userEvent.setup();
    render(<Rooms />);

    await user.click((await screen.findAllByRole("button", { name: "اتاق تازه" }))[0]!);
    await user.type(screen.getByRole("textbox"), "برنامهٔ انتشار");

    /* tick آوا ONLY. Ticking both would let a version that always sends the
       whole roster pass — the same shape as the mislabelled-turn control. */
    await user.click(screen.getByRole("checkbox", { name: /آوا/ }));
    await user.click(screen.getByRole("button", { name: "باز کردن اتاق" }));

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toEqual({ title: "برنامهٔ انتشار", agents: ["ava"] });
    expect(pushed).toEqual(["/agents/r-new"]);
  });

  it("refuses to open with nothing ticked", async () => {
    const user = userEvent.setup();
    render(<Rooms />);
    await user.click((await screen.findAllByRole("button", { name: "اتاق تازه" }))[0]!);
    await user.type(screen.getByRole("textbox"), "بدون کسی");
    /* a room with no agents in it can never answer — 0164's own reason for
       making the membership part of the same write as the room */
    expect(screen.getByRole("button", { name: "باز کردن اتاق" })).toBeDisabled();
    expect(opened).toEqual([]);
  });
});

describe("a room's last activity", () => {
  it("says a silent room is silent rather than showing a plausible date", async () => {
    rooms = [
      room("r-1", "پورت به فلاتر", "2026-09-03T09:00:00.000Z"),
      room("r-2", "هنوز چیزی نگفته‌ایم", null),
    ];
    render(<Rooms />);

    // the null case reads as its own word …
    await screen.findByText("هنوز چیزی گفته نشده");
    // … and the CONTROL: the room that HAS been spoken in shows a date, so
    // this cannot pass by rendering the same thing for every row
    const spoken = (await screen.findByText("پورت به فلاتر")).closest("a")!;
    expect(spoken.textContent).not.toMatch(/هنوز چیزی گفته نشده/);
  });
});
