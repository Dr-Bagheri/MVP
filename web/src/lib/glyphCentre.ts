/**
 * PUTTING A SINGLE LETTER IN THE MIDDLE OF A CIRCLE.
 *
 * User report, 2026-09-04: "what is wrong with the S in the circle — I added
 * this rule for the theme that for avatars the first syllable is in the centre
 * of the circle both vertically and horizontally, but it is just horizontally
 * centred."
 *
 * `place-items-center` centres the LINE BOX, and a line box is not a letter.
 * The baseline sits at `(ascent − descent) / 2` below the line box's centre —
 * always, whatever the line-height, because half-leading is symmetric — and
 * Vazirmatn's metrics are 103 up against 54 down. So the baseline lands a
 * quarter of an em low, and the ink lands wherever that glyph's own shape puts
 * it relative to the baseline. Nothing here is a bug in one place; it is the
 * difference between centring a box and centring what is drawn inside it.
 *
 * ── WHY THIS IS PER-GLYPH AND NOT A CONSTANT ──────────────────────────────
 *
 * Measured in the browser on the real font, at a 100px reference (Chrome,
 * Vazirmatn 600, 2026-09-04). The correction each glyph needs, in em:
 *
 *   Latin caps   A .110  S .110  M .110  I .110  W .110  O .110  J .105
 *                Q .050                          ← its tail crosses the baseline
 *   Persian      ک .105  ا .095  ط .095  د .010  ه .000
 *                ن −.130  ع −.150  ی −.165  ب −.170  س −.180  ج −.185  م −.215
 *
 * Latin is uniform enough to hardcode. PERSIAN IS NOT: it spans 0.32em, which
 * on the roster's 36px mark is about four pixels — larger than the error being
 * corrected. A "Latin nudge / Persian nudge" pair would read as a tidy design
 * token and would be wrong for most Persian names, which is the shape this
 * repo keeps calling a fix that reads as satisfied. The measurement is what
 * ruled it out; the plan before taking it was exactly that pair.
 *
 * So the offset is computed from the glyph's own ink, once per
 * (glyph, family, weight), and expressed as a RATIO of the font size — the
 * derivation above has no size term in it, so one measurement holds at every
 * size the avatar is drawn at.
 */

/** measured here, reported as a ratio — so the result is size-independent */
const REFERENCE_PX = 100;

/** the metrics this needs from a glyph, so the maths can be tested without a browser */
export interface GlyphInk {
  /** the FONT's box — the same for every glyph in the family */
  fontAscent: number;
  fontDescent: number;
  /** the GLYPH's own ink, from the baseline */
  inkAscent: number;
  inkDescent: number;
}

/**
 * How far DOWN to move the glyph, in em, so that its ink straddles the centre.
 *
 * y grows downward. With the line box centred on the circle, the baseline is
 * at `(A − D) / 2`, and the ink runs from `baseline − a` to `baseline + d`, so
 * its centre sits at `(A − D)/2 + (d − a)/2`. Moving by the negative of that
 * puts it on zero.
 */
export function inkOffsetEm(ink: GlyphInk, referencePx = REFERENCE_PX): number {
  const fontSpan = ink.fontAscent - ink.fontDescent;
  const inkSpan = ink.inkAscent - ink.inkDescent;
  return (inkSpan - fontSpan) / (2 * referencePx);
}

const cache = new Map<string, number>();

/**
 * The offset for one glyph in one font, measured in the browser and kept.
 *
 * Returns 0 where there is no canvas (the server, and jsdom) — which renders
 * exactly as this component did before, rather than guessing. It is also 0
 * until the font is loaded: a measurement taken against the fallback face
 * would be CACHED and wrong for the rest of the session, so an unloaded font
 * is a reason to return nothing and be asked again, not a reason to answer.
 */
export function glyphOffsetEm(glyph: string, family: string, weight: string): number {
  const key = `${glyph}|${family}|${weight}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  if (typeof document === "undefined") return 0;

  const spec = `${weight} ${REFERENCE_PX}px ${family}`;
  /* `fonts.check` is the guard against caching the fallback's metrics. It can
     throw on a font shorthand it cannot parse, and a thrown check is not a
     loaded font. */
  try {
    if (!document.fonts.check(spec)) return 0;
  } catch {
    return 0;
  }

  const context = document.createElement("canvas").getContext("2d");
  if (context === null) return 0;
  context.font = spec;
  const m = context.measureText(glyph);
  if (typeof m.actualBoundingBoxAscent !== "number") return 0;

  const offset = inkOffsetEm({
    fontAscent: m.fontBoundingBoxAscent,
    fontDescent: m.fontBoundingBoxDescent,
    inkAscent: m.actualBoundingBoxAscent,
    inkDescent: m.actualBoundingBoxDescent,
  });
  cache.set(key, offset);
  return offset;
}
