import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A MEETING INVITATION ASKS (user directive, 2026-09-07: "when you invite
 * someone it must come up as a pop-up window with the same theme style as
 * delete in the users pages, at the moment they have been added — if they are
 * not logged in, when they log in it will come up").
 *
 * The invitation itself is db/0202 + 0189 and the bell already renders it;
 * what is asserted here is the ASK — and its limits, because a dialog that
 * appears for everything is a dialog people learn to dismiss without reading.
 */
const answered: Array<{ id: string; accept: boolean }> = [];
let INVITES: Array<Record<string, unknown>> = [];
let INVITE_READS = 0;
const push = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    invites: async () => { INVITE_READS += 1; return INVITES; },
    respondToInvite: async (id: string, accept: boolean) => {
      answered.push({ id, accept });
      return { kind: "meeting", target_id: "m-9" };
    },
  },
}));
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-intl", () => ({
  useLocale: () => "fa",
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/lib/refreshBus", () => ({ useRefreshEpoch: () => 0 }));
/* the poll is captured, not timed: its rhythm is visiblePoll's own test;
   what this file asserts is that the gate hands it the real read and the
   interval it claims */
let POLL: { run: () => void; every: number } | null = null;
vi.mock("@/lib/visiblePoll", () => ({
  visiblePoll: (run: () => void, every: number) => {
    POLL = { run, every };
    return () => { POLL = null; };
  },
}));

import { INVITE_POLL_MS, MeetingInviteGate } from "./MeetingInviteGate";

const meetingInvite = {
  id: "inv-1", kind: "meeting", target_id: "m-9",
  target_title: "جلسهٔ محصول", invited_by: "u-1",
  created_at: "2026-09-07T09:00:00.000Z",
};

beforeEach(() => {
  answered.length = 0;
  push.mockClear();
  sessionStorage.clear();
  INVITES = [meetingInvite];
});

describe("the meeting invitation asks", () => {
  it("comes up as the platform's own question box, naming the meeting", async () => {
    render(<MeetingInviteGate />);
    await waitFor(() => expect(screen.getByText("جلسهٔ محصول")).toBeInTheDocument());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("meetingInviteAccept")).toBeInTheDocument();
    expect(screen.getByText("meetingInviteDecline")).toBeInTheDocument();
  });

  it("a CHAT invitation does not interrupt — the bell is the right place for it", async () => {
    /*
     * THE DISCRIMINATING HALF. A gate that popped for every unanswered
     * invitation would pass the test above and would teach people to dismiss
     * it: a room is a piece of news, and a meeting has a time.
     */
    INVITES = [{ ...meetingInvite, id: "inv-2", kind: "chat_channel" }];
    render(<MeetingInviteGate />);
    await waitFor(() => expect(INVITES).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("accepting answers and goes there — which is the whole feature", async () => {
    render(<MeetingInviteGate />);
    await waitFor(() => expect(screen.getByText("جلسهٔ محصول")).toBeInTheDocument());

    await userEvent.click(screen.getByText("meetingInviteAccept"));

    await waitFor(() => expect(answered).toEqual([{ id: "inv-1", accept: true }]));
    expect(push).toHaveBeenCalledWith("/meetings/m-9");
  });

  it("declining is an ANSWER; «later» is not", async () => {
    const { unmount } = render(<MeetingInviteGate />);
    await waitFor(() => expect(screen.getByText("جلسهٔ محصول")).toBeInTheDocument());

    await userEvent.click(screen.getByText("meetingInviteDecline"));
    await waitFor(() => expect(answered).toEqual([{ id: "inv-1", accept: false }]));
    /* a "no" is not a request to go anywhere */
    expect(push).not.toHaveBeenCalled();
    unmount();

    answered.length = 0;
    const second = render(<MeetingInviteGate />);
    await waitFor(() => expect(screen.getByText("جلسهٔ محصول")).toBeInTheDocument());
    await userEvent.click(screen.getByText("meetingInviteLater"));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    /* NOTHING was sent: closing a question is not answering it, and the
       invitation is still in the bell waiting */
    expect(answered).toEqual([]);
    second.unmount();

    /* …and it does not ask again in this tab, because a dialog that returns
       every two minutes is a dialog people click through */
    render(<MeetingInviteGate />);
    await waitFor(() => expect(INVITES).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the gate's poll", () => {
  it("polls through visiblePoll at two minutes, and each poll is the real read", async () => {
    render(<MeetingInviteGate />);
    await waitFor(() => expect(screen.getByText("جلسهٔ محصول")).toBeInTheDocument());
    expect(POLL?.every).toBe(INVITE_POLL_MS);
    expect(INVITE_POLL_MS).toBe(120_000);

    /* the invitation is answered elsewhere; the next poll notices */
    const before = INVITE_READS;
    INVITES = [];
    POLL!.run();
    await waitFor(() => expect(INVITE_READS).toBe(before + 1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});
