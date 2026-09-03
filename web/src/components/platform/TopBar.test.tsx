import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";
import { getPresenceAnchorSnapshot } from "./presenceAnchor";
import { getRecorderAnchorSnapshot } from "./recorderAnchor";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/echo",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/usePreferences", () => ({ useTimezonePreference: () => "auto" }));
vi.mock("@/lib/format", () => ({ formatDate: () => "22 Aug 2026" }));
vi.mock("./AvatarMenu", () => ({ AvatarMenu: () => <button type="button">Avatar</button> }));
vi.mock("./Breadcrumbs", () => ({ Breadcrumbs: () => <nav>Calls</nav> }));
vi.mock("./NotificationBell", () => ({ NotificationBell: () => <button type="button">Bell</button> }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("TopBar assistant slot", () => {
  it("registers ONE host for the assistant's trigger", () => {
    const { container, unmount } = render(<TopBar me={null} />);
    const header = container.querySelector("[data-platform-topbar]");
    const host = container.querySelector<HTMLElement>("#neurai-topbar-presence");

    expect(header).not.toBeNull();
    expect(getPresenceAnchorSnapshot()).toBe(host);

    unmount();
    expect(getPresenceAnchorSnapshot()).toBeNull();
  });

  it("hides that slot from md up — the sidebar's own rail carries the door there", () => {
    /*
     * The one-door rule, at the half of it this file owns (2026-09-03).
     *
     * `AssistantSidebar` writes one trigger and places it twice: inside its
     * collapsed rail, which exists only at `md` and up, and in this slot. If
     * this slot ever stopped being `md:hidden`, both would be on screen
     * together at desktop widths — two ways into one room, which is exactly
     * what the orb's removal was meant to end.
     */
    const { container } = render(<TopBar me={null} />);
    const host = container.querySelector<HTMLElement>("#neurai-topbar-presence")!;
    expect(host).toHaveClass("md:hidden");
  });

  it("offers the mini recorder its slot beside the clock (user directive, 2026-08-23)", () => {
    // the seam FloatingRecorder docks through: the bar must register the
    // REAL slot element — a slot rendered but never registered would leave
    // the pill floating forever while this markup reads as done
    const { container, unmount } = render(<TopBar me={null} />);
    const slot = container.querySelector<HTMLElement>("#neurai-topbar-recorder");
    expect(slot).not.toBeNull();
    expect(getRecorderAnchorSnapshot()).toBe(slot);
    unmount();
    expect(getRecorderAnchorSnapshot()).toBeNull();
  });

  it("the ORB's ring is gone — the slot draws nothing of its own (2026-09-03)", () => {
    const { container } = render(<TopBar me={null} />);
    expect(container.querySelector("[data-presence-curve]")).toBeNull();
    const host = container.querySelector<HTMLElement>("#neurai-topbar-presence")!;
    /* the slot is an empty box the sidebar portals a button into. It used to
       be a 68px circle floating over the bar's centre column — a drawing that
       existed for the orb, and whose return would be the old design creeping
       back one class at a time. */
    expect(host.children).toHaveLength(0);
    expect(host.className).not.toContain("rounded-full");
    expect(host.className).not.toContain("absolute");
    expect(host.className).not.toContain("backdrop-blur");
  });
});
