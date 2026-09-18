import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUP_ORDER, OFF_MENU_SLUGS, SETTINGS_SECTIONS } from "./settingsSections";

/**
 * A SECTION IS LISTED ONCE.
 *
 * User report, 2026-09-19, with a screenshot: «زنگ‌ها» appeared TWICE in the
 * Settings menu, between «اعلان‌ها» and «امنیت».
 *
 * ── how it got there, because the how is the reusable part ────────────────
 *
 * The entry was added by a script that made several edits and threw on the
 * last one. The edits before the throw HAD ALREADY BEEN WRITTEN, so re-running
 * the script after fixing the failing anchor added the first edit a second
 * time. Nothing anywhere could see it: two identical entries render two
 * identical tabs, both of which work, and every typecheck, every test and the
 * production build passed.
 *
 * That is the whole reason this file exists rather than a careful edit. A menu
 * is a registry, a registry is a list, and a list that may not contain a value
 * twice should say so somewhere that runs.
 *
 * ── what each assertion is for ────────────────────────────────────────────
 *
 * The duplicate check is the report. The COMPLETENESS checks beside it are
 * the class: a slug listed twice, a slug that is both listed and declared
 * off-menu, and a group with no sections are three ways for one list to
 * disagree with itself, and only the first one had a user to notice it.
 */

describe("the settings section registry", () => {
  it("lists every section exactly once", () => {
    const slugs = SETTINGS_SECTIONS.map((s) => s.slug);
    const seen = new Set<string>();
    const twice = slugs.filter((slug) => (seen.has(slug) ? true : (seen.add(slug), false)));
    expect(twice, "a section listed twice renders two identical tabs, both of which work").toEqual([]);
  });

  it("does not both LIST a section and declare it off the menu", () => {
    /* `OFF_MENU_SLUGS` exists for pages the router serves and the menu does
       not offer. A slug in both lists is one of them being wrong, and which
       one is not knowable from here — so it is refused rather than resolved. */
    const listed = new Set(SETTINGS_SECTIONS.map((s) => s.slug));
    expect(OFF_MENU_SLUGS.filter((slug) => listed.has(slug))).toEqual([]);
  });

  it("gives every section a group that the menu actually renders", () => {
    // a section in a group nobody draws is a page with no door — the shape
    // rule 13½ watches for, one registry down
    const groups = new Set(GROUP_ORDER);
    expect(SETTINGS_SECTIONS.filter((s) => !groups.has(s.group)).map((s) => s.slug)).toEqual([]);
  });
});

describe("the management section registry", () => {
  /*
   * Read from the SOURCE rather than imported: `ManagementPane` is a client
   * component whose module pulls in next-intl and the whole icon set, and this
   * assertion is about a literal list. The regex is anchored on the two lines
   * that declare the groups, and the test below proves it found something —
   * a parse that matched nothing would satisfy "no duplicates" perfectly.
   */
  const source = readFileSync(join(process.cwd(), "src/components/platform/ManagementPane.tsx"), "utf8");
  const slugs = [...source.matchAll(/slugs:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1]!.matchAll(/"([a-z-]+)"/g)].map((s) => s[1]!));

  it("found the list at all — the control", () => {
    expect(slugs.length).toBeGreaterThan(3);
    expect(slugs).toContain("privileges");
  });

  it("lists every section exactly once", () => {
    const seen = new Set<string>();
    expect(slugs.filter((slug) => (seen.has(slug) ? true : (seen.add(slug), false)))).toEqual([]);
  });
});
