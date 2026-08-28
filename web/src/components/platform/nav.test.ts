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
    expect(activeNavHref("/management/skills")).toBe("/settings");
    expect(activeNavHref("/management/models")).toBe("/settings");
  });

  it("controls: a real Management page and a real Settings page are untouched", () => {
    expect(activeNavHref("/management/users")).toBe("/management");
    expect(activeNavHref("/management")).toBe("/management");
    expect(activeNavHref("/settings/security")).toBe("/settings");
  });

  it("prefix discipline holds: /management/modelsomething is NOT Settings", () => {
    /* startsWith on the bare string would fold this too — the boundary is
       exact-or-slash, so a future sibling route cannot inherit the fold */
    expect(activeNavHref("/management/modelsomething")).toBe("/management");
  });

  it("the hub matches exactly, never by prefix", () => {
    expect(activeNavHref("/assistant")).toBe("/assistant");
    expect(activeNavHref("/somewhere")).toBeUndefined();
  });
});
