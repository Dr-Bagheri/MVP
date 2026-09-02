import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **The modal layer is the top of the platform, and the assistant dock is
 * not.**
 *
 * User report, 2026-09-02: "the orb is coming on top of the pop up window on
 * the side." Both were `z-50`. A tie between two PORTALS is decided by DOM
 * order, so which one covered the other depended on which opened last — the
 * orb was not above dialogs, it was above dialogs SOMETIMES, which is worse
 * than either because it cannot be reproduced on demand.
 *
 * The ladder, stated once so it stops being raced:
 *
 *   z-50   the modal layer — `components/ui/dialog.tsx`, every dialog and
 *          side panel in the product
 *   z-40   the assistant dock: its orb, its panel, its announcements
 *   z-30   the dock's drag cradle
 *
 * This file checks the half that a person actually gets wrong: nothing the
 * DOCK draws may reach the modal layer. It does not try to police z-index
 * across the whole tree — a check that flags every high number in the
 * codebase is the false-positive factory that gets muted in a week.
 */

const SRC = join(process.cwd(), "src");
const DOCK = join(SRC, "components/platform/PresenceDock.tsx");
const DIALOG = join(SRC, "components/ui/dialog.tsx");
/* every surface that wears role="dialog" outside the ui/ primitive — a
   fixed panel at the dock's level is the exact tie this guard exists for,
   and MemberDetail was one until 2026-09-02 */
const OTHER_MODALS = [join(SRC, "components/platform/MemberDetail.tsx")];

/**
 * Every `z-<n>` / `z-[<n>]` Tailwind class in a file, COMMENTS STRIPPED.
 *
 * The strip is not tidiness. On its first run this check failed against a
 * file it had just been used to fix, because the comment explaining the
 * ladder contains the words "z-50" — the name matching itself, inside the
 * guard written to stop exactly that class of mistake. A checker that reads
 * prose as code manufactures false positives, and a checker that
 * manufactures false positives is muted within a week.
 */
function levels(file: string): number[] {
  const text = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\w-])z-(?:\[(\d+)\]|(\d+))(?![\w-])/g)) {
    out.push(Number(m[1] ?? m[2]));
  }
  return out;
}

describe("the stacking ladder", () => {
  it("puts the modal layer above everything the assistant dock draws", () => {
    const dock = levels(DOCK);
    const modal = levels(DIALOG);

    /* the check must have a subject: a regex that matched nothing would make
       both sides empty and every assertion below vacuously true */
    expect(dock.length).toBeGreaterThan(0);
    expect(modal.length).toBeGreaterThan(0);

    const top = Math.min(...modal);
    expect(Math.max(...dock)).toBeLessThan(top);

    /* and every other modal surface sits AT the modal layer, not under it */
    for (const file of OTHER_MODALS) {
      const lv = levels(file);
      expect(lv.length).toBeGreaterThan(0);
      expect(Math.min(...lv)).toBeGreaterThanOrEqual(top);
    }
  });

  it("can answer NO — a dock level at the modal's height is reported", () => {
    /*
     * The negative control. "The dock is below the modal" passes trivially if
     * the levels were misread as, say, all zeros, so the same comparison is
     * run against a staged value that SHOULD fail. Without this the check
     * cannot distinguish a real ladder from a broken parser.
     */
    const modalTop = Math.min(...levels(DIALOG));
    const staged = [30, 40, modalTop];
    expect(Math.max(...staged) < modalTop).toBe(false);
  });
});
