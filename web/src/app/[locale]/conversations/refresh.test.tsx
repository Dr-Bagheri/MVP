/**
 * The refresh bus, proven in the RENDERED artifact (the calendar-store
 * lesson: a subscription that exists in code and re-renders nothing is
 * only visible on screen). An announcement — the shape every client
 * mutation emits, whether a button or the agent pressed it — must make
 * the mounted table fetch again.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { announceChange, resetRefreshBus } from "@/lib/refreshBus";

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

describe("history table × refresh bus", () => {
  beforeEach(() => {
    resetRefreshBus();
    agentSessions.mockReset();
  });

  it("refetches when a sessions write is announced — by anyone", async () => {
    agentSessions.mockResolvedValueOnce([
      { id: "s-1", title: "اولی", created_at: "2026-08-21T08:00:00Z", last_message_at: null, message_count: 2 },
    ]);
    render(<ConversationsPage />);
    await waitFor(() => expect(screen.getByText("اولی")).toBeTruthy());
    expect(agentSessions).toHaveBeenCalledTimes(1);

    // the agent's delete_conversation lands as exactly this announcement
    agentSessions.mockResolvedValueOnce([
      { id: "s-2", title: "دومی", created_at: "2026-08-21T09:00:00Z", last_message_at: null, message_count: 1 },
    ]);
    act(() => announceChange("sessions"));
    await waitFor(() => expect(screen.getByText("دومی")).toBeTruthy());
    expect(agentSessions).toHaveBeenCalledTimes(2);
    // the OLD list is gone — a refetch, not an append
    expect(screen.queryByText("اولی")).toBeNull();
  });
});
