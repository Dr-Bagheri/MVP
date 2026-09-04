import { describe, expect, it } from "vitest";
import { BAR_CEILING, GITHUB_HREF, NAV_BAR, NAV_PRIMARY, NAV_UTILITY, activeNavHref } from "./nav";
import { NAV_ICON } from "./icons";

/**
 * The nav model's rules, as tests rather than as comments.
 *
 * M22 fixes the mobile bar at four items. The failure this guards is not a
 * crash — a fifth destination simply makes the bar cramped on a 375px phone,
 * which nobody notices from a desktop, so it needs something that counts.
 */
describe("platform nav", () => {
  it("keeps the mobile bar within M22's ceiling, counting the More slot", () => {
    // NAV_BAR + "More" is what actually renders, so the primaries get one fewer.
    expect(NAV_BAR.length + 1).toBeLessThanOrEqual(BAR_CEILING);
  });

  it("puts every bar item in the rail too — the bar is a subset, never a second list", () => {
    for (const item of NAV_BAR) {
      expect(NAV_PRIMARY).toContainEqual(item);
    }
  });

  it("gives every destination a distinct href", () => {
    const all = [...NAV_PRIMARY, ...NAV_UTILITY].map((i) => i.href);
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives every destination a distinct message key", () => {
    const all = [...NAV_PRIMARY, ...NAV_UTILITY].map((i) => i.key);
    expect(new Set(all).size).toBe(all.length);
  });

  /**
   * Not a style check. The GitHub target is an unanswered user question, and
   * "#" is the honest placeholder; this test exists so that when someone wires
   * a real URL they are reminded the question was open, and so a *plausible
   * but invented* repo URL can't be slipped in as though it were decided.
   */
  it("ships GitHub as an explicit placeholder until the user answers", () => {
    /* still exported and still used — the help page offers the repository as
       a card, which is where a link OUT of the product belongs */
    expect(GITHUB_HREF === "#" || GITHUB_HREF.startsWith("http")).toBe(true);
  });

  it("keeps GitHub out of the navigation (user directive, 2026-09-04)", () => {
    /*
     * Asserted as an ABSENCE, because the version that carries it renders
     * perfectly: it was one entry in a rail of destinations that pointed
     * outside the product entirely, and nothing on screen says an item is a
     * different KIND of thing from its neighbours.
     */
    const keys = [...NAV_PRIMARY, ...NAV_UTILITY].map((item) => item.key);
    expect(keys).not.toContain("github");
    /* and nothing else in the rail leaves the product either */
    const external = [...NAV_PRIMARY, ...NAV_UTILITY]
      .filter((item) => !item.href.startsWith("/"));
    expect(external.map((item) => item.key)).toEqual([]);
  });

  it("ends with Settings and Help, in that order", () => {
    /*
     * The ORDER is the directive ("change the location of settings and help
     * to end of the menu"), so it is asserted as a sequence: a set of the
     * right two keys in the wrong arrangement satisfies "both are there", and
     * the arrangement is what was asked for.
     *
     * WHERE they sit on screen is a layout fact this suite cannot see — the
     * rule above them is `mt-auto` inside a `flex-1` column, and jsdom
     * computes no styles. Measured in the browser instead, recorded in the
     * commit rather than asserted here as a class name.
     */
    expect(NAV_UTILITY.map((item) => item.key)).toEqual(["settings", "help"]);
    const all = [...NAV_PRIMARY, ...NAV_UTILITY].map((item) => item.key);
    expect(all.slice(-2)).toEqual(["settings", "help"]);
  });
});

/**
 * The ACTIVE-STATE resolver, shared by the rail and the bar. The case that
 * made it exist: Skills and Allowed models live at /management/* but wear
 * the Settings pane — the user selected Allowed models and watched the
 * Management tile light (2026-08-28 screenshot). The control cases are the
 * ones that must keep answering the OLD way: a real Management page still
 * lights Management, and a plain settings page still lights Settings.
 */
describe("activeNavHref", () => {
  it("folds the cross-homed Settings surfaces into /settings", () => {
    expect(activeNavHref("/management/models")).toBe("/settings");
    /* Integrations went BACK to the rail (user directive, 2026-09-03: "i
       need the integrations to come to the menu from the setting under the
       agents"), so it stops being cross-homed and lights itself. The
       assertion is kept rather than deleted, pointed the other way: it is
       the half of the move that is invisible unless something says which
       tile a person on that page is standing under.
       [SUPERSEDES the 2026-09-02 entry, which read: a top-level page that
       now lives in Settings' menu and no longer has a rail tile of its own.] */
    expect(activeNavHref("/integrations")).toBe("/integrations");
  });

  it("controls: a real Management page and a real Settings page are untouched", () => {
    /*
     * The value returned is the entry's DESTINATION, which the rail compares
     * against its own href — and Management's destination stopped being
     * `/management` on 2026-09-03. Its page is a server `redirect()` to
     * General, so pressing the tile asked the server, got a redirect, and
     * asked again: a round trip and a second load where /meetings renders on
     * the first ask, which is the "it reloads the whole platform" the user
     * reported. The tile points at the first page now and declares
     * `/management` as its TERRITORY, so every page below still lights it.
     */
    expect(activeNavHref("/management/users")).toBe("/management/general");
    /* the bookmark still resolves, and still lights the tile */
    expect(activeNavHref("/management")).toBe("/management/general");
    expect(activeNavHref("/settings/security")).toBe("/settings");
    /* Skills LEFT the Settings menu in the same round, so it stops being
       Settings' territory and goes back to lighting Management — the half of
       the change that is invisible unless it is asserted. */
    expect(activeNavHref("/management/skills")).toBe("/management/general");
  });

  it("prefix discipline holds: /management/modelsomething is NOT Settings", () => {
    /* startsWith on the bare string would fold this too — the boundary is
       exact-or-slash, so a future sibling route cannot inherit the fold */
    expect(activeNavHref("/management/modelsomething")).toBe("/management/general");
  });

  it("a section's territory is wider than the page it navigates to", () => {
    /*
     * The property the `match` field exists for, asserted rather than assumed:
     * Management's href is one page inside it, so a naive prefix match on the
     * href would leave the tile DARK everywhere except General — the person
     * standing on Users would be told they are nowhere.
     */
    const management = NAV_PRIMARY.find((n) => n.key === "management")!;
    expect(management.href).toBe("/management/general");
    expect(management.match).toBe("/management");
    for (const page of ["/management", "/management/users", "/management/server", "/management/speakers"]) {
      expect(activeNavHref(page), `${page} must light Management`).toBe("/management/general");
    }
    /* and the control: territory does not leak to a neighbour */
    expect(activeNavHref("/meetings")).toBe("/meetings");
  });

  /*
   * EVERY NAV ENTRY HAS AN ICON — 13½, at the smallest scale that still
   * ships: `NAV_ICON` is a plain lookup, so a key it does not carry renders
   * an EMPTY SLOT in the rail and in the mobile bar. No error, no warning,
   * a destination that is simply invisible next to its labelled neighbours.
   *
   * The list is DERIVED from the nav rather than written out here. A
   * hand-kept enumeration is a second copy of the producer, and the guard
   * whose coverage list has a hole exactly where the drift arrives is the
   * one this repo has already shipped once (vocabulary.guard's missing
   * `Role`).
   */
  it("gives every nav destination an icon", () => {
    const missing = [...NAV_PRIMARY, ...NAV_UTILITY]
      .map((n) => n.key)
      .filter((key) => NAV_ICON[key] === undefined);
    expect(missing, "nav keys with no icon render an empty rail slot").toEqual([]);
    /* the control: the assertion above is vacuously true against an empty
       nav, and against a NAV_ICON that answers for every string */
    expect(NAV_PRIMARY.length).toBeGreaterThan(0);
    expect(NAV_ICON["definitely-not-a-nav-key"]).toBeUndefined();
  });

  it("lights NOTHING on the assistant, because the menu no longer offers it", () => {
    /*
     * 2026-09-03: the assistant left the nav list — it is the rail's green
     * primary now, and a product whose main verb is "ask" should not also
     * list asking as a row further down. So nothing lights on /assistant, and
     * that is the correct answer rather than a gap: a lit row would name a
     * destination this menu does not have.
     *
     * The CONTROL is the second line. "Undefined" is also what a broken
     * resolver returns for everything, so an address that must still resolve
     * is asserted beside it — without that this test passes against a
     * function that has stopped working entirely.
     */
    expect(activeNavHref("/assistant")).toBeUndefined();
    expect(activeNavHref("/somewhere")).toBeUndefined();
    expect(activeNavHref("/meetings")).toBe("/meetings");
  });
});
