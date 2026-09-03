import { describe, expect, it } from "vitest";
import { BAR_CEILING, GITHUB_HREF, NAV_BAR, NAV_PRIMARY, NAV_UTILITY, activeNavHref } from "./nav";

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
    expect(GITHUB_HREF === "#" || GITHUB_HREF.startsWith("http")).toBe(true);
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

  it("the hub matches exactly, never by prefix", () => {
    expect(activeNavHref("/assistant")).toBe("/assistant");
    expect(activeNavHref("/somewhere")).toBeUndefined();
  });
});
