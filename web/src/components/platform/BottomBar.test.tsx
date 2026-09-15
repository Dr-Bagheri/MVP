import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomBar } from "./BottomBar";
import { NAV_BAR, NAV_PRIMARY, NAV_UTILITY } from "./nav";

/**
 * THE PHONE'S OWN CHROME (2026-09-08, fixing the mobile view against the new
 * shell).
 *
 * Two rules meet on this one component, and neither had anything that runs:
 *
 *  · R23 — glass, and no layout borders. The sweep took `border-* border-border
 *    bg-surface` off the rail, the top bar, the home sidebar and every card,
 *    and stopped at `md`. The bar a phone always has on screen kept all three,
 *    which made it the last opaque pane in the product AND the last hairline
 *    drawing the app as a stack of panes.
 *  · the BAR'S CONTENTS. The `inBar` flags were set against a rail that has
 *    since lost workflows, agents, chat and the assistant, so the four-slot
 *    bar was filling two of them while Meetings and Tasks sat behind «More».
 *
 * Each is asserted as a PAIR, because either half passes on its own against a
 * version nobody wants: a bar with no seam and no sheet is a row of controls
 * standing on the page ground with the content sliding through it, and a bar
 * that wears the sheet while keeping its rule is glass with a line drawn on it.
 */

vi.mock("next-intl", () => ({
  /* the locale is for the Toaster the suite mounts above every render, not
     for this bar — mocked here because a partial module mock would leave the
     real next-intl provider missing under it */
  useLocale: () => "en",
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/meetings",
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}));

/** the bar itself — found by its role and label rather than by a class */
const bar = () => screen.getByRole("navigation", { name: "primaryNav" });

describe("R23: the mobile bar is a sheet, not a ruled strip", () => {
  it("carries the chrome's own class and none of the seam", () => {
    render(<BottomBar />);
    const classes = bar().className.split(/\s+/);

    /* the SAME class the rail and the top bar wear. Not a tone that looks
       like theirs: the bar is the rail's counterpart below `md`, the two are
       never on screen together, and one spelling is the only form in which
       they cannot come to disagree about "the chrome's colour". */
    expect(classes, "the phone's bar is not wearing the shell's sheet")
      .toContain("glass-chrome");

    for (const seam of ["border-t", "border-border", "bg-surface"]) {
      expect(classes, `the bar still carries ${seam}`).not.toContain(seam);
    }
  });

  it("keeps the safe-area padding under the sheet", () => {
    /* the control for the line above: a version that swapped the class list
       wholesale also drops this, and the iOS home indicator then sits on top
       of the row's labels. Translucent is not the same as absent. */
    render(<BottomBar />);
    expect(bar().className).toContain("pb-[env(safe-area-inset-bottom)]");
  });

  it("gives the More sheet the same treatment", () => {
    render(<BottomBar />);
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    const sheet = screen.getByRole("dialog", { name: "more" });
    const classes = sheet.className.split(/\s+/);

    /* SOLID, unlike the bar above it (2026-09-09): this one draws its own
       scrim, and the chrome's alpha over a darkened screen composites to the
       grey that made the platform's dialogs look switched off. Same family,
       no alpha — the rule is "a scrim behind it means `.glass-solid`". */
    expect(classes, "the More sheet is not wearing the solid sheet")
      .toContain("glass-solid");
    expect(classes, "the More sheet is translucent over its own scrim")
      .not.toContain("glass-chrome");
    for (const seam of ["border-t", "border-border", "bg-surface"]) {
      expect(classes, `the More sheet still carries ${seam}`).not.toContain(seam);
    }
    /* the CORNER stays: a sheet rising from the window's edge is not a pane
       join, and R23 removes seams rather than radii */
    expect(classes).toContain("rounded-t-2xl");
  });
});

describe("the bar's destinations", () => {
  it("fills the ceiling — three primaries beside More", () => {
    /*
     * The hole is the failure, and it is invisible from a desktop: the bar
     * rendered Home and Management with two empty thirds of a phone's width,
     * while the two rooms a person opens all day were one press deeper. So
     * this counts what RENDERS rather than reading the flags — the model is
     * asserted in nav.test.ts, and a bar that mapped over the wrong list
     * would satisfy that file completely.
     */
    render(<BottomBar />);
    const items = [...bar().children];
    expect(items).toHaveLength(4);
    expect(items[items.length - 1]!.textContent).toContain("more");
    expect(items.slice(0, 3).map((el) => el.textContent))
      .toEqual(["home", "meetings", "tasks"]);
  });

  it("marks the room the reader is standing in", () => {
    /* the pathname is mocked to /meetings, so exactly one entry is current —
       and the control is that the others are NOT, since a bar that marks
       everything and a bar that marks nothing both "have an aria-current" */
    render(<BottomBar />);
    const current = [...bar().querySelectorAll("[aria-current]")];
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("meetings");
  });

  it("leaves NOTHING unreachable: More lists every destination the bar omits", () => {
    /*
     * The rule the bar's own comment states, asserted against the nav model:
     * a rail entry the More sheet omits is invisible on a phone. Rebalancing
     * the flags moved Management OUT of the bar, and the check that this cost
     * nobody a destination is this one, not a reading of the flags.
     */
    render(<BottomBar />);
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    const sheet = screen.getByRole("dialog", { name: "more" });
    const listed = [...sheet.querySelectorAll("a")].map((el) => el.textContent);

    const omitted = [...NAV_PRIMARY, ...NAV_UTILITY]
      .filter((item) => !NAV_BAR.includes(item))
      .map((item) => item.key);
    expect(omitted.length, "every destination is in the bar — this test proves nothing")
      .toBeGreaterThan(0);
    for (const key of omitted) {
      expect(listed, `${key} is reachable from neither the bar nor More`).toContain(key);
    }
  });
});
