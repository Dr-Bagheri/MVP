import { describe, expect, it } from "vitest";
import { inkOffsetEm } from "./glyphCentre";

/**
 * CENTRING A LETTER, not its line box.
 *
 * The metrics below were measured in Chrome on the product's own font
 * (Vazirmatn 600, at a 100px reference, 2026-09-04) — they are a recording of
 * the real face, not numbers invented to make the arithmetic come out. The
 * font's box is 103 up against 54 down, which is why the baseline sits low
 * inside a centred line box and why nothing that centres a BOX can fix this.
 */
const FONT = { fontAscent: 103, fontDescent: 54 };

/** what the browser reported for each glyph's own ink */
const INK = {
  S: { inkAscent: 72, inkDescent: 1 },
  A: { inkAscent: 71, inkDescent: 0 },
  Q: { inkAscent: 72, inkDescent: 13 },
  seen: { inkAscent: 38, inkDescent: 25 },   // س
  meem: { inkAscent: 38, inkDescent: 32 },   // م
  kaf: { inkAscent: 70, inkDescent: 0 },     // ک
  he: { inkAscent: 49, inkDescent: 0 },      // ه
};

const em = (k: keyof typeof INK): number =>
  Number(inkOffsetEm({ ...FONT, ...INK[k] }).toFixed(3));

describe("the offset that centres a glyph's ink", () => {
  it("moves a Latin capital DOWN — it renders high", () => {
    /* positive = down. Measured residual before the fix: 1.5px high on the
       36px mark, and the same 1.5px on the 20px one, where it is 7% of the
       circle. */
    expect(em("S")).toBeGreaterThan(0);
    expect(em("S")).toBeCloseTo(0.11, 2);
    expect(em("A")).toBeCloseTo(0.11, 2);
  });

  it("moves most Persian letters UP — they render low", () => {
    expect(em("seen")).toBeLessThan(0);
    expect(em("meem")).toBeLessThan(0);
    expect(em("seen")).toBeCloseTo(-0.18, 2);
  });

  it("THE REASON THIS IS PER-GLYPH: Persian does not agree with itself", () => {
    /*
     * The check that ruled out the tidy version of this fix. A "Latin nudge,
     * Persian nudge" pair reads as a design token and is wrong for most
     * Persian names: «ک» wants +0.105 and «م» wants −0.215, so one constant is
     * off by a third of an em — about four pixels on the roster's mark, which
     * is larger than the error being corrected. If this assertion ever goes
     * green with a narrow spread, a constant would have been fine and this
     * file is over-built; while it is this wide, it is not.
     */
    const persian = [em("seen"), em("meem"), em("kaf"), em("he")];
    const spread = Math.max(...persian) - Math.min(...persian);
    expect(spread).toBeGreaterThan(0.25);
  });

  it("a descender pulls the correction back", () => {
    /* Q's tail crosses the baseline, so it is already lower than S and needs
       less moving — the direct evidence that the glyph's OWN ink is what this
       reads, rather than a per-script rule */
    expect(em("Q")).toBeLessThan(em("S"));
  });

  it("a glyph whose ink already straddles the font's box needs nothing", () => {
    /* the control: without it, a function that returned a constant of the
       right sign would pass every test above */
    expect(inkOffsetEm({ fontAscent: 100, fontDescent: 50, inkAscent: 100, inkDescent: 50 }))
      .toBe(0);
  });

  it("is a ratio, so one measurement holds at every size", () => {
    /* the derivation has no size term; measuring at 50 instead of 100 with
       halved metrics must give the same em */
    const half = inkOffsetEm(
      { fontAscent: 51.5, fontDescent: 27, inkAscent: 36, inkDescent: 0.5 },
      50,
    );
    expect(Number(half.toFixed(3))).toBe(em("S"));
  });
});
