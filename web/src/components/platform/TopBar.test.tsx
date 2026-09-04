import { render, screen } from "@testing-library/react";
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
  /* the bar carries a LINK since 2026-09-05 (the room's door). Without this
     the mock hands back `undefined` and React throws on an undefined element
     type — which renders as four failed tests about the assistant slot, none
     of which is what broke. */
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
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

describe("the bar's own doors (2026-09-05)", () => {
  it("puts the clock and the search box on the MAIN MENU's side", async () => {
    /*
     * User directive: "put the date and time and also search at the other
     * side in the top menu, near to the main menu."
     *
     * Asserted as ORDER inside the start cluster rather than as a class,
     * because the cluster is what decides the side and a class on either
     * element could be right while it sat in the wrong parent. The trail is
     * the third member and must stay last: it is the only element here whose
     * width is its content, so it is the one that truncates.
     */
    render(<TopBar me={null} />);
    const search = screen.getByRole("search");
    const trail = screen.getByRole("navigation");
    const cluster = search.parentElement!;

    expect(cluster).toContainElement(trail);
    /* the clock is in the same cluster, ahead of both */
    expect(cluster.textContent).toContain("22 Aug 2026");
    // eslint-disable-next-line no-bitwise
    expect(search.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    /* the control, and it is what makes the three lines above mean
       something: the theme toggle stays at the OTHER end. A version that
       moved the whole cluster would satisfy every assertion up to here.
       (The bell would be the obvious control and is not one — it renders
       only for a resolved identity, and this bar is drawn with none.) */
    expect(cluster).not.toContainElement(
      screen.getByRole("button", { name: "themeToggle" }));
  });

  it("carries the room's door as a link, in the theme toggle's own box", async () => {
    /*
     * "Add a small icon with the same size as switch theme near it for the
     * chat section." A LINK, because it goes somewhere — and the same
     * `btn btn-icon` box as the toggle beside it, since a twelfth invented
     * square in this cluster is what the 2026-09-02 audit was about.
     *
     * The names are KEYS: this file mocks `useTranslations` to echo them,
     * which keeps it about the bar's shape rather than about the catalogue.
     */
    render(<TopBar me={null} />);
    const door = screen.getByRole("link", { name: "chat" });
    expect(door).toHaveAttribute("href", expect.stringContaining("/chat"));

    const toggle = screen.getByRole("button", { name: "themeToggle" });
    for (const shape of ["btn", "btn-icon"]) {
      expect(door.className.split(/\s+/)).toContain(shape);
      expect(toggle.className.split(/\s+/)).toContain(shape);
    }
  });
});
