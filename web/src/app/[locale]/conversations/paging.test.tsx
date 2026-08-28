/**
 * The History table under the house pager (user directive, 2026-08-27: ten
 * rows, then numbered pages at the bottom of the table).
 *
 * This is the table that motivated the rule, and it is the kind that can lose
 * it silently: it is hand-written markup rather than a `DataTable`, so nothing
 * but this file notices if the paging is dropped in a later edit.
 *
 * The two halves fail independently and both are asserted. A pager can render
 * a perfectly correct "1 2" while the table below it still lists all fourteen
 * rows — on a screenshot that reads as a working feature — and a table can cut
 * to ten with a control that goes nowhere. So: ten of fourteen ARE shown, the
 * eleventh is NOT, and the numbers reach it.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRefreshBus } from "@/lib/refreshBus";

const agentSessions = vi.fn();
vi.mock("@/api/client", () => ({
  api: { agentSessions: (...args: unknown[]) => agentSessions(...args) },
}));
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/platform/AssistantMenu", () => ({
  AssistantMenu: () => null,
}));

import ConversationsPage from "./page";

/**
 * Fourteen rows, and the count is not an accident: it is more than one page
 * and NOT a multiple of ten, so the last page is SHORT. A slice that is off by
 * a page still hands back ten full rows and would pass a count-only check.
 *
 * Titles are zero-padded because `chat-1` is a substring of `chat-14`, and a
 * substring match over a list is a false-positive factory.
 */
const SESSIONS = Array.from({ length: 14 }, (_, index) => ({
  id: `s-${index + 1}`,
  title: `chat-${String(index + 1).padStart(2, "0")}`,
  created_at: `2026-08-2${index % 8}T08:00:00Z`,
  last_message_at: null,
  message_count: index + 1,
}));

/** The pager's numbers, told apart from its two chevrons by carrying one. */
const numbered = (nav: HTMLElement) =>
  within(nav).getAllByRole("button", { name: /[۰۱۲۳۴۵۶۷۸۹]/ });

describe("history table × the house pager", () => {
  beforeEach(() => {
    resetRefreshBus();
    agentSessions.mockReset().mockResolvedValue(SESSIONS);
  });

  it("shows ten of fourteen, and the numbers reach the other four", async () => {
    render(<ConversationsPage />);
    await screen.findByText("chat-01");

    // header + ten
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("chat-10")).toBeTruthy();
    expect(screen.queryByText("chat-11")).toBeNull();

    /* fourteen rows at ten a page is exactly two — a pager that drew three,
       or one, would be reading a size this table never asked for */
    const nav = screen.getByRole("navigation");
    expect(numbered(nav)).toHaveLength(2);

    await userEvent.click(within(nav).getByRole("button", { name: /۲/ }));

    // the REMAINDER, not another ten: header + four
    expect(await screen.findByText("chat-11")).toBeTruthy();
    expect(screen.getByText("chat-14")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(5);
    /* and page one is gone. Without this the same assertions pass against a
       table that APPENDS the next page to the first. */
    expect(screen.queryByText("chat-01")).toBeNull();
  });

  it("draws no pager when everything fits on one page", async () => {
    /* the negative control: "the pager is present" cannot tell a working
       pager from one that renders unconditionally, and a lone "1" under a
       four-row table is a control that does not work. */
    agentSessions.mockResolvedValue(SESSIONS.slice(0, 4));
    render(<ConversationsPage />);
    await screen.findByText("chat-01");

    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
