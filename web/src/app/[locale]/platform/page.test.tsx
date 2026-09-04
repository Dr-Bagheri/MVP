import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { openRowMenu } from "@/test/rowMenu";
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
const updatePlatformOrganization = vi.fn();
const updatePlatformUser = vi.fn();
const softDeletePlatformOrganization = vi.fn();
const restorePlatformOrganization = vi.fn();
const softDeletePlatformUser = vi.fn();
const restorePlatformUser = vi.fn();

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
    updatePlatformOrganization: (...a: unknown[]) => updatePlatformOrganization(...a),
    updatePlatformUser: (...a: unknown[]) => updatePlatformUser(...a),
    softDeletePlatformOrganization: (...a: unknown[]) => softDeletePlatformOrganization(...a),
    restorePlatformOrganization: (...a: unknown[]) => restorePlatformOrganization(...a),
    softDeletePlatformUser: (...a: unknown[]) => softDeletePlatformUser(...a),
    restorePlatformUser: (...a: unknown[]) => restorePlatformUser(...a),
    // Deliberately NO call / transcript / summary / conversation method: the
    // console must not be able to reach content even if a future edit tries.
  },
}));

const { default: PlatformControlPage } = await import("./page");

const SELF = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const ORG = "11111111-1111-4111-8111-111111111111";
const DEL_ORG = "44444444-4444-4444-8444-444444444444";

const overview = {
  current_user_id: SELF,
  organizations: { total: 2, active: 1, suspended: 1 },
  users: { total: 3, active: 2, pending: 0, disabled: 1 },
  platform_roots: 1,
};

const liveOrg = {
  id: ORG, name: "Northwind", status: "active", locale: "en",
  created_at: "2026-08-01T00:00:00.000Z", member_count: 2,
  deleted_at: null, purge_after: null,
};
const deletedOrg = {
  id: DEL_ORG, name: "Oldco", status: "suspended", locale: "en",
  created_at: "2026-07-01T00:00:00.000Z", member_count: 0,
  deleted_at: "2026-08-18T00:00:00.000Z", purge_after: "2026-08-25T00:00:00.000Z",
};
const selfUser = {
  id: SELF, org_id: ORG, org_name: "Northwind", email: "operator@example.test",
  display_name: "Operator", display_name_en: null, username: null, locale: "fa",
  role: "owner", status: "active", created_at: "2026-08-01T00:00:00.000Z",
  last_seen_at: null, is_platform_root: true, deleted_at: null, purge_after: null,
};
const memberUser = {
  id: MEMBER, org_id: ORG, org_name: "Northwind", email: "member@example.test",
  display_name: "Member One", display_name_en: null, username: "m1", locale: "fa",
  role: "member", status: "active", created_at: "2026-08-02T00:00:00.000Z",
  last_seen_at: null, is_platform_root: false, deleted_at: null, purge_after: null,
};

function rootData() {
  platformOverview.mockResolvedValue(overview);
  platformOrganizations.mockImplementation((q: { deleted?: boolean }) =>
    Promise.resolve({ items: q?.deleted ? [deletedOrg] : [liveOrg], next_offset: null }),
  );
  platformUsers.mockImplementation((q: { deleted?: boolean }) =>
    Promise.resolve({ items: q?.deleted ? [] : [selfUser, memberUser], next_offset: null }),
  );
  platformAudit.mockResolvedValue({
    items: [{
      id: "audit-1", actor_id: SELF, actor_email: "operator@example.test",
      action: "root_bootstrapped", target_user_id: SELF, target_org_id: null,
      reason: "Initial controlled setup", created_at: "2026-08-01T00:00:00.000Z",
    }],
    next_offset: null,
  });
}

/**
 * Open a row's action menu the way a person does.
 *
 * The console's actions used to be a strip of bordered buttons in each row;
 * they are the platform's right-click row menu now (audit finding,
 * 2026-09-02), which is the same gesture the records table, the members table
 * and the sessions table answer to. The tests moved with the affordance — what
 * they assert is unchanged: WHICH actions a given row offers, and which of
 * them it refuses.
 */
/* the ⋯ at the end of the row (2026-09-04) — shared, so the next change to
   how a row's menu opens is one edit rather than five */

/** A menu entry, by its label. */
function item(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name });
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

  it("loads only metadata for a root, and exposes an ACTABLE (not disabled) control", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    render(<PlatformControlPage />);

    await screen.findByText("Northwind");
    expect(platformOrganizations).toHaveBeenCalledWith({ search: "", limit: 50, deleted: false });

    // The whole point of the redesign: the action is a live entry, not a
    // permanently-disabled one gated behind a hidden textarea.
    await openRowMenu("Northwind");
    expect(item("تعلیق سازمان")).not.toHaveAttribute("aria-disabled", "true");

    // The black title and the privacy banner were removed by request; guard
    // against either quietly returning (the banner text is unique to it).
    expect(screen.queryByText(/این کنسول تنها فرادادهٔ سازمان/)).toBeNull();

    // Negative control: no content view exists, and none can be conjured.
    expect(screen.queryByText("Customer transcript that must stay private")).toBeNull();
  });

  it("an action requires a reason and then calls the API with it", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    setPlatformOrganizationStatus.mockResolvedValue({ changed: true });
    render(<PlatformControlPage />);

    await screen.findByText("Northwind");
    await openRowMenu("Northwind");
    fireEvent.click(item("تعلیق سازمان"));

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

  it("protects the signed-in root: cannot disable, delete, or remove-root themselves", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    render(<PlatformControlPage />);
    await screen.findByText("Northwind");

    fireEvent.click(screen.getByRole("tab", { name: /کاربران/ }));
    await screen.findByText("operator@example.test");
    await openRowMenu("operator@example.test");
    /* REFUSED, not absent. The three acts stay in the menu and say no —
       "you may not disable yourself" and "there is no such action" are
       different sentences, and this is the screen where the difference is
       the point. */
    expect(item("غیرفعال‌کردن کاربر")).toHaveAttribute("aria-disabled", "true");
    expect(item("برداشتن ریشهٔ پلتفرم")).toHaveAttribute("aria-disabled", "true");
    expect(item("حذف کاربر")).toHaveAttribute("aria-disabled", "true");
  });

  it("offers those same three acts on SOMEBODY ELSE — the row that must answer YES", async () => {
    /* the control that makes the assertion above mean something: without it,
       a menu that disabled everything unconditionally would pass it, and the
       console would be a screen that can only watch. */
    platformAccess.mockResolvedValue({ platform_root: true });
    render(<PlatformControlPage />);
    await screen.findByText("Northwind");

    fireEvent.click(screen.getByRole("tab", { name: /کاربران/ }));
    await screen.findByText("member@example.test");
    await openRowMenu("member@example.test");
    expect(item("غیرفعال‌کردن کاربر")).not.toHaveAttribute("aria-disabled", "true");
    expect(item("حذف کاربر")).not.toHaveAttribute("aria-disabled", "true");
    /* a member is not a root, so the grant is what their row offers */
    expect(item("تبدیل به ریشهٔ پلتفرم")).not.toHaveAttribute("aria-disabled", "true");
  });

  it("edits organization metadata with a reason; sends name + locale, never content", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    updatePlatformOrganization.mockResolvedValue({ changed: true });
    render(<PlatformControlPage />);
    await screen.findByText("Northwind");

    await openRowMenu("Northwind");
    fireEvent.click(item("ویرایش"));

    const name = await screen.findByLabelText("نام سازمان");
    expect((name as HTMLInputElement).value).toBe("Northwind"); // prefilled from the record
    fireEvent.change(name, { target: { value: "Northwind Ltd" } });
    fireEvent.change(screen.getByLabelText(/دلیل/), { target: { value: "rename requested by owner" } });

    fireEvent.click(screen.getByRole("button", { name: "ذخیرهٔ تغییرات" }));
    await waitFor(() =>
      expect(updatePlatformOrganization).toHaveBeenCalledWith(
        ORG, { name: "Northwind Ltd", locale: "en" }, "rename requested by owner",
      ),
    );
  });

  it("the user edit form has no email field — email is auth-owned and immutable", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    render(<PlatformControlPage />);
    await screen.findByText("Northwind");

    fireEvent.click(screen.getByRole("tab", { name: /کاربران/ }));
    await screen.findByText("member@example.test");
    await openRowMenu("member@example.test");
    fireEvent.click(item("ویرایش"));

    // The immutability note is shown; the email is nowhere editable.
    expect(await screen.findByText("ایمیل، هویتِ ورود است و اینجا قابل تغییر نیست.")).toBeTruthy();
    expect(screen.queryByDisplayValue("member@example.test")).toBeNull();
  });

  it("soft-deletes an organization through the reason dialog", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    softDeletePlatformOrganization.mockResolvedValue({ changed: true });
    render(<PlatformControlPage />);
    await screen.findByText("Northwind");

    await openRowMenu("Northwind");
    fireEvent.click(item("حذف سازمان"));
    fireEvent.change(await screen.findByLabelText(/دلیل/), { target: { value: "offboarding the account" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید" }));

    await waitFor(() =>
      expect(softDeletePlatformOrganization).toHaveBeenCalledWith(ORG, "offboarding the account"),
    );
  });

  it("the Recently-deleted view queries the deleted set and offers Restore", async () => {
    platformAccess.mockResolvedValue({ platform_root: true });
    render(<PlatformControlPage />);
    await screen.findByText("Northwind");

    fireEvent.click(screen.getByRole("button", { name: "حذف‌شده‌های اخیر" }));

    await waitFor(() =>
      expect(platformOrganizations).toHaveBeenCalledWith({ search: "", limit: 50, deleted: true }),
    );
    expect(await screen.findByText("Oldco")).toBeTruthy();
    await openRowMenu("Oldco");
    expect(item("بازیابی سازمان")).toBeTruthy();
    // In trash view the suspend/delete acts are not offered at all — the row
    // is already deleted, and the only two questions left are put it back or
    // finish it now.
    expect(screen.queryByRole("menuitem", { name: "حذف سازمان" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "تعلیق سازمان" })).toBeNull();
    expect(item("پاک‌سازی فوری")).toBeTruthy();
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
