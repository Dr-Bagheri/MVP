import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * Settings · Security — everyone's sessions (db/0135, user directive
 * 2026-08-29: "for admin and owner to see all the other sessions related to
 * other users to be there as well to see and stopped").
 *
 * The property under test is the one that makes the feature honest, and it
 * is NOT "an admin can end a session". Reading is org-wide while ending is
 * rank-bound, so the two answers differ per row: an admin sees the owner's
 * session and cannot end it. That difference was measured on the live
 * database before any of this was written — owner sees 17 and may end 17,
 * admin sees the same 17 and may end 16 — and `can_end` arrives per row so
 * the client never re-derives the rank rule.
 *
 * So every test here asks whether the AFFORDANCE follows the wall, in both
 * directions. A file that only checked "the end item appears" would pass
 * against a client that offered it on every row and produced refusals.
 */
const ended = vi.fn();

/** producer-shaped: core's `/v1/admin/sessions` rows, names joined in. */
const OWNER_ROW = {
  user_id: "11111111-1111-4111-8111-111111111111",
  handle: "aaaaaaaa",
  created_at: "2026-08-20T10:00:00.000Z",
  refreshed_at: "2026-08-29T09:00:00.000Z",
  user_agent: "Mozilla/5.0 (Macintosh) Safari/605",
  ip: "203.0.113.9",
  display_name: "مالک",
  display_name_en: "Owner",
  /* the wall's answer: an admin may not end the owner's session */
  can_end: false,
};
const MEMBER_ROW = {
  user_id: "22222222-2222-4222-8222-222222222222",
  handle: "bbbbbbbb",
  created_at: "2026-08-25T10:00:00.000Z",
  refreshed_at: "2026-08-29T08:00:00.000Z",
  user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140",
  ip: "203.0.113.20",
  display_name: "عضو",
  display_name_en: "Member",
  can_end: true,
};

vi.mock("@/api/client", () => ({
  api: {
    mySessions: async () => ({ sessions: [], current: null }),
    endMySession: async () => {},
    orgSessions: async () => [OWNER_ROW, MEMBER_ROW],
    endMemberSession: (userId: string, handle: string) => {
      ended(userId, handle);
      return Promise.resolve();
    },
    deleteMyVoiceprint: async () => {},
  },
}));
vi.mock("@/lib/notify", () => ({ notify: () => {} }));
vi.mock("@/lib/signOut", () => ({ signOutThisDevice: async () => {} }));

const { SecuritySettings } = await import("./SecuritySettings");

describe("everyone's sessions", () => {
  it("lists every member's session, not only the caller's", async () => {
    render(<SecuritySettings />);
    /*
     * Anchored on a value that exists only AFTER the fetch resolves, not on
     * the section heading — the heading renders from the message catalogue
     * and would satisfy a `waitFor` while the table was still empty, which
     * is the loading state passing as the rule.
     */
    expect(await screen.findByText("عضو")).toBeInTheDocument();
    expect(screen.getByText("مالک")).toBeInTheDocument();
  });

  it("offers END on a row the wall allows, and NOT on the one it refuses", async () => {
    const user = userEvent.setup();
    render(<SecuritySettings />);
    const member = await screen.findByText("عضو");
    const owner = screen.getByText("مالک");

    // the row the caller outranks answers the gesture
    await user.pointer({ keys: "[MouseRight]", target: member });
    expect(await screen.findByRole("menuitem")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    /*
     * The question this file must answer NO to. Without it, `can_end` could
     * be ignored entirely and every assertion above would still pass — and
     * the visible cost is a Stop button that produces a 403, which is the
     * wall and the affordance disagreeing in front of a user.
     */
    await user.pointer({ keys: "[MouseRight]", target: owner });
    await waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));
  });

  it("ends the session by user AND handle — a handle alone names nothing", async () => {
    /*
     * Both identifiers, because a handle is the first 8 characters of a
     * session id and is only unique WITHIN a person. Sending it alone would
     * be a request whose target the server has to guess.
     */
    const user = userEvent.setup();
    render(<SecuritySettings />);
    const member = await screen.findByText("عضو");
    await user.pointer({ keys: "[MouseRight]", target: member });
    await user.click(await screen.findByRole("menuitem"));
    await user.click(await screen.findByRole("button", { name: "پایان نشست" }));
    await waitFor(() =>
      expect(ended).toHaveBeenCalledWith(MEMBER_ROW.user_id, MEMBER_ROW.handle));
  });
});
