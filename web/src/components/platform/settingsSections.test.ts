import { describe, expect, it } from "vitest";
import { OFF_MENU_SLUGS, SETTINGS_SECTIONS, settingsSection } from "./settingsSections";

/**
 * A /settings address names ONE section or nothing (2026-09-06). The page used
 * to fall back to General for any slug off the menu — so /settings/legal, which
 * two comments promised "still resolves at its own address", opened General
 * under a legal address, and /settings/skills did the same under a page that
 * no longer exists. The resolver says which it is; the page sends `known:
 * false` home rather than drawing General under somebody else's name.
 */
describe("settingsSection — what a /settings address names", () => {
  it("a listed slug is itself, with its outside href when it has one", () => {
    expect(settingsSection("security")).toEqual({ slug: "security", known: true });
    expect(settingsSection("models")).toEqual({ slug: "models", href: "/management/models", known: true });
    expect(settingsSection(undefined)).toEqual({ slug: "general", known: true });
  });

  it("a slug the page serves OFF the menu still resolves to itself", () => {
    expect(OFF_MENU_SLUGS.length).toBeGreaterThan(0);
    for (const slug of OFF_MENU_SLUGS) {
      expect(SETTINGS_SECTIONS.some((s) => s.slug === slug), `${slug} is off the menu by design`).toBe(false);
      expect(settingsSection(slug)).toEqual({ slug, known: true });
    }
  });

  it("a slug nothing serves is NOT General wearing its address", () => {
    expect(settingsSection("skills")).toEqual({ slug: "general", known: false });
  });
});
