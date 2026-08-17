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
 * BLUE-VIOLET revision (user directive, 2026-08-17): "blueish purple —
 * still more purple than blue — and light mode super light blue." Hues
 * shift from ~262° toward ~248°; the violet stays dominant in the accent.
 * The previous measured-brand palette is in git history if the direction
 * ever reverts.
 */
export const DARK = {
  // GROUND MATCHES THE WEBSITE (user directive, 2026-08-17 round 2): the
  // marketing site sits on #0A0930 and the app now shares it — one product,
  // one night sky. Surfaces re-stepped from the deeper base.
  bg: "#0A0930",
  surface: "#14114C",
  surface2: "#1E1B60",
  border: "#302D76",        // hairline, decorative
  borderStrong: "#7A76D4",  // control boundaries — clears 3:1
  fg: "#EDEEFF",
  fgMuted: "#B0B0E0",
  fgSubtle: "#8F8FCC",     // group labels — recedes toward the surface
  accent: "#9B85FF",        // violet with the blue lean — purple stays in charge
  onAccent: "#0A0930",      // DARK on violet: white fails here, as before
  success: "#4ADE80", warning: "#FBBF24", danger: "#FB7185", info: "#7DD3FC",
};

export const LIGHT = {
  bg: "#EEF4FF",            // the "super light blue" ground
  surface: "#FFFFFF",
  surface2: "#E3EDFD",
  border: "#CFDEF6",
  borderStrong: "#7B85C8",
  fg: "#121A40",
  fgMuted: "#4A5384",
  fgSubtle: "#656FA0",     // group labels — recedes toward the surface
  accent: "#5747E6",        // DERIVED blue-violet ink; fills stay the brand's
  onAccent: "#FFFFFF",
  success: "#166534", warning: "#92400E", danger: "#BE123C", info: "#075985",
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
