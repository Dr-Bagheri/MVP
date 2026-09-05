import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BODY_HEADING, BODY_TEXT, FIELD_LABEL, RAIL_LABEL, RAIL_VALUE, RAIL_EMPTY,
  FOOTER_CANCEL, FOOTER_PRIMARY, TAB_BAR, chipClass, tabClass,
} from "./panelStyle";
import { SCAFFOLD } from "@/components/scaffold/constants";

/**
 * THE MEASURED PANEL, held to its measurements — and, since R4, to the family.
 *
 * The type numbers were read off `panel.arameet.ir` on 2026-09-05 at 1920×911,
 * signed in. The CONTROL numbers were read there too, and the first version of
 * this file asserted them as strings — `h-[34px]` on the chips, `h-[32px]` on
 * the tabs — while production rendered both at 42, because `.btn`'s own
 * min-height beats a smaller height written beside it. A test that reads the
 * class string cannot see that; it was green the whole time.
 *
 * So the control half of this file asserts a SHAPE that cannot be defeated
 * that way: every control wears one of the family's three sizes and writes no
 * height of its own. That is checkable from the string because the failure
 * mode is the presence of a height, not its value.
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
     * The check that keeps the others honest: the three panels must READ
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
     */
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    for (const file of [
      "./TaskDialogs.tsx", "./TaskDetail.tsx", "../ProjectDetail.tsx",
    ]) {
      expect(src(file)).toContain("panelStyle");
    }
  });
});

describe("the panel's controls wear the family (R4, 2026-09-05)", () => {
  const CONTROLS = {
    chipOn: chipClass(true),
    chipOff: chipClass(false),
    tabOn: tabClass(true),
    tabOff: tabClass(false),
    footerCancel: FOOTER_CANCEL,
    footerPrimary: FOOTER_PRIMARY,
  };
  /* a fixed height, a min-height override, an arbitrary corner or an arbitrary
     text size — each is the reference's number written where the family's
     belongs, and each is what rendered wrong */
  const HAND_SIZE = /(?<![\w-])(?:min-h-|h-(?:\d|\[|auto)|rounded-\[|text-\[)/;

  it("every control is a family member and writes no size of its own", () => {
    for (const [name, cls] of Object.entries(CONTROLS)) {
      expect(cls, `${name} must wear the family`).toMatch(/\bbtn(?:-\w+)?\b/);
      expect(cls, `${name} must not size itself`).not.toMatch(HAND_SIZE);
    }
  });

  it("the compact ones are compact and the footer is regular", () => {
    /* chips and tabs are the 34 size; the footer's two
       buttons are the 38 — the same split the toolbar makes between its chips
       and its primary action */
    for (const name of ["chipOn", "chipOff", "tabOn", "tabOff"] as const) {
      expect(CONTROLS[name], `${name} is compact`).toMatch(/\bbtn-sm\b/);
    }
    expect(FOOTER_CANCEL).not.toMatch(/\bbtn-sm\b/);
    expect(FOOTER_PRIMARY).not.toMatch(/\bbtn-sm\b/);
    expect(FOOTER_PRIMARY).toMatch(/\bbtn-primary\b/);
  });

  it("tells a chip's two states apart by ground and edge, never by size", () => {
    /* the load-bearing one: if the selected chip changed size, the row would
       reflow every time somebody picked a different column */
    const on = chipClass(true), off = chipClass(false);
    expect(on).toContain("bg-accent-soft");
    expect(off).not.toContain("bg-accent-soft");
    const sizeWords = (c: string) => c.split(/\s+/).filter((w) => /^btn/.test(w)).sort().join(" ");
    expect(sizeWords(on)).toBe(sizeWords(off));
  });

  it("the tab bar is the tabs plus their padding, not a number", () => {
    /*
     * The reference's bar is 42 because its tabs are 34 with 4px around them.
     * Written as `h-[42px]` the bar stopped tracking the tabs the moment they
     * grew with the root (37 at 1920), and the tabs — which had lost their own
     * height to `.btn`'s minimum — filled it edge to edge. A bar with no
     * height of its own cannot disagree with what it holds.
     */
    expect(TAB_BAR).toContain("p-1");
    expect(TAB_BAR).not.toMatch(/(?<![\w-])h-/);
    /* and its corner is the control token, not a hand-typed 11 */
    expect(TAB_BAR).toContain("rounded-md");
    expect(TAB_BAR).not.toMatch(/rounded-\[/);
  });
});
