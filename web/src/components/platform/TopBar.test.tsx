import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";
import { getPresenceAnchorSnapshot } from "./presenceAnchor";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/echo",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/usePreferences", () => ({ useTimezonePreference: () => "auto" }));
vi.mock("@/lib/format", () => ({ formatDate: () => "22 Aug 2026" }));
vi.mock("./AvatarMenu", () => ({ AvatarMenu: () => <button type="button">Avatar</button> }));
vi.mock("./Breadcrumbs", () => ({ Breadcrumbs: () => <nav>Calls</nav> }));
vi.mock("./NotificationBell", () => ({ NotificationBell: () => <button type="button">Bell</button> }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("TopBar presence ring", () => {
  it("registers ONE interactive host that is itself the single ring", () => {
    const { container, unmount } = render(<TopBar me={null} />);
    const header = container.querySelector("[data-platform-topbar]");
    const host = container.querySelector<HTMLElement>("#neurai-topbar-presence");

    expect(header).not.toBeNull();
    expect(host).toHaveClass("pointer-events-auto");
    expect(host).toHaveClass("rounded-full");
    expect(host).toHaveClass("border-border-strong"); // the ONE line circle
    expect(getPresenceAnchorSnapshot()).toBe(host);

    unmount();
    expect(getPresenceAnchorSnapshot()).toBeNull();
  });

  it("the glass sphere is GONE — no curve bulge, no optical layers (user redesign, 2026-08-22)", () => {
    const { container } = render(<TopBar me={null} />);
    expect(container.querySelector("[data-presence-curve]")).toBeNull();
    const host = container.querySelector<HTMLElement>("#neurai-topbar-presence")!;
    // the host is a single EMPTY ring the dock portals into — extra glass
    // layers would be the old design creeping back
    expect(host.children).toHaveLength(0);
    expect(host.className).not.toContain("backdrop-blur");
  });
});
