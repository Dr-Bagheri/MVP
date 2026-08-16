import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberStats, User } from "@/api/types";

/**
 * **`history_since: null` must render "—", never "0".**
 *
 * A zero beside a real `history_since` is a true zero — nothing changed in the
 * window. A zero derived from a log that was not recording is a **fabricated
 * delta reached by honest arithmetic**: correct maths over absent data,
 * rendered as a measurement. It would be the only number on the tile anyone
 * would act on.
 *
 * Both branches are tested because the mock can only ever produce one of them.
 * Today every org is in the null case, so the real-delta path would otherwise
 * be code nobody has seen run — and it is the path that exists for the day the
 * history log has data, which is precisely when nobody will re-check it.
 */
/*
 * The page now sits inside `ManagementPane` (the two-pane surface), so the stub
 * moves to that boundary — it brings the shell, the section menu and next-intl
 * navigation with it, none of which is under test here.
 */
vi.mock("@/components/platform/ManagementPane", () => ({
  ManagementPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const admin: User = {
  id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
  email: "sara@example.test",
  avatar_url: null, role: "admin", status: "active", locale: "fa",
  model_id: null, created_at: new Date().toISOString(),
};

const stats = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: async () => admin,
    members: async () => [admin],
    memberStats: () => stats(),
    setUserStatus: vi.fn(),
    setUserRole: vi.fn(),
  },
}));

const { default: UsersPage } = await import("./page");

const withTrend = (trend: MemberStats["trend"]): MemberStats => ({
  counts: { pending: 1, active: 2, disabled: 2, total: 5 }, trend,
});

describe("Management · Users — trend honesty", () => {
  beforeEach(() => stats.mockReset());

  it("renders an em-dash, not a zero, when the history log was not recording", async () => {
    stats.mockResolvedValue(
      withTrend({ window_days: 30, activated: 0, disabled: 0, joined: 0, history_since: null }),
    );
    render(<UsersPage />);

    /*
     * Wait for the COUNTS before asserting the dashes.
     *
     * The first version of this test asserted dashes immediately and passed
     * even with the null-guard deleted — because on first render `stats` is
     * still null and every tile shows "—" while loading. It was asserting the
     * loading state and reporting it as the rule. Anchoring on a value that
     * only exists after the fetch resolves is what makes the assertion about
     * the data rather than about the wait.
     */
    await screen.findByText("۵"); // total, so stats have arrived
    expect(screen.getAllByText("—").length).toBe(3);
    /*
     * The assertion that matters is the ABSENCE. The trend object carries
     * zeroes; rendering them would be arithmetically correct and factually
     * invented.
     */
    expect(screen.queryByText(/\+?[۰0] در/)).toBeNull();
    expect(screen.queryByText(/^۰$/)).toBeNull();
  });

  it("renders a real delta once the log has history — including a true zero", async () => {
    stats.mockResolvedValue(
      withTrend({
        window_days: 30, activated: 3, disabled: 0, joined: 4,
        history_since: "2026-07-01T00:00:00.000Z",
      }),
    );
    render(<UsersPage />);

    // joined 4 → total tile, activated 3 → active tile, both signed
    await waitFor(() => expect(screen.getByText(/\+۴ در ۳۰ روز/)).toBeTruthy());
    expect(screen.getByText(/\+۳ در ۳۰ روز/)).toBeTruthy();
    /*
     * disabled = 0 with a real history_since is a TRUE zero and must render as
     * one. This is the pair that gives the rule meaning: the same digit is
     * honest here and invented above, and only `history_since` tells them apart.
     */
    expect(screen.getByText(/۰ در ۳۰ روز/)).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });
});
