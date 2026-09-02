/**
 * NeurAI palette — every foreground/background PAIR asserted.
 *
 *   node design-system/neurai-platform/verify-pairs.mjs
 *
 * Why this file exists rather than a table in a document.
 *
 * The Echo audit found four contrast failures and every one of them was a
 * PAIRING, not a bad token: two individually-defensible values that had never
 * been checked against each other. A per-token review passes all four. So the
 * unit of checking has to be the pair, and a list of pairs in prose is a list
 * nobody re-runs.
 *
 * Two mistakes this encodes against, both of which were made for real while
 * deriving this palette:
 *
 *  1. **A token pair is not a rendered pair.** Chips are a 12% tint OF THE TEXT
 *     COLOUR ITSELF over the surface. Comparing the two hex values you just
 *     edited is the obvious check, needs no browser, and is wrong — it was off
 *     by 1.3 in one direction here and by 1.9 in the other, for the same chip.
 *     `over()` composites; use it for anything with alpha between the layers.
 *  2. **One border token cannot serve two jobs.** A hairline card edge is
 *     decorative (WCAG asks nothing of it); the edge of an INPUT is a control
 *     boundary and owes 3:1. Echo shipped one `--border` at 1.28:1 doing both.
 *     Hence `border` and `border-strong`.
 *
 * First run of this file failed FIVE pairs, including the dark accent chip at
 * 4.48 against a 4.5 bar — the same near-miss (4.42) that shipped in Echo.
 * That is the argument for the file.
 */

import { pathToFileURL } from "node:url";

const hx = (h) => { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const cr = (a, b) => {
  const l1 = lum(hx(a)), l2 = lum(hx(b));
  const [x, y] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};
/** Composite a translucent foreground over an opaque background. */
const over = (fg, bg, a) => {
  const F = hx(fg), B = hx(bg);
  return "#" + [0, 1, 2].map((i) => Math.round(F[i] * a + B[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
};

/** Chip fill alpha. One number, applied to every tone, verified for each. */
export const TINT = 0.12;

/**
 * NEUTRAL-BLACK revision (user directive, 2026-08-22): "use the sana.ai
 * theme for everything — dark mode black and lighter black." Sana's token
 * set is not open source (checked: their identity is Stockholm Design
 * Lab's, proprietary), so these are DERIVED from the reference shots:
 * true-black ground, near-black surfaces, neutral grays for text — all
 * chroma leaves the ground and lives only in the accent, which stays the
 * NeurAI violet (the brand's one color; a fully neutral accent would make
 * links, active states and the orb indistinguishable from prose). The
 * blue-violet palette this replaces is in git history if the direction
 * ever reverts.
 */
export const DARK = {
  /* ARAMEET ADOPTION (user directive, 2026-08-31: "i want our to get this
     theme so get all of it and correct ours"). The palette is the reference
     product's own dark tokens, read off its stylesheet in the running app —
     a deep blue-grey ground with a GREEN primary. Where a reference value
     failed this file's floors it was nudged to the nearest passing shade of
     the same family, and the nudge is commented at the value. The blue
     palette this replaces is in git history. */
  bg: "#0F1113",            // the ground
  surface: "#16191C",       // panels and cards sit ABOVE it
  surface2: "#272C32",      // raised: chips, hovered rows
  field: "#272C32",         // dark: the raised tone does the field's job too
  border: "#2B2E31",        // hairline (reference: white at 9% over surface)
  borderStrong: "#727982",  // control boundaries — clears 3:1
  fg: "#F2F4F6",
  fgMuted: "#C5CAD1",
  fgSubtle: "#8D949D",     // group labels — recedes toward the surface
  accent: "#0FA85D",        // the reference's green, its one brand hue
  onAccent: "#0B1408",      // the reference's own ink-on-green
  /* the primary CTA is the GREEN in this palette — the reference fills its
     one big button with the brand hue, and the neutral-pill rule retires
     with the palette that needed it */
  primary: "#0FA85D",
  onPrimary: "#0B1408",
  onDanger: "#000000",
  success: "#34D399", warning: "#FBBF24", danger: "#FB7185", info: "#5B9BE8",
  /* the RECORD red keeps its own token and its softened value — the
     reference records with a red dot too, and ours already passes */
  record: "#DB6060",
};

export const LIGHT = {
  /* the reference's light theme is its PRIMARY look: warm cream ground,
     white cards, the green as ink and fill */
  bg: "#F6F5F1",            // warm cream ground, cards pure white
  surface: "#FFFFFF",
  surface2: "#EDEAE3",      // raised: chips, hovered rows
  /* the FIELD's own ground (2026-09-02 measurement of the reference). An
     input given the chip's colour reads as a chip; given the card's, it has
     to be found by its border alone. It is a surface that carries typed
     text, so it owes the same floors every other surface owes. */
  field: "#FBFAF7",
  border: "#E1E0DB",        // hairline (reference: ink at 10% over cream)
  borderStrong: "#8F8B80",  // nudged from the reference's #9C988D: 3.4:1
  fg: "#1C1A16",
  fgMuted: "#47443D",
  fgSubtle: "#716D62",     // group labels — recedes toward the surface
  accent: "#01743F",        // the reference's #018146, nudged one step: its own 12% chip sat at 4.22
  onAccent: "#FFFFFF",
  primary: "#01743F",
  onPrimary: "#FFFFFF",
  onDanger: "#FFFFFF",
  /* status hues nudged darker than the reference (#0F9D6B / #CC8400 /
     #E23B54 measured 3.5, 3.1 and 4.2 against the floors) — same families,
     first passing shade */
  success: "#0B7A52", warning: "#8F5D08", danger: "#C9264A", info: "#1B4A8F",
  record: "#C54A4A",
};

/**
 * Run the checks only when invoked directly, so this file can also be imported
 * for its tokens (the hub mock builds from them, which is what stops the mock
 * drifting from the palette that was actually asserted).
 *
 * `pathToFileURL(process.argv[1]).href` and NOT a string compare against
 * `import.meta.url` — project rule 9's Windows trap: drive letters and slash
 * direction make the naive comparison silently false, so the guard would never
 * fire and this would look like a module that simply does nothing. Found here
 * the honest way: importing it exited the importer at `process.exit(0)`.
 */
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

export function verify() {
let failures = 0;
const check = (label, fg, bg, need = 4.5) => {
  const r = cr(fg, bg);
  const ok = r >= need;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${String(r).padStart(6)} (needs ${need})  ${label}`);
};

for (const [name, T] of [["DARK (primary)", DARK], ["LIGHT (derived)", LIGHT]]) {
  console.log(`\n=== ${name} ===`);
  check("fg on bg", T.fg, T.bg);
  check("fg on surface", T.fg, T.surface);
  check("fg-muted on bg", T.fgMuted, T.bg);
  check("fg-muted on surface", T.fgMuted, T.surface);
  check("fg-muted on surface-2", T.fgMuted, T.surface2);
  /* the field carries TYPED TEXT and a placeholder, and its edge is a
     control boundary — three floors, all of them owed */
  check("fg on the field (typed text)", T.fg, T.field);
  check("fg-subtle on the field (placeholder)", T.fgSubtle, T.field);
  check("border-strong vs field (control edge)", T.borderStrong, T.field, 3);
  check("accent as text on bg", T.accent, T.bg);
  check("accent as text on surface", T.accent, T.surface);
  check("ON-ACCENT on accent fill", T.onAccent, T.accent);
  check("ON-PRIMARY on primary fill (solid CTA)", T.onPrimary, T.primary);
  check("ON-DANGER on danger fill (solid danger button)", T.onDanger, T.danger);
  /* the record button's glyph is a white RING, not text — WCAG asks 3:1 of
     a graphic. Checked so the next "make it softer" cannot quietly cross
     the floor: the point of softening was intensity, never legibility. */
  check("white glyph on the record fill (graphic)", "#FFFFFF", T.record, 3);
  for (const k of ["success", "warning", "danger", "info"]) check(`${k} on surface`, T[k], T.surface);
  for (const k of ["success", "warning", "danger", "info", "accent"]) {
    check(`${k} on its ${TINT * 100}% chip (composited)`, T[k], over(T[k], T.surface, TINT));
  }
  check("fg-subtle on surface", T.fgSubtle, T.surface);
  /*
   * The token's PURPOSE, asserted — not just its accessibility.
   *
   * `--fg-subtle` labels groups in a menu; it exists to RECEDE so a group title
   * reads as a label rather than a destination. A user reported the Settings
   * sidebar as one flat menu precisely because titles and items shared
   * `--fg-muted`. If someone later "improves" this token's readability until it
   * matches the items again, the grouping silently dies and every contrast
   * check still passes — so the requirement is a *relationship*, and it is
   * checked as one.
   *
   * "Lighter in one theme, darker in the other" is one semantic, not two:
   * recede means move toward the surface, and the surface moves with the theme.
   */
  {
    const label = cr(T.fgSubtle, T.surface);
    const item = cr(T.fgMuted, T.surface);
    const recedes = label < item;
    if (!recedes) failures++;
    console.log(`  ${recedes ? "PASS" : "FAIL"} ${String(label).padStart(6)} (< ${item})  fg-subtle recedes behind fg-muted`);
  }
  check("border-strong vs surface (controls)", T.borderStrong, T.surface, 3);
  check("accent focus ring vs bg", T.accent, T.bg, 3);
  console.log(`  --- hairline border vs surface: ${cr(T.border, T.surface)} (decorative; 3:1 not required)`);
  console.log(`  --- accent-soft computes to ${over(T.accent, T.surface, TINT)}`);
}

console.log(`\n${failures === 0 ? "ALL PAIRS PASS" : `${failures} FAILING PAIR(S)`}`);
return failures;
}

if (isMain) process.exit(verify() === 0 ? 0 : 1);
