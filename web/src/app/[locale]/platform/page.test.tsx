import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const platformAccess = vi.fn();
const bootstrapPlatformRoot = vi.fn();
const platformOverview = vi.fn();
const platformOrganizations = vi.fn();
const platformUsers = vi.fn();
const platformAudit = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    platformAccess: () => platformAccess(),
    bootstrapPlatformRoot: () => bootstrapPlatformRoot(),
    platformOverview: () => platformOverview(),
    platformOrganizations: (query: unknown) => platformOrganizations(query),
    platformUsers: (query: unknown) => platformUsers(query),
    platformAudit: (query: unknown) => platformAudit(query),
    setPlatformOrganizationStatus: vi.fn(),
    setPlatformUserStatus: vi.fn(),
    grantPlatformRoot: vi.fn(),
    revokePlatformRoot: vi.fn(),
  },
}));

const { default: PlatformControlPage } = await import("./page");

const overview = {
  current_user_id: "22222222-2222-4222-8222-222222222222",
  organizations: { total: 2, active: 1, suspended: 1 },
  users: { total: 3, active: 2, pending: 0, disabled: 1 },
  platform_roots: 1,
};

function rootData() {
  platformOverview.mockResolvedValue(overview);
  platformOrganizations.mockResolvedValue({
    items: [{
      id: "11111111-1111-4111-8111-111111111111", name: "Northwind", status: "active", locale: "en",
      created_at: "2026-08-01T00:00:00.000Z", member_count: 2,
    }],
    next_offset: null,
  });
  platformUsers.mockResolvedValue({
    items: [{
      id: "22222222-2222-4222-8222-222222222222", org_id: "11111111-1111-4111-8111-111111111111",
      org_name: "Northwind", email: "operator@example.test", display_name: "Operator", username: null,
      role: "owner", status: "active", created_at: "2026-08-01T00:00:00.000Z", last_seen_at: null,
      is_platform_root: true,
    }],
    next_offset: null,
  });
  platformAudit.mockResolvedValue({
    items: [{
      id: "audit-1", actor_id: "22222222-2222-4222-8222-222222222222", actor_email: "operator@example.test",
      action: "root_bootstrapped", target_user_id: "22222222-2222-4222-8222-222222222222", target_org_id: null,
      reason: "Initial controlled setup", created_at: "2026-08-01T00:00:00.000Z",
    }],
    next_offset: null,
  });
}

describe("Platform-root console", () => {
  beforeEach(() => {
    platformAccess.mockReset();
    bootstrapPlatformRoot.mockReset();
    platformOverview.mockReset();
    platformOrganizations.mockReset();
    platformUsers.mockReset();
    platformAudit.mockReset();
    rootData();
  });

  it("does not request other-organization metadata for a non-root account", async () => {
    platformAccess.mockResolvedValue({ platform_root: false });
    render(<PlatformControlPage />);

    await screen.findByRole("heading", { name: "راه‌اندازی نخستین ریشهٔ پلتفرم" });
    expect(platformOverview).not.toHaveBeenCalled();
    expect(platformOrganizations).not.toHaveBeenCalled();
    expect(platformUsers).not.toHaveBeenCalled();
    expect(platformAudit).not.toHaveBeenCalled();
  });

  it("renders metadata controls and the explicit content privacy boundary for a root", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    render(<PlatformControlPage />);

    await screen.findByText("Northwind");
    expect(screen.getByText(/این کنسول تنها فرادادهٔ سازمان و کاربر را می‌بیند/)).toBeTruthy();
    expect(screen.getAllByText("operator@example.test")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "تعلیق سازمان" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "برداشتن ریشهٔ پلتفرم" })).toBeNull();
    expect(platformOrganizations).toHaveBeenCalledWith({ search: "", limit: 50 });

    // Negative control: the harmless-looking words below must never grow into
    // a content view. The source mock deliberately has no call/transcript
    // method; a future request for either fails the render instead of merely
    // reporting that this fixture happened to be empty.
    expect(screen.queryByText("Customer transcript that must stay private")).toBeNull();
  });

  it("claims only the signed-in account; the browser sends no target email or password", async () => {
    platformAccess.mockResolvedValue({ platform_root: false });
    bootstrapPlatformRoot.mockResolvedValue({ claimed: true });
    render(<PlatformControlPage />);

    fireEvent.click(await screen.findByRole("button", { name: "مطالبهٔ ریشهٔ پلتفرم" }));

    await waitFor(() => expect(bootstrapPlatformRoot).toHaveBeenCalledTimes(1));
    expect(bootstrapPlatformRoot).toHaveBeenCalledWith();
    await screen.findByText("Northwind");
  });
});
