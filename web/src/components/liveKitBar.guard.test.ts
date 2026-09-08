import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE ROOM'S DEVICE PICKERS MUST WELD IN BOTH DIRECTIONS.
 *
 * User report, 2026-09-08: "the two dropdowns are on the wrong side, each must
 * go to the left in the fa version; in en they are correct."
 *
 * The meeting room's control bar is LiveKit's, and LiveKit joins each toggle
 * to its device menu by flattening the two corners where they meet — spelled
 * as PHYSICAL corners, which do not mirror. In Persian the group runs
 * right-to-left, so the flat edges land on the OUTSIDE: the pair comes apart
 * and the bar reads as six identical controls at even spacing, with no way to
 * tell which chevron belongs to which button.
 *
 * globals.css re-declares those corners LOGICALLY. This guard holds two facts
 * that a person reading either stylesheet cannot see:
 *
 *  1. our override is still there, still logical, and still names ALL FOUR
 *     corners on each side — the package's physical rule decides any corner
 *     left unsaid, and in RTL that is exactly the one that must not be flat;
 *  2. the package still needs overriding. If LiveKit ever spells its own weld
 *     logically, this block becomes an override of nothing, and an override
 *     nobody can tell is dead is how a stylesheet grows. The red says
 *     "re-check on upgrade", which is the honest thing to be told.
 *
 * What it cannot do is see the corner a browser computes — that was measured
 * in a static harness over the package's own stylesheet, both directions,
 * before and after (see the globals.css block's comment).
 */

const GLOBALS = join(process.cwd(), "src/app/globals.css");
const PACKAGE_CSS = join(
  process.cwd(),
  "node_modules/@livekit/components-styles/dist/general/components/controls/index.css",
);

/** the declaration block following a selector, comments stripped */
function block(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");
}

const LOGICAL = [
  "border-start-start-radius",
  "border-end-start-radius",
  "border-start-end-radius",
  "border-end-end-radius",
] as const;

const PHYSICAL = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
] as const;

describe("the room's control bar", () => {
  const css = readFileSync(GLOBALS, "utf8");

  for (const selector of [
    '[data-lk-theme="neurai"] .lk-button-group > .lk-button:first-child',
    '[data-lk-theme="neurai"] .lk-button-group-menu > .lk-button',
  ]) {
    it(`welds ${selector.includes("menu") ? "the chevron" : "the toggle"} by the reading direction`, () => {
      const body = block(css, selector);
      /* ALL FOUR, not the two being flattened: the package's physical rule
         still applies to a corner this block does not name, and in Persian
         that corner is the rounded one */
      for (const property of LOGICAL) expect(body).toContain(property);
      /* one flat side and one round one — a block that flattened all four
         would satisfy "logical" and draw a rectangle */
      expect(body.match(/:\s*0\s*;/g) ?? []).toHaveLength(2);
      expect(body.match(/var\(--lk-border-radius\)/g) ?? []).toHaveLength(2);
      for (const property of PHYSICAL) expect(body).not.toContain(property);
    });
  }

  it("still overrides a package that spells its own weld physically", () => {
    /* the reason the block above exists. A missing file is a red that names
       an upgrade rather than a defect — which is what somebody wants to be
       told the day the path moves. */
    expect(existsSync(PACKAGE_CSS), PACKAGE_CSS).toBe(true);
    const theirs = readFileSync(PACKAGE_CSS, "utf8");
    /* `includes` inside the assertion, never `toContain`: this file is one
       20KB line, and a failing `toContain` prints the whole of it */
    for (const fragment of [
      ".lk-button-group>.lk-button:first-child",
      "border-top-right-radius:0;border-bottom-right-radius:0",
      ".lk-button-group-menu>.lk-button",
      "border-top-left-radius:0;border-bottom-left-radius:0",
    ]) {
      expect(theirs.includes(fragment), `no longer in the package: ${fragment}`).toBe(true);
    }
  });
});
