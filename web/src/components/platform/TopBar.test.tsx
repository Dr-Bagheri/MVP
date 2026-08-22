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

describe("TopBar presence cradle", () => {
  it("registers one interactive host inside a non-blocking curved glass cradle", () => {
    const { container, unmount } = render(<TopBar me={null} />);
    const header = container.querySelector("[data-platform-topbar]");
    const curve = container.querySelector("[data-presence-curve]");
    const cradle = container.querySelector("[data-presence-cradle]");
    const host = container.querySelector<HTMLElement>("#neurai-topbar-presence");

    expect(header).not.toBeNull();
    expect(curve).toHaveClass("pointer-events-none");
    expect(cradle).toHaveClass("pointer-events-none");
    expect(host).toHaveClass("pointer-events-auto");
    expect(getPresenceAnchorSnapshot()).toBe(host);

    unmount();
    expect(getPresenceAnchorSnapshot()).toBeNull();
  });
});
