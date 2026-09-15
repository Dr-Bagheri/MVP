import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **A SUB-MENU HAS ONE SPELLING** (user ruling, 2026-09-15: "in all pages it
 * must follow the same design for each … I want them to look like the meeting
 * top menu, so change them all in other pages").
 *
 * The design lives in `platform/sectionTabs.tsx` — two tracks, one pill — and
 * this guard is what turns the ruling into a fact rather than a thing to
 * check mid-task: a page cannot draw a tab the kit did not spell.
 *
 *  1. Every file that renders a `role="tab"` imports the kit (or the panel
 *     module that re-exports it), so its pills can only be the kit's.
 *  2. The retired recipes may not return anywhere: the filled accent tab
 *     (`bg-accent text-on-accent` on a compact control) and the recessed rail
 *     spelled by hand (`rounded-xl bg-surface-2 p-1`).
 *  3. The control: the kit itself still says the rail, so a kit that quietly
 *     dropped it would not pass by making the tree empty of it.
 *
 * Substring traps, both defended: `role="tab"` is matched as the attribute
 * and not inside `role="tablist"` (a tablist is the rail, not a pill), and the
 * retired-recipe check strips comments first — TaskBoard's note about the
 * board's floor once counted as a copy of the floor.
 */
const SRC = join(process.cwd(), "src");
const KIT = "components/platform/sectionTabs.tsx";
const PANEL = "components/platform/tasks/panelStyle.ts";

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}
const rel = (full: string) => full.slice(SRC.length + 1).replace(/\\/g, "/");
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("toolbar.guard — every tab is the kit's", () => {
  it("a file that renders a tab imports the kit", () => {
    const offenders: string[] = [];
    let tabbed = 0;
    for (const file of sources(SRC)) {
      const r = rel(file);
      if (r === KIT || r === PANEL) continue;
      const text = code(readFileSync(file, "utf8"));
      if (!/role="tab"/.test(text)) continue;
      tabbed += 1;
      const imports = /from "(?:\.\.?\/)*(?:[\w./]*\/)?(?:sectionTabs|panelStyle)"|from "@\/components\/platform\/(?:sectionTabs|tasks\/panelStyle)"/.test(text);
      if (!imports) offenders.push(r);
    }
    expect(tabbed, "the scan found no tabs at all").toBeGreaterThan(4);
    expect(offenders, "these draw a tab without the kit — its pill is whatever they wrote").toEqual([]);
  });

  it("the retired recipes do not come back", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const r = rel(file);
      if (r === KIT) continue;
      const text = code(readFileSync(file, "utf8"));
      if (/rounded-xl bg-surface-2 p-1(?![\w-])/.test(text)) offenders.push(`${r}: the rail spelled by hand`);
      /* the retired pill, by its EXACT pair — a filled compact button is a
         legitimate primary action (a send key, a live toggle), and only the
         pair this kit replaced is the sub-menu wearing the old coat */
      if (/"bg-accent text-on-accent"\s*:\s*"text-fg-muted hover:bg-surface-2 hover:text-fg"/.test(text) ||
          /role="tab"[\s\S]{0,400}?bg-accent text-on-accent/.test(text)) {
        offenders.push(`${r}: the filled accent tab`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the control: the kit still spells the rail and the pill", () => {
    const kit = readFileSync(join(SRC, KIT), "utf8");
    expect(kit).toContain("rounded-xl bg-surface-2 p-1");
    expect(kit).toContain("rounded-xl bg-accent-soft p-1");
    expect(kit).toContain("shadow-card");
  });
});
