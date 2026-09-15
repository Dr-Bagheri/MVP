import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";
import { getPresenceAnchorSnapshot } from "./presenceAnchor";
import { getPageMenuAnchorSnapshot } from "./pageMenuAnchor";

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
vi.mock("./AvatarMenu", () => ({ AvatarMenu: () => <button type="button">Avatar</button> }));
vi.mock("./Breadcrumbs", () => ({ Breadcrumbs: () => <nav>Calls</nav> }));
vi.mock("./NotificationBell", () => ({
  NotificationBell: () => <button type="button" aria-label="bell">Bell</button>,
}));

/** a resolved identity — the bell renders only for one, and it is a member of
    the cluster whose order this file now asserts */
const ME = { id: "u-1", display_name: "امیر" } as never;

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

  /*
   * THE PAGE'S OWN MENU SLOT, at the other end of the bar.
   *
   * The pair the presence cradle above is asserted as, for the same reasons:
   * ONE host, released on unmount (a departing bar leaving a stale element
   * registered is a portal into a detached tree — the button renders into
   * nothing and the page looks like it lost its menu), and `lg:hidden`,
   * because from `lg` up Home's column is on screen and its door would be a
   * second way into the room the reader is standing in.
   */
  it("registers ONE host for the page's own menu, and releases it", () => {
    const { container, unmount } = render(<TopBar me={null} />);
    const host = container.querySelector<HTMLElement>("[data-page-menu-cradle]");

    expect(host).not.toBeNull();
    expect(getPageMenuAnchorSnapshot()).toBe(host);
    expect(host).toHaveClass("lg:hidden");
    /* and it opens no gap on the routes that fill nothing */
    expect(host).toHaveClass("empty:hidden");

    unmount();
    expect(getPageMenuAnchorSnapshot()).toBeNull();
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

  it("offers the mini recorder NO slot — it floats over the assistant (2026-09-09)", () => {
    /*
     * The pill used to portal into an anchor here. The search box is centred
     * on the WINDOW now, on a full-width absolute layer that crosses this
     * cluster, so the two shared one strip and the field's layer won — a
     * rolling microphone reading as a smear behind the search box. Asserted
     * as an ABSENCE, because the version that still renders the anchor looks
     * perfectly fine and only disagrees once a take is live.
     */
    const { container } = render(<TopBar me={null} />);
    expect(container.querySelector("#neurai-topbar-recorder")).toBeNull();
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
  it("centres the search box on the WINDOW, and carries no clock", async () => {
    /*
     * User directive, 2026-09-08: "delete the clock and center the search
     * absolutely wise relative to the screen width."
     *
     * Both halves, and the second one is asserted as GEOMETRY rather than as
     * a parent: this header is the rail's flex sibling, so a layer centred
     * inside it sits half a rail off the middle of the SCREEN — which is the
     * version that looks centred on the page the whole time it is wrong. So
     * the layer must be the window's own width, pulled back by exactly the
     * rail, and it must be pulled with the LOGICAL property, since the
     * physical one takes it off the far side of a Persian window.
     *
     * The trail is the control: it stays in the flow cluster, which is what
     * makes "the search left that cluster" mean something.
     */
    render(<TopBar me={null} />);
    const search = screen.getByRole("search");
    const trail = screen.getByRole("navigation");

    const layer = search.closest("div.absolute")!;
    expect(layer).not.toBeNull();
    /*
     * TWO EDGES, NEVER A WIDTH (2026-09-09). This asserted `w-screen`, and
     * `w-screen` is `100vw` — the width of the INITIAL containing block, which
     * ignores page zoom and includes the classic scrollbar. Measured on the
     * running product, the field's centre sat 254px right of the window's.
     *
     * `start-[-w-rail]` with `end-0` needs no unit that can be wrong: the end
     * IS the window's end, the start is pulled back by exactly the rail, and
     * layout measures what is between them. So the absence of `w-screen` is
     * asserted too — re-adding it is the defect returning, and it would satisfy
     * every other line here.
     */
    expect(layer.className).toContain("end-0");
    expect(layer.className).not.toContain("w-screen");
    expect(layer.className).toContain("justify-center");
    expect(layer.className).toContain("start-0");
    expect(layer.className).toContain("md:start-[calc(theme(width.rail)*-1)]");
    expect(layer.className).not.toContain("left-");
    /* And it hangs off the HEADER, not off the padded glass strip inside it: an
       absolutely positioned element resolves against its containing block's
       PADDING box, and the strip's `px-4` put the axis 14px late. */
    expect(layer.parentElement?.tagName).toBe("HEADER");

    /* it floats OVER the bar rather than in it — the trail keeps the flow */
    expect(layer).not.toContainElement(trail);
    expect(layer.className).toContain("pointer-events-none");
    expect(search.closest(".pointer-events-auto")).not.toBeNull();

    /* the clock is GONE, asserted as an absence: a date is the one thing in
       this bar that renders nothing until it mounts, so "I did not find it"
       has to be checked against the whole bar rather than one cluster */
    const bar = trail.closest("header")!;
    expect(bar.textContent).not.toMatch(/\d{1,2}:\d{2}/);

    /* the control: the theme toggle stays at the OTHER end, so a version
       that simply moved everything would not satisfy the lines above */
    const cluster = trail.parentElement!;
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
    for (const shape of ["btn", "btn-icon-sm"]) {
      expect(door.className.split(/\s+/)).toContain(shape);
      expect(toggle.className.split(/\s+/)).toContain(shape);
    }
  });
});

/**
 * ONE HEIGHT, ONE ORDER (user directive, 2026-09-06: "give the buttons on the
 * top menu the same size — the en/fa size is the good one — and add a divider
 * between the theme and the others; the order is from the end: en - fa |
 * theme mode - chat - notification").
 *
 * The order is asserted as DOCUMENT POSITION rather than as left and right:
 * the cluster mirrors with the page, so "en at the end" is one fact in both
 * locales and "en on the right" is only true in one of them.
 */
describe("the top bar's end cluster", () => {
  it("runs bell → chat → theme → divider → fa → en, so the locale pair sits at the very edge", () => {
    const { container } = render(<TopBar me={ME} />);
    const theme = screen.getByRole("button", { name: "themeToggle" });
    const cluster = theme.parentElement!;
    const order = [...cluster.children].map((el) => {
      if (el.getAttribute("aria-label") === "bell") return "bell";
      if (el.getAttribute("aria-label") === "chat") return "chat";
      if (el.getAttribute("aria-label") === "themeToggle") return "theme";
      if (el.tagName === "SPAN" && el.className.includes("w-px")) return "divider";
      /* the pair is a GROUP of two buttons — the cluster's child is the div,
         and the buttons inside it are named by their own text */
      if ([...el.querySelectorAll("button")].some((b) => b.textContent === "fa")) return "locales";
      return null;
    }).filter(Boolean);
    expect(order).toEqual(["bell", "chat", "theme", "divider", "locales"]);

    /* the pair inside its own group, fa before en — the edge is en's */
    const [fa, en] = ["fa", "en"].map((l) => screen.getByRole("button", { name: l }));
    // eslint-disable-next-line no-bitwise
    expect(fa!.compareDocumentPosition(en!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* the divider is between the theme and the pair, not decoration at the end */
    // eslint-disable-next-line no-bitwise
    expect(theme.compareDocumentPosition(fa!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[data-platform-topbar]")).not.toBeNull();
  });

  it("puts every control in the row at the locale pair's height, and none at the dense 28", () => {
    /*
     * The discriminating half: asserting that the buttons carry a compact
     * class is satisfied by a bar that also carries the 28px square somewhere
     * in the same row, which is exactly the state this directive corrected —
     * three heights among five controls.
     */
    render(<TopBar me={ME} />);
    const theme = screen.getByRole("button", { name: "themeToggle" });
    const cluster = theme.parentElement!;
    const compact = /(^|\s)btn-(sm|icon-sm)(\s|$)/;
    /* the bell is mocked in this file (it fetches on mount); its own box is
       asserted where it is written — NotificationBell.invites.test.tsx */
    for (const el of [...cluster.querySelectorAll("button, a")].filter((e) => e.getAttribute("aria-label") !== "bell")) {
      expect(compact.test(el.className), `${el.getAttribute("aria-label") ?? el.textContent} is not at the row's height`).toBe(true);
      expect(/(^|\s)btn-icon(\s|$)/.test(el.className), "the dense 28px square has no place in this row").toBe(false);
    }
  });

  it("stands the search box at that height too, and wide enough for its own hint", () => {
    render(<TopBar me={ME} />);
    const search = screen.getByRole("search");
    const classes = search.className.split(/\s+/);
    /* `.input` is the 40px field and every neighbour is 34 — the compact
       field is the theme's own answer for a field standing in a toolbar */
    expect(classes).toContain("input-sm");
    expect(classes).not.toContain("input");
    /* wider than the 14rem that cut the placeholder mid-word */
    expect(classes).toContain("w-80");
  });
});

/**
 * R23 — NO RULE UNDER THE BAR.
 *
 * `border-b border-border bg-surface` drew the app as a stack of panes and,
 * with an opaque strip, gave a backdrop filter nothing to filter. The bar is a
 * translucent sheet now and the page passes under it.
 *
 * The pair again: no seam AND the sheet. A bar with neither is a row of
 * controls standing on the page ground with the content sliding through it.
 */
describe("R23: the bar is a sheet, not a ruled strip", () => {
  it("carries the glass and none of the seam", () => {
    render(<TopBar me={ME} />);
    const bar = screen.getByRole("button", { name: "themeToggle" }).closest("div.glass-chrome");
    expect(bar, "the top bar's own row is not wearing the sheet").not.toBeNull();
    const classes = bar!.className.split(/\s+/);
    for (const seam of ["border-b", "border-border", "bg-surface"]) {
      expect(classes, `the bar still carries ${seam}`).not.toContain(seam);
    }
  });

  it("rounds the app's top-END corner from md, and only that one", () => {
    /*
     * The other half of the app's top edge (2026-09-08: "make the corner of the
     * rail and the top header corner rounded"). The rail owns `rounded-ss` and
     * this owns `rounded-se`; rounding either alone leaves a square corner at
     * the other end of the same line, which is why each is asserted where it
     * lives. Logical, so the curve follows the reading direction.
     *
     * AND IT IS `md:` (2026-09-08, from the mobile view). The pair only means
     * something where both halves are drawn, and the rail is `md:flex` — below
     * that this bar spans the whole window, so the unqualified class curved ONE
     * end of a full-width strip and left the other square. The same gate the
     * `.chrome-notch` below already carries, for the same reason.
     *
     * The bare class is asserted ABSENT as well as the prefixed one present:
     * `rounded-se-2xl md:rounded-se-2xl` satisfies a "contains" check while
     * behaving exactly like the version this corrects.
     */
    render(<TopBar me={ME} />);
    const bar = screen.getByRole("button", { name: "themeToggle" }).closest("div.glass-chrome")!;
    const classes = bar.className.split(/\s+/);
    expect(classes, "the bar's outer corner is square from md up").toContain("md:rounded-se-2xl");
    for (const wrong of ["rounded-se-2xl", "rounded-2xl", "rounded-tr-2xl", "rounded-ss-2xl"]) {
      expect(classes, `the bar carries ${wrong} at every width`).not.toContain(wrong);
    }
  });

  it("curves the chrome around the corner the rail and the bar make", () => {
    /*
     * The third corner (2026-09-08: "on the platform corner of the rail and
     * the header make it rounded corner with the platform view"). The two
     * OUTER corners are `rounded-ss`/`rounded-se`; this one is the inside of
     * the L, and it belongs to the page — which is a gap, not an element, so
     * it can only be rounded by the chrome growing into it. The assertion is
     * therefore that the square exists and is masked, not that anything
     * carries a radius.
     */
    render(<TopBar me={ME} />);
    const notch = document.querySelector("[data-platform-corner]");
    expect(notch, "no chrome fills the rail/bar corner").not.toBeNull();
    const classes = notch!.className.split(/\s+/);
    expect(classes, "the corner is not masked into a curve").toContain("chrome-notch");
    /* start-0/top-full is what puts it ON the seam; a hand-typed offset here
       would be a second copy of `w-rail`. */
    expect(classes).toContain("start-0");
    expect(classes).toContain("top-full");
    /* below md there is no rail, so a notch would bite the window's edge */
    expect(classes, "the corner survives the rail being hidden").toContain("hidden");
    expect(classes).toContain("md:block");
  });

  it("marks the active locale by FILL, never by an outline", () => {
    /* the resting segment had a `border-border` edge — two hairlines in a row
       of controls that, after R23, has none. The active face is the accent
       tint; the check is that neither face draws a border at all. */
    render(<TopBar me={ME} />);
    for (const l of ["fa", "en"]) {
      const seg = screen.getByRole("button", { name: l });
      expect(seg.className.split(/\s+/), `the ${l} segment is outlined`).not.toContain("border");
    }
    /* whichever one is current — the mocked locale decides, and naming it
       here would make the assertion a fact about the mock */
    const active = ["fa", "en"]
      .map((l) => screen.getByRole("button", { name: l }))
      .find((b) => b.getAttribute("aria-current") === "true");
    expect(active, "no segment is marked current").toBeDefined();
    expect(active!.className).toContain("bg-accent-soft");
  });
});
