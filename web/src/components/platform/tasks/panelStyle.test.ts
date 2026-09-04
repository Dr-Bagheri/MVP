import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BODY_HEADING, BODY_TEXT, FIELD_LABEL, RAIL_LABEL, RAIL_VALUE, RAIL_EMPTY,
  PANEL_INPUT, PANEL_TEXTAREA, TAB_BAR, TOP_BUTTON, chipClass, tabClass,
} from "./panelStyle";
import { SCAFFOLD } from "@/components/scaffold/constants";

/**
 * THE MEASURED PANEL, held to its measurements.
 *
 * Every number here was read off `panel.arameet.ir` on 2026-09-05 at
 * 1920×911, signed in — the new-task dialog and `?task=836`. The point of
 * this file is not that the values are pretty; it is that they were MEASURED
 * and that the next person to "tidy" one has to change a test that says so.
 *
 * The three surfaces share the constants, so what this guards is drift
 * between the constant and the reference — not between the three, which the
 * shared module already makes impossible.
 */
describe("the reference's measurements", () => {
  it("keeps the type scale the reference actually uses", () => {
    /* the four sizes that carry the panels, in the order they nest:
       body heading 11.5 · rail label 11 · rail value 12.5 · body text 12.5 */
    expect(FIELD_LABEL).toContain("text-[11.5px]");
    expect(RAIL_LABEL).toContain("text-[11px]");
    expect(RAIL_VALUE).toContain("text-[12.5px]");
    expect(BODY_TEXT).toContain("text-[12.5px]");
    /* and the WEIGHTS, which are what separate a section from a field: the
       body heading is 700 and the field label is 600, measured */
    expect(BODY_HEADING).toContain("font-bold");
    expect(FIELD_LABEL).toContain("font-semibold");
  });

  it("gives an empty rail value the same size as a full one", () => {
    /*
     * The reference recedes an empty value by COLOUR only. A smaller or
     * lighter-weight empty state would make the rail's rows change height as
     * a task is filled in, which is the kind of movement nobody reports and
     * everybody feels.
     */
    const size = (c: string) => c.match(/text-\[[\d.]+px\]/)?.[0];
    const weight = (c: string) => c.match(/font-\w+/)?.[0];
    expect(size(RAIL_EMPTY)).toBe(size(RAIL_VALUE));
    expect(weight(RAIL_EMPTY)).toBe(weight(RAIL_VALUE));
    expect(RAIL_EMPTY).not.toBe(RAIL_VALUE);
  });

  it("keeps the measured control heights", () => {
    expect(PANEL_INPUT).toContain("h-[45px]");
    expect(PANEL_TEXTAREA).toContain("min-h-[73px]");
    expect(chipClass(false)).toContain("h-[34px]");
    expect(TAB_BAR).toContain("h-[42px]");
    expect(tabClass(false)).toContain("h-[32px]");
    expect(TOP_BUTTON).toContain("h-[30px]");
  });

  it("gives the closed choices their own 9px corner, and the tabs 8", () => {
    /* three corners, measured, and none of them our control radius: the
       reference rounds a segment at 9, a tab at 8 and a field at 11 */
    expect(chipClass(true)).toContain("rounded-[9px]");
    expect(tabClass(true)).toContain("rounded-[8px]");
    expect(TAB_BAR).toContain("rounded-[11px]");
  });

  it("tells a chip's two states apart by ground and edge, never by size", () => {
    /* the load-bearing one: if the selected chip changed size, the row would
       reflow every time somebody picked a different column */
    const on = chipClass(true), off = chipClass(false);
    expect(on).toContain("h-[34px]");
    expect(off).toContain("h-[34px]");
    expect(on).toContain("bg-accent-soft");
    expect(off).not.toContain("bg-accent-soft");
  });

  it("rounds panels at the MEASURED 18, from the token and not by hand", () => {
    /*
     * The reference's dialog and its detail modal both round at 18; this
     * token said 20. It is asserted here because it is the one number in the
     * set that is global — every dialog in the product wears it — and a
     * per-file radius is how a product ends up with four of them.
     */
    expect(SCAFFOLD.radius.modal).toBe(18);
  });

  it("is read by all three surfaces", () => {
    /*
     * The check that keeps the other six honest: the three panels must READ
     * these constants rather than each carrying its own copy, which is how
     * the dialog and the detail came to disagree in the first place.
     *
     * IT USED TO ASSERT MORE AND WAS WRONG FOR IT. A second half forbade the
     * string `text-[11px] text-fg-muted` anywhere in the three files, on the
     * theory that a rail label re-typed by hand would look like that — and it
     * fired on three innocent lines: two count badges and an explanatory
     * paragraph, all of which are legitimately 11px muted text. A substring
     * cannot tell a rail label from a badge, and this repo has already
     * deleted one checker for manufacturing false positives, because
     * fails-when-it-shouldn't is the failure that gets an instrument muted.
     * So the imprecise half is gone rather than tuned; what remains is a fact
     * a grep can actually establish.
     */
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    for (const file of [
      "./TaskDialogs.tsx", "./TaskDetail.tsx", "../ProjectDetail.tsx",
    ]) {
      expect(src(file)).toContain("panelStyle");
    }
  });
});
