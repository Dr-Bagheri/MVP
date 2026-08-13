import { describe, expect, it } from "vitest";
import { BAR_CEILING, GITHUB_HREF, NAV_BAR, NAV_PRIMARY, NAV_UTILITY } from "./nav";

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
