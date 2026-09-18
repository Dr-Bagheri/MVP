import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCAFFOLD } from "./scaffold/constants";
import { TAB_TRACK } from "./platform/sectionTabs";

/**
 * THE TACTILE FAMILY IN INK (user, 2026-09-18, chosen from a nine-way canvas
 * of three button designs in three colourways each: "Ink · monochrome —
 * Tactile"). The choice is a set of facts about `globals.css` and the tokens
 * behind it, and this file holds them the way `surface.guard` holds `.tile`'s
 * corner: by READING THE RULE BODIES, because a coat is valid CSS in every
 * wrong version of itself and only the computed value disagrees.
 *
 * What is pinned: the corner (12, the panel's), the primary reading the INK
 * tokens rather than the accent, the bevel on every filled coat and its
 * ABSENCE on the ghost coats (a family that bevels everything is wrong in the
 * other direction), the press, the tokens in both themes at the values that
 * were chosen, and the accent staying green — the choice was for the buttons,
 * and a version that quietly turned the platform monochrome would pass every
 * other line here.
 */
const CSS = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const TAILWIND = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");

/** the body of `.name { … }` (no nested braces in the button rules) */
function rule(name: string): string {
  const m = new RegExp(`\\n\\s*\\.${name}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!m) throw new Error(`no rule .${name} in globals.css`);
  return m[1]!;
}
/** the flat declaration block of a theme selector */
function tokens(selector: string): string {
  const at = CSS.indexOf(`\n  ${selector} {`);
  if (at === -1) throw new Error(`no ${selector} block`);
  const end = CSS.indexOf("\n  }", at);
  return CSS.slice(at, end);
}
const has = (body: string, needle: string | RegExp) => (typeof needle === "string" ? body.includes(needle) : needle.test(body));

describe("the tactile button family in ink", () => {
  it("rounds at the panel's 12 — rounded-lg on .btn and .btn-sm, the 8px squares untouched", () => {
    expect(SCAFFOLD.radius.panel, "rounded-lg is no longer the 12 the family was chosen at").toBe(12);
    expect(SCAFFOLD.radius.control < SCAFFOLD.radius.panel && SCAFFOLD.radius.panel < SCAFFOLD.radius.tile).toBe(true);
    expect(rule("btn")).toMatch(/\brounded-lg\b/);
    expect(rule("btn"), "the 16 corner is back").not.toMatch(/\brounded-xl\b/);
    expect(rule("btn-sm")).toMatch(/\brounded-lg\b/);
    for (const n of ["btn-xs", "btn-icon", "btn-icon-sm"]) expect(rule(n), `${n} lost its 8px corner`).toContain("rounded-[8px]");
  });

  it("the primary reads the INK tokens, not the accent, and wears the recipe", () => {
    const p = rule("btn-primary");
    expect(p).toContain("text-on-btn");
    expect(p).toMatch(/linear-gradient\([^)]*var\(--btn\)/);
    expect(p, "the lit top edge").toMatch(/box-shadow:[^;]*inset 0 1px 0/);
    expect(p, "the press").toContain("active:translate-y-px");
    expect(p).toMatch(/active:shadow-\[inset/);
    for (const stale of ["bg-primary", "bg-accent", "text-on-primary", "text-on-accent", "hover:opacity"]) {
      expect(p, `the primary still says ${stale}`).not.toContain(stale);
    }
  });

  it("the filled coats carry the lip and the press; the ghost coats stay flat", () => {
    for (const n of ["btn-secondary", "btn-danger"]) {
      const b = rule(n);
      expect(b, `${n} has no lip`).toMatch(/box-shadow:[^;]*inset 0 1px 0/);
      expect(b, `${n} has no gradient`).toContain("linear-gradient(");
      expect(b, `${n} does not press`).toContain("active:translate-y-px");
    }
    const soft = rule("btn-soft");
    expect(soft).toContain("bg-btn-soft");
    expect(soft, "the soft coat lost its lip").toMatch(/box-shadow:[^;]*inset 0 1px 0/);
    expect(soft, "the soft coat is not flatter than the secondary").not.toContain("linear-gradient(");
    /* the control: a version that bevels EVERYTHING passes the lines above */
    for (const n of ["btn-ghost", "btn-ghost-danger"]) {
      const b = rule(n);
      expect(b, `${n} grew a lip`).not.toMatch(/inset 0 1px 0/);
      expect(b, `${n} grew a gradient`).not.toContain("linear-gradient(");
      expect(b, `${n} grew a border`).not.toMatch(/\bborder\b/);
    }
  });

  it("both themes declare the ink tokens at the chosen values, and the accent is MONOCHROME", () => {
    const dark = tokens(":root");
    const light = tokens('[data-theme="light"]');
    for (const t of ["--btn:", "--on-btn:", "--btn-soft:", "--btn-lip:", "--btn-hover:", "--btn-hover-2:"]) {
      expect(dark, `dark lacks ${t}`).toContain(t);
      expect(light, `light lacks ${t}`).toContain(t);
    }
    /* the choice itself: #E6E9EC on #101316 in dark, #1C1A16 on #FFFFFF in light */
    expect(dark).toMatch(/--btn:\s*230 233 236/);
    expect(dark).toMatch(/--on-btn:\s*16 19 22/);
    expect(light).toMatch(/--btn:\s*28 26 22/);
    expect(light).toMatch(/--on-btn:\s*255 255 255/);
    /*
     * REVERSED 2026-09-18, later the same day, and the reversal is the point.
     *
     * This line asserted that the buttons went ink and THE PLATFORM DID NOT —
     * the scope of a choice made on a button canvas, where turning the whole
     * product monochrome by accident would have passed every other check in
     * this file. Hours later the user asked for exactly that on purpose
     * ("all green that are in the platform to a theme black and white"), so
     * the assertion flips rather than being deleted: what it protects is
     * still "the accent is whatever was DECIDED, not whatever a button
     * happens to be", and the decision changed.
     *
     * Asserted as an absence too. A version that leaves one theme green
     * satisfies "the other one is white", and a half-monochrome platform is
     * the state this is likeliest to be left in.
     */
    expect(dark).toMatch(/--accent:\s*255 255 255/);
    expect(light).toMatch(/--accent:\s*28 26 22/);
    for (const [name, css] of [["dark", dark], ["light", light]] as const) {
      expect(css, `${name} still carries the brand green`).not.toMatch(/15 168 93|1 116 63/);
    }
  });

  it("tailwind registers the three button colours the coats apply", () => {
    for (const k of ["btn:", '"on-btn":', '"btn-soft":']) expect(TAILWIND, `tailwind.config lacks ${k}`).toContain(k);
    expect(has(TAILWIND, "rgb(var(--btn) / <alpha-value>)")).toBe(true);
  });
});

/**
 * ONE STEP DOWN (user, 2026-09-18, an hour after the family shipped: "make
 * all button one size smaller"). The scale is the tokens — 34 / 28 / 24,
 * where it had been 42 / 34 / 28 — so a class that spelled its own height
 * would be the drift; the padding and the small type follow one step each;
 * and the segmented track's padding is a RELATIONSHIP with the pill: a 24
 * pill in a 2px track is 28, the compact control's own height, so a
 * `btn-sm` beside the track stands level with it. That sum is what would go
 * silently wrong the next time either number moved alone.
 */
describe("the family one step down", () => {
  it("the three heights are 34 / 28 / 24 at the tokens", () => {
    expect(SCAFFOLD.controlHeight).toBe(34);
    expect(SCAFFOLD.controlHeightSm).toBe(28);
    expect(SCAFFOLD.controlHeightIcon).toBe(24);
    for (const n of ["btn", "btn-sm", "btn-xs", "btn-icon", "btn-icon-sm", "btn-icon-lg"]) {
      expect(rule(n), `${n} spells a height of its own`).not.toMatch(/\b(?:min-)?h-\[\d/);
    }
  });

  it("the padding and the small type followed one step each", () => {
    expect(rule("btn")).toContain("px-[13px]");
    expect(rule("btn")).toMatch(/\btext-detail\b/);
    expect(rule("btn-sm")).toMatch(/\bpx-2\.5\b/);
    expect(rule("btn-sm")).toMatch(/\btext-caption\b/);
    expect(rule("btn-sm"), "the 12.5 text is back on the compact button").not.toContain("0.78125rem");
    expect(rule("btn-xs")).toMatch(/\bpx-2\b(?!\.)/);
  });

  it("the segmented track's padding keeps the pill level with a btn-sm", () => {
    const m = /\bp-\[(\d+)px\]/.exec(TAB_TRACK);
    expect(m, "the track has no px padding to reason about").not.toBeNull();
    const pad = Number(m![1]);
    expect(SCAFFOLD.controlHeightIcon + 2 * pad, "pill + track is not the compact control's height").toBe(SCAFFOLD.controlHeightSm);
  });
});
