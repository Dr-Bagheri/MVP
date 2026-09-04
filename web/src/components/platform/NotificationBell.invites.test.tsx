import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JoinInviteRecord } from "@/api/types";

/**
 * 0189 — THE INVITATION IN THE BELL.
 *
 * User directive, 2026-09-04: "it will go to their platform as a notification
 * and if they accept they will join … the notification will appear and after
 * they accept they will navigate to the page of the room or to the page of
 * the online meeting."
 *
 * The NAVIGATION is what this file is about, and it is the feature rather
 * than a courtesy: an invitation grants no access — a room has been readable
 * org-wide since 0184 and a meeting since 0145 — so what accepting buys is
 * membership plus the app taking you there. A version that answered the
 * invitation and left you looking at the bell would satisfy every other
 * assertion anybody would think to write.
 *
 * The two kinds go to DIFFERENT places, so both are asserted: one destination
 * for both would pass a single-case test and send half the invitations to the
 * wrong screen.
 */
const push = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

const answered: Array<{ id: string; accept: boolean }> = [];
let INVITES: JoinInviteRecord[] = [];
let ANSWER_FAILS = false;

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    cards: async () => ({ cards: [] }),
    invites: async () => INVITES,
    markCardRead: async () => undefined,
    respondToInvite: async (id: string, accept: boolean) => {
      if (ANSWER_FAILS) throw new Error("refused");
      answered.push({ id, accept });
      const invite = INVITES.find((i) => i.id === id)!;
      return { kind: invite.kind, target_id: invite.target_id };
    },
  },
}));

function invite(over: Partial<JoinInviteRecord>): JoinInviteRecord {
  return {
    id: "i-1", kind: "chat_channel", target_id: "c-1", target_title: "عمومی",
    invited_by: "u-2", created_at: "2026-09-04T08:00:00.000Z",
    ...over,
  };
}

import { NotificationBell } from "./NotificationBell";

/** open the panel — the invitations are read on mount AND on every open */
async function openPanel(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "اعلان‌ها" }));
}

beforeEach(() => {
  INVITES = [];
  answered.length = 0;
  ANSWER_FAILS = false;
  push.mockClear();
});

describe("an invitation waiting in the bell", () => {
  it("counts toward the badge, names the room, and on accept joins AND navigates", async () => {
    INVITES = [invite({ id: "i-1", kind: "chat_channel", target_id: "c-7", target_title: "پشتیبانی" })];
    render(<NotificationBell />);

    /* the badge counts it: an unanswered invitation is the one thing in this
       panel that is waiting on the person rather than merely addressed to
       them, so a bell that showed nothing would hide a question */
    expect(await screen.findByText("۱")).toBeInTheDocument();

    await openPanel();
    expect(await screen.findByText(/به این اتاق دعوت شده‌اید/)).toBeInTheDocument();
    expect(screen.getByText("پشتیبانی")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "می‌پذیرم" }));
    await waitFor(() => expect(answered).toEqual([{ id: "i-1", accept: true }]));
    expect(push).toHaveBeenCalledWith("/chat");
  });

  it("takes a MEETING invitation to that meeting's own page", async () => {
    /* the discriminating half: with one destination for both kinds the test
       above still passes, and every meeting invitation lands in the chat */
    INVITES = [invite({ id: "i-2", kind: "meeting", target_id: "mtg-9", target_title: "هم‌فکری محصول" })];
    render(<NotificationBell />);
    await openPanel();

    expect(await screen.findByText(/به این جلسه دعوت شده‌اید/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "می‌پذیرم" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/mtg-9"));
  });

  it("answers «no» without going anywhere", async () => {
    INVITES = [invite({ id: "i-3" })];
    render(<NotificationBell />);
    await openPanel();

    await userEvent.click(await screen.findByRole("button", { name: "نه" }));
    await waitFor(() => expect(answered).toEqual([{ id: "i-3", accept: false }]));
    /* declining is an answer, not a request to go somewhere — and the row
       still leaves, because the question has been answered */
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/دعوت شده‌اید/)).toBeNull());
  });

  it("LEAVES the row when the answer is refused", async () => {
    ANSWER_FAILS = true;
    INVITES = [invite({ id: "i-4", target_title: "عمومی" })];
    render(<NotificationBell />);
    await openPanel();
    await screen.findByText(/دعوت شده‌اید/);

    await userEvent.click(screen.getByRole("button", { name: "می‌پذیرم" }));

    /* an optimistic removal would lose the only copy of a question nobody
       has answered — the invitation is not in a list anywhere else */
    await waitFor(() => expect(screen.getByRole("button", { name: "می‌پذیرم" })).not.toBeDisabled());
    expect(screen.getByText(/دعوت شده‌اید/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
