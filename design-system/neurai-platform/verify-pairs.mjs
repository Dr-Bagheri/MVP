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
  /* LIGHTER-GROUND revision (user directive, 2026-08-26: "make the dark
     theme of the whole platform a little lighter, like ChatGPT, and remove
     all purple"). True black went with it: a black ground makes every
     surface above it a step of grey nobody can tell apart, and the
     reference sits its content on a near-charcoal instead. The violet went
     too — the accent is now a BLUE, which is the one hue that reads as
     "interactive" without competing with success/warning/danger. */
  bg: "#171717",            // the ground
  surface: "#212121",       // panels and cards sit ABOVE it
  surface2: "#2C2C2C",      // raised: inputs, chips, hovered rows
  border: "#3A3A3A",        // hairline, decorative
  borderStrong: "#8A8A8A",  // control boundaries — clears 3:1
  fg: "#ECECEC",
  fgMuted: "#B4B4B4",
  fgSubtle: "#8F8F8F",     // group labels — recedes toward the surface
  accent: "#7EB6FF",        // the one hue left
  onAccent: "#000000",      // DARK on a bright accent: white fails here
  /* the primary CTA stays the NEUTRAL pair — a near-white pill, the
     reference's own send button; the accent is never a button fill */
  primary: "#FAFAFA",
  onPrimary: "#171717",
  /* ink on the danger FILL: dark's danger is a light rose, so black ink —
     the on-accent role-flip pattern */
  onDanger: "#000000",
  success: "#4ADE80", warning: "#FBBF24", danger: "#FB7185", info: "#7DD3FC",
  /* the RECORD button's own red (user report, 2026-08-26: "too intense in
     both modes"). Its own token, not a softened --danger: the danger tone
     marks destructive choices and has to stay loud. */
  record: "#DB6060",
};

export const LIGHT = {
  bg: "#F5F5F5",            // neutral near-white ground, cards pure white
  surface: "#FFFFFF",
  surface2: "#EDEDED",
  border: "#E2E2E2",
  borderStrong: "#767676",
  fg: "#171717",
  fgMuted: "#595959",
  fgSubtle: "#6E6E6E",     // group labels — recedes toward the surface
  /* the light theme's ink form of the same blue: the dark accent is a
     bright surface colour and fails on white, so this is the derived ink.
     One hue, two roles — the flip the whole palette is built on. */
  accent: "#1A66C9",
  onAccent: "#FFFFFF",
  primary: "#171717",       // the neutral CTA, mirrored to the light theme
  onPrimary: "#FFFFFF",
  onDanger: "#FFFFFF",      // light's danger is a deep red — white ink
  success: "#166534", warning: "#92400E", danger: "#BE123C", info: "#075985",
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
