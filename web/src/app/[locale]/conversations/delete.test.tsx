/**
 * The row's delete, spelled the way every DataTable in the product spells
 * it (audit finding, 2026-09-02): the item lives in the RIGHT-CLICK menu the
 * table already owns — no text link in the row — and choosing it ASKS; the
 * write happens only behind the platform's confirm dialog.
 *
 * Both halves are asserted because each fails alone: a menu can render an
 * item over a handler that archives nothing, and a handler can archive on
 * the press with a dialog that is decoration. So: the old link is GONE, the
 * item is there, the press calls NO api, the dialog names the conversation
 * the way the row does, and confirming archives it and fetches again.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { openRowMenu } from "@/test/rowMenu";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRefreshBus } from "@/lib/refreshBus";

const agentSessions = vi.fn();
const archiveSession = vi.fn();

/* the History row opens the assistant PAGE (user directive: the orb stands
   down here), so this file owes the component a router */
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={String(href)} {...props}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/conversations",
}));

vi.mock("@/api/client", () => ({
  api: {
    agentSessions: (...args: unknown[]) => agentSessions(...args),
    archiveSession: (...args: unknown[]) => archiveSession(...args),
  },
}));
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/platform/AssistantMenu", () => ({
  AssistantMenu: () => null,
}));

import ConversationsPage from "./page";

const ROW = {
  id: "s-1",
  title: "اولی",
  created_at: "2026-08-21T08:00:00Z",
  last_message_at: null,
  message_count: 2,
};

describe("history table × delete", () => {
  beforeEach(() => {
    resetRefreshBus();
    agentSessions.mockReset().mockResolvedValue([ROW]);
    archiveSession.mockReset().mockResolvedValue(undefined);
  });

  it("offers delete on right-click, asks first, and archives only on consent", async () => {
    render(<ConversationsPage />);
    await screen.findByText("اولی");

    /* the negative half: the underlined red link is gone from the row. A
       menu that ALSO works would pass every assertion below with the link
       still there. */
    expect(screen.queryByRole("button", { name: "حذف" })).toBeNull();

    /* the records-table gesture */
    await openRowMenu("اولی");
    fireEvent.click(await screen.findByRole("menuitem", { name: /حذف/ }));

    /* the press ASKS — nothing is written before the dialog's own consent */
    expect(archiveSession).not.toHaveBeenCalled();
    /* and the dialog names the row it came from */
    expect(await screen.findByText(/«اولی» حذف شود/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    await act(async () => {});
    /* archive, not delete: nothing in the product may DELETE a conversation
       row, and `true` is the archived flag the dialog's comment explains */
    expect(archiveSession).toHaveBeenCalledWith("s-1", true);
    /* a refetch, not a local splice — the list is the server's */
    expect(agentSessions).toHaveBeenCalledTimes(2);
  });
});
