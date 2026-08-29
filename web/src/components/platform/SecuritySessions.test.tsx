import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSessionRow } from "@/api/types";

/**
 * The sessions table's contract (user directive, 2026-08-28): live rows in
 * the records table's dress, ended from the RIGHT-CLICK menu, through the
 * platform's confirm dialog, with the wire call as the assertion — a menu
 * can render perfectly over a handler that ends nothing.
 *
 * The current-device rule is the one that must answer NO: this device gets
 * no end item, because that gesture is sign-out and the avatar menu owns
 * it — a session ending itself mid-request reads as a crash, not a choice.
 */
const ended = vi.fn();
let SESSIONS: AuthSessionRow[] = [];

vi.mock("@/api/client", () => ({
  api: {
    mySessions: async () => ({ sessions: SESSIONS, current: "aaaaaaaa" }),
    endMySession: (handle: string) => { ended(handle); return Promise.resolve(); },
    /*
     * A MEMBER's answer, which is a refusal (db/0135 admins-only). This file
     * is about the caller's own devices, and the refusal is what keeps the
     * org section off this screen while these tests look at that one.
     *
     * Not a stub returning `[]`: an empty array is "asked, and the org has
     * none", which would render an empty org table here and quietly change
     * what these tests are looking at.
     */
    orgSessions: async () => { throw new Error("forbidden"); },
    deleteMyVoiceprint: async () => {},
  },
}));
vi.mock("@/lib/notify", () => ({ notify: () => {} }));
const signedOut = vi.fn();
vi.mock("@/lib/signOut", () => ({ signOutThisDevice: (locale: string) => { signedOut(locale); return Promise.resolve(); } }));

const { SecuritySettings } = await import("./SecuritySettings");

const ROW = (handle: string, agent: string): AuthSessionRow => ({
  handle, created_at: "2026-08-28T10:00:00.000Z", refreshed_at: "2026-08-28T12:00:00.000Z",
  user_agent: agent, ip: "203.0.113.7", location: null,
});

describe("the sessions table", () => {
  beforeEach(() => {
    cleanup();
    ended.mockReset();
    signedOut.mockReset();
    SESSIONS = [ROW("aaaaaaaa", "Edg/1.0 Windows"), ROW("bbbbbbbb", "Firefox/1.0 Linux")];
  });

  it("marks this device, and ends ANOTHER one through the confirm dialog", async () => {
    await act(async () => { render(<SecuritySettings />); });
    expect(screen.getByText("همین دستگاه")).toBeTruthy();

    /* the records-table gesture: right-click the OTHER row */
    fireEvent.contextMenu(screen.getByText("Firefox · Linux"));
    fireEvent.click(screen.getByText("پایان این نشست"));
    /* nothing ends before the popup's own consent */
    expect(ended).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("پایان نشست"));
    await act(async () => {});
    expect(ended).toHaveBeenCalledWith("bbbbbbbb");
  });

  it("offers sign-out, never end, on THIS device — the row that must answer NO", async () => {
    /* the user right-clicked their own row and concluded the menu did not
       exist — so the current row answers too, with the honest act for the
       session you are riding: sign-out, through the avatar menu's own flow */
    await act(async () => { render(<SecuritySettings />); });
    fireEvent.contextMenu(screen.getByText("Edge · Windows"));
    expect(screen.queryByText("پایان این نشست")).toBeNull();
    fireEvent.click(screen.getByText("خروج از حساب در این دستگاه"));
    await act(async () => {});
    expect(signedOut).toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
  });
});
