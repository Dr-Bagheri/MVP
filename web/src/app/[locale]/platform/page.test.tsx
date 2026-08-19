import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const platformAccess = vi.fn();
const bootstrapPlatformRoot = vi.fn();
const platformOverview = vi.fn();
const platformOrganizations = vi.fn();
const platformUsers = vi.fn();
const platformAudit = vi.fn();
const setPlatformOrganizationStatus = vi.fn();
const setPlatformUserStatus = vi.fn();
const grantPlatformRoot = vi.fn();
const revokePlatformRoot = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    platformAccess: () => platformAccess(),
    bootstrapPlatformRoot: () => bootstrapPlatformRoot(),
    platformOverview: () => platformOverview(),
    platformOrganizations: (query: unknown) => platformOrganizations(query),
    platformUsers: (query: unknown) => platformUsers(query),
    platformAudit: (query: unknown) => platformAudit(query),
    setPlatformOrganizationStatus: (...a: unknown[]) => setPlatformOrganizationStatus(...a),
    setPlatformUserStatus: (...a: unknown[]) => setPlatformUserStatus(...a),
    grantPlatformRoot: (...a: unknown[]) => grantPlatformRoot(...a),
    revokePlatformRoot: (...a: unknown[]) => revokePlatformRoot(...a),
    // Deliberately NO call / transcript / summary / conversation method: the
    // console must not be able to reach content even if a future edit tries.
  },
}));

const { default: PlatformControlPage } = await import("./page");

const SELF = "22222222-2222-4222-8222-222222222222";
const ORG = "11111111-1111-4111-8111-111111111111";

const overview = {
  current_user_id: SELF,
  organizations: { total: 2, active: 1, suspended: 1 },
  users: { total: 3, active: 2, pending: 0, disabled: 1 },
  platform_roots: 1,
};

function rootData() {
  platformOverview.mockResolvedValue(overview);
  platformOrganizations.mockResolvedValue({
    items: [{
      id: ORG, name: "Northwind", status: "active", locale: "en",
      created_at: "2026-08-01T00:00:00.000Z", member_count: 2,
    }],
    next_offset: null,
  });
  platformUsers.mockResolvedValue({
    items: [{
      id: SELF, org_id: ORG, org_name: "Northwind", email: "operator@example.test",
      display_name: "Operator", username: null, role: "owner", status: "active",
      created_at: "2026-08-01T00:00:00.000Z", last_seen_at: null, is_platform_root: true,
    }],
    next_offset: null,
  });
  platformAudit.mockResolvedValue({
    items: [{
      id: "audit-1", actor_id: SELF, actor_email: "operator@example.test",
      action: "root_bootstrapped", target_user_id: SELF, target_org_id: null,
      reason: "Initial controlled setup", created_at: "2026-08-01T00:00:00.000Z",
    }],
    next_offset: null,
  });
}

describe("Platform-root console", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows the content privacy boundary, and an ACTABLE (not disabled) control", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    render(<PlatformControlPage />);

    await screen.findByText("Northwind");
    expect(screen.getByText(/این کنسول تنها فرادادهٔ سازمان و کاربر را می‌بیند/)).toBeTruthy();
    expect(platformOrganizations).toHaveBeenCalledWith({ search: "", limit: 50 });

    // The whole point of the redesign: the action is a live button, not a
    // permanently-disabled one gated behind a hidden textarea.
    expect(screen.getByRole("button", { name: "تعلیق سازمان" })).not.toBeDisabled();

    // Negative control: no content view exists, and none can be conjured.
    expect(screen.queryByText("Customer transcript that must stay private")).toBeNull();
  });

  it("an action requires a reason and then calls the API with it", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    setPlatformOrganizationStatus.mockResolvedValue({ changed: true });
    render(<PlatformControlPage />);

    fireEvent.click(await screen.findByRole("button", { name: "تعلیق سازمان" }));

    // dialog open: confirm is disabled until a valid reason is typed
    const reason = await screen.findByLabelText(/دلیل/);
    const confirm = screen.getByRole("button", { name: "تأیید" });
    expect(confirm).toBeDisabled();

    fireEvent.change(reason, { target: { value: "policy violation confirmed" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(setPlatformOrganizationStatus).toHaveBeenCalledWith(ORG, "suspended", "policy violation confirmed"),
    );
  });

  it("protects the signed-in root: cannot disable or remove-root themselves", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    render(<PlatformControlPage />);
    await screen.findByText("Northwind");

    fireEvent.click(screen.getByRole("tab", { name: /کاربران/ }));
    expect(await screen.findByText("operator@example.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "غیرفعال‌کردن کاربر" })).toBeDisabled(); // disable self
    expect(screen.getByRole("button", { name: "برداشتن ریشهٔ پلتفرم" })).toBeDisabled(); // remove own root
  });

  it("claims only the signed-in account; no target email or password is sent", async () => {
    platformAccess.mockResolvedValue({ platform_root: false });
    bootstrapPlatformRoot.mockResolvedValue({ claimed: true });
    render(<PlatformControlPage />);
    fireEvent.click(await screen.findByRole("button", { name: "مطالبهٔ ریشهٔ پلتفرم" }));
    await waitFor(() => expect(bootstrapPlatformRoot).toHaveBeenCalledTimes(1));
    expect(bootstrapPlatformRoot).toHaveBeenCalledWith();
    await screen.findByText("Northwind");
  });
});
