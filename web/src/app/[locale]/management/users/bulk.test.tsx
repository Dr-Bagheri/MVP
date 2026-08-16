import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberStats, User } from "@/api/types";

/**
 * Part 4 tail — bulk member actions and the detail panel.
 *
 * What must hold:
 *  - The owner and yourself have NO checkbox: a bulk action can never
 *    include the two rows the api would refuse, so "select all" is honest.
 *  - Bulk disable SKIPS a member already disabled — idempotence is not a
 *    failure, and the write count proves the skip happened.
 *  - The detail panel is a magnified row: it opens from the name, shows the
 *    identity facts, and its controls run through the SAME mutation path as
 *    the table (one path, asserted by the shared spy).
 */

vi.mock("@/components/platform/ManagementPane", () => ({
  ManagementPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const person = (over: Partial<User>): User => ({
  id: "u-x", org_id: "o-1", username: null, display_name: "کسی",
  email: "x@example.test", avatar_url: null, role: "member", status: "active",
  locale: "fa", model_id: null, created_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

const owner = person({ id: "u-owner", username: "sara", display_name: "سارا", role: "owner" });
const memberA = person({ id: "u-a", username: "nima", display_name: "نیما", email: "nima@example.test" });
const memberB = person({ id: "u-b", display_name: "بهار", status: "disabled" });

const setUserStatus = vi.fn(async () => undefined);
const stats: MemberStats = {
  counts: { pending: 0, active: 2, disabled: 1, total: 3 },
  trend: { window_days: 30, activated: 0, disabled: 0, joined: 0, history_since: null },
};

vi.mock("@/api/client", () => ({
  api: {
    me: async () => owner,
    invitations: async () => [],
    members: async () => [owner, memberA, memberB],
    memberStats: async () => stats,
    setUserStatus: (...args: unknown[]) => setUserStatus(...(args as [])),
    setUserRole: vi.fn(async () => undefined),
  },
}));

const { default: UsersPage } = await import("./page");

describe("Management · Users — bulk actions", () => {
  beforeEach(() => setUserStatus.mockClear());

  it("offers no checkbox for the owner or yourself — the refusable rows cannot enter a selection", async () => {
    render(<UsersPage />);
    await screen.findByText("نیما");
    // header select-all + one per SELECTABLE row (نیما، بهار) — the owner
    // (who is also `me`) contributes none
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByLabelText("انتخاب سارا")).toBeNull();
  });

  it("bulk-disables the selected members and SKIPS one already disabled", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText("نیما");

    await user.click(screen.getByLabelText("انتخاب نیما"));
    await user.click(screen.getByLabelText("انتخاب بهار"));
    expect(screen.getByText("۲ عضو انتخاب شده")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "غیرفعال‌سازی انتخاب‌شده‌ها" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("۱ تغییر"));
    // بهار is already disabled: exactly ONE write proves the skip — a second
    // call would mean idempotence was spelled as a redundant mutation
    expect(setUserStatus).toHaveBeenCalledTimes(1);
    expect(setUserStatus).toHaveBeenCalledWith("u-a", "disabled");
    // the tally reports no failures — a skip is not a failure
    expect(screen.getByRole("status").textContent).toContain("۰ ناموفق");
  });
});

describe("Management · Users — member detail", () => {
  beforeEach(() => setUserStatus.mockClear());

  it("opens from the name, shows the identity facts, and mutates through the shared path", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    await screen.findByText("نیما");

    await user.click(screen.getByRole("button", { name: "نیما" }));
    const panel = await screen.findByRole("dialog", { name: "جزئیات عضو" });
    expect(panel.textContent).toContain("nima@example.test");
    expect(panel.textContent).toContain("@nima");

    // the panel's disable control ends at the SAME api call as the table's
    await user.click(screen.getByRole("dialog").querySelector("button.btn-secondary") as HTMLElement);
    await waitFor(() => expect(setUserStatus).toHaveBeenCalledWith("u-a", "disabled"));
  });
});
