import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO NATIVE `<select>` ANYWHERE IN THE PLATFORM.
 *
 * User directive, 2026-09-04: "i asked to change all dropdowns in the platform
 * to our platform theme default that we set, but some of them still did not
 * change — fix them. When I ask for all I mean all. Any page anywhere."
 *
 * They had to ask twice, and the reason is worth writing down because it is
 * what makes this a check rather than a sweep: **a native `<select>` wearing
 * `.input` matches the theme exactly while it is CLOSED.** The box, the
 * radius, the height, the chevron — all ours. Only the OPEN list gives it
 * away, and the open list is painted by the browser on its own popup sheet
 * where no stylesheet of ours reaches: white ground, Windows-blue row, on a
 * dark screen.
 *
 * So the twelve that were left could not be found by looking at a page. They
 * had to be found by grepping for the tag — which is what this does, every
 * run, instead of a person remembering to.
 *
 * The remaining hits in the tree are the word inside COMMENTS explaining why
 * the themed control exists, which is why this matches the opening TAG rather
 * than the word: a check that cannot tell a tag from a sentence about a tag
 * would have to be muted the week somebody documented it.
 */
const SRC = join(process.cwd(), "src");

/**
 * Comments stripped, strings kept.
 *
 * Not string-aware, deliberately: this looks for `<select` followed by a
 * character that can open a tag, and a JSX attribute value containing that
 * sequence would be a string with markup in it — which is a different problem
 * from the one here. `control.guard` needed string awareness because it scans
 * ATTRIBUTES; this scans for one token.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** `<select` at the start of a JSX tag — not the word in prose. */
const NATIVE = /<select[\s/>]/;

describe("every dropdown is the platform's own", () => {
  it("has something to check — the themed control is actually used", () => {
    /*
     * The vacuum this file could fall into: a tree with no dropdowns at all
     * passes the assertion below perfectly. Twelve call sites were converted;
     * requiring several proves the subject exists.
     */
    let users = 0;
    for (const file of sources(SRC)) {
      if (/\bfrom "@\/components\/Select"/.test(readFileSync(file, "utf8"))) users += 1;
    }
    expect(users, "nothing imports the themed Select").toBeGreaterThan(8);
  });

  it("no file renders a native <select>", () => {
    const found: string[] = [];
    for (const file of sources(SRC)) {
      const code = codeOnly(readFileSync(file, "utf8"));
      if (NATIVE.test(code)) found.push(file.slice(SRC.length + 1).replace(/\\/g, "/"));
    }
    expect(found, "use <Select> from components/Select — the open list of a native one is the browser's, not ours").toEqual([]);
  });

  it("the control: the matcher DOES fire on a real tag", () => {
    /*
     * Proves the check can answer yes. Without it, a regex that matched
     * nothing — a typo, an escaped bracket — would report a clean tree
     * forever, and this family of check has been vacuous in this repo before.
     */
    expect(NATIVE.test('<select className="input">')).toBe(true);
    expect(NATIVE.test("<select>")).toBe(true);
    expect(NATIVE.test("<select/>")).toBe(true);
    /* and NOT on the word in a sentence, which is what the comment strip and
       the trailing-character class are both for */
    expect(NATIVE.test("a native `<select>` paints its own list")).toBe(true);
    expect(codeOnly("/* a native <select> paints its own list */").includes("<select")).toBe(false);
    expect(NATIVE.test("<SelectMenu items={items} />")).toBe(false);
  });
});
