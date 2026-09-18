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
/**
 * CIE L* — perceptual lightness, 0..100.
 *
 * This file's other metric is the WCAG contrast RATIO, and the ratio is the
 * wrong instrument for two adjacent near-black surfaces: the page and the
 * panel sat at 1.28:1 both before and after a change that made them visibly
 * different, because the ratio's denominator is tiny down there and every
 * step reads as "about 1.3". L* does not have that problem — a step of ~4 is
 * where two dark surfaces stop looking like one, at either end of the scale.
 */
const Lstar = (h) => {
  const Y = lum(hx(h));
  return Math.round((Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y) * 10) / 10;
};

/**
 * Chip fill alpha. One number, applied to every tone, verified for each.
 *
 * 0.12 -> 0.10 (2026-09-08). A chip is its own text colour tinted over the
 * SURFACE, so raising the dark panel raised every chip with it and the dark
 * accent chip landed at 4.51 against a 4.5 bar. That is a pass, and it is
 * also the exact figure in this file's own header — the 4.48 near-miss it
 * was written to catch, one hundredth the other side of the line. A margin
 * of 0.01 is not a margin; the tint moved instead, which lifts every tone in
 * both themes at once (worst pair 4.51 -> 4.61) rather than nudging one hue
 * until the number it is measured by stops complaining.
 */
export const TINT = 0.1;

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
  /* THE LADDER RE-STEPPED (observed 2026-09-08: dark-theme contrast was too
     low, the shell reading as one flat sheet).

     R23 removed every border in the platform and made the panel's boundary
     its LIP and its DROP instead. In light that works — a white sheet on a
     cream ground with a dark ambient drop under it reads immediately. In
     dark all three mechanisms were near zero at once, which is why the dark
     shell had no structure in it at all:

       tone  the panel sat 3.5 L* above the page (#16191C over #0F1113)
       drop  a BLACK shadow on a near-black ground is arithmetically nothing
       lip   `.glass-chrome` — the rail, the top bar, the menu column — has
             no lip AT ALL, deliberately: it is structure, not content

     So in dark the tone has to carry it alone, and it now does: the panel is
     7 L* above the page, the raised tone 4.7 above the panel. Asserted below
     rather than eyeballed, because this exact pair passed every contrast
     check in this file on the day the flat shell was found — the floors were
     all about TEXT ON a surface and nothing asked whether the surface could
     be seen. */
  bg: "#0F1113",            // the ground
  surface: "#1B2025",       // panels and cards sit ABOVE it — was #16191C
  surface2: "#242A30",      // raised: chips, hovered rows — was #272C32
  /* MEASURED 2026-09-05 on panel.arameet.ir: their field ground is its own
     darker tone, not the raised one. Ours had the raised tone doing both
     jobs, which made a text box and a hovered chip the same colour — the
     reference tells them apart and the product reads better for it.
     Re-stepped with the ladder: it stays BELOW the panel (a field is a well
     inside a card) and above the page, so an input on the bare ground is
     still a shape. */
  field: "#161A1E",         // dark: the field has its own ground
  border: "#333A41",        // hairline (decorative; R23 leaves few of these)
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
  /* THE INK BUTTON (user, 2026-09-18): the button family's fill is the page's
     own ink, not the accent — near-white on the dark ground, near-black on
     the light one; `btnSoft` is the soft coat's ground under the page's fg */
  btn: "#E6E9EC",
  onBtn: "#101316",
  btnSoft: "#2A3138",
  success: "#34D399", warning: "#FBBF24", danger: "#FB7185", info: "#5B9BE8",
  /* the RECORD red keeps its own token and its softened value — the
     reference records with a red dot too, and ours already passes */
  record: "#DB6060",
  /* R23's sheet. `glass` is the tone PAINTED AT `glassAlpha`, so it is
     lighter than the opaque token it replaces and the two are only equal
     once composited — which is the assertion below, and the reason these
     live here instead of being picked by eye in globals.css. There are 256
     `bg-surface` sites against 46 glass ones; if the composite drifts off
     the token, the product grows two panel colours and nothing goes red. */
  glass: "#242B32", glassAlpha: 0.58,
  glass2: "#39414A", glass2Alpha: 0.3,
  /* the QUIET sheet (HOME's own column): chrome by position, page by tone.
     Deliberately between the two — asserted as a relationship, not a value. */
  glassSoftAlpha: 0.32,
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
  btn: "#1C1A16",
  onBtn: "#FFFFFF",
  btnSoft: "#E7E5E0",
  /* status hues nudged darker than the reference (#0F9D6B / #CC8400 /
     #E23B54 measured 3.5, 3.1 and 4.2 against the floors) — same families,
     first passing shade */
  success: "#0B7A52", warning: "#8F5D08", danger: "#C9264A", info: "#1B4A8F",
  record: "#C54A4A",
  /* light's sheet is WHITE at .72 over the cream ground, which composites to
     #FCFCFB — a whisper above the page. That is deliberate and it is NOT the
     dark ladder's mistake: here the ambient drop is dark ink on a light page
     and does the separating, so the tone does not have to. Hence the L* floor
     below is asserted for DARK only, with light's readings printed. */
  glass: "#FFFFFF", glassAlpha: 0.72,
  /* NOT white (2026-09-08). The raised sheet was #FFFFFF at 50% over a white
     panel, which is white — so `.glass-raised` in light has been painting the
     panel it sits on since R23, and a raised row was raised in dark only.
     This is the cream at the alpha that paints --surface-2, the same rule the
     dark tone follows. */
  glass2: "#DBD5C7", glass2Alpha: 0.5,
  glassSoftAlpha: 0.34,
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
  /* the ink button (2026-09-18): the widest pair in the file today, asserted
     anyway — "the ink" is a token somebody will one day soften, and the day
     it lands at grey-on-grey this line is what says so; the soft coat's
     ground carries the page's fg, and the fill has to stand off the panel
     like any control edge */
  check("ON-BTN on the ink button fill", T.onBtn, T.btn);
  check("fg on the soft button's ground", T.fg, T.btnSoft);
  check("ink button fill vs surface (a control edge)", T.btn, T.surface, 3);
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

  /*
   * ── CAN THE SURFACE BE SEEN? (2026-09-08) ─────────────────────────────
   *
   * Every check above asks whether text is legible ON a surface. None of
   * them asks whether the surface is legible on the PAGE — and after R23
   * took the borders away, that is the only question left holding the
   * layout together. The dark shell shipped with the panel 3.5 L* above the
   * ground and passed this entire file.
   *
   * The floor is asserted for DARK only, and the reason is a mechanism and
   * not a preference: in light the ambient drop is dark ink on a light page
   * and separates the sheet by itself, so the tone is free to be a whisper;
   * in dark the drop is black on near-black, `.glass-chrome` carries no lip
   * at all, and the tone is the only mechanism there is. Light's numbers are
   * printed so the asymmetry stays visible rather than becoming a hole.
   */
  const sep = (label, a, b, need) => {
    const d = Math.round(Math.abs(Lstar(a) - Lstar(b)) * 10) / 10;
    if (need == null) { console.log(`  ---   ${String(d).padStart(5)}          ${label}`); return; }
    const ok = d >= need;
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${String(d).padStart(6)} (needs ${need})  ${label}`);
  };
  const dark = T === DARK;
  const need = dark ? 6 : null;      // the tone carries it alone in dark
  const need2 = dark ? 4 : null;
  sep("L* step: page -> panel (surface on bg)", T.surface, T.bg, need);
  sep("L* step: panel -> raised (surface-2 on surface)", T.surface2, T.surface, need2);
  sep("L* step: page -> field (an input on the bare ground)", T.field, T.bg, need2);

  /*
   * THE SHEET AND THE PANEL ARE ONE COLOUR, composited.
   *
   * 256 sites paint `bg-surface`; 46 wear `.glass`. They are the same panel
   * and a reader must not be able to tell which one they are looking at, so
   * the sheet's tone is not a value anybody picks — it is whatever paints to
   * the token at its own alpha.
   *
   * The floor is INDISTINGUISHABILITY (2 L*), not equality, because rounding
   * to eight bits three times cannot land exactly in every theme and a check
   * nobody can satisfy gets an exemption written for it. Its first run caught
   * a real one at 6.6: light's `.glass-raised` painted WHITE at 50% over the
   * white sheet, which is white — the raised row in the light theme has never
   * been raised, and no contrast check could see it, because a chip that is
   * exactly its own panel is perfectly legible and simply not there.
   */
  const same = (label, got, want) => {
    const d = Math.round(Math.abs(Lstar(got) - Lstar(want)) * 10) / 10;
    const ok = d <= 2;
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${got} vs ${want} (dL ${d}, max 2)  ${label}`);
  };
  same("glass over bg paints --surface", over(T.glass, T.bg, T.glassAlpha), T.surface);
  same("glass-2 over the sheet paints --surface-2", over(T.glass2, T.surface, T.glass2Alpha), T.surface2);

  /*
   * The quiet sheet is a RELATIONSHIP (HOME's column: "different, and more
   * similar to the background of the chat but a bit glass morphicly
   * looking"). It has to sit strictly between the page and the chrome —
   * a literal here would go stale the first time either end moved, and both
   * ends just did.
   */
  {
    const soft = over(T.glass, T.bg, T.glassSoftAlpha);
    const ok = Lstar(T.bg) < Lstar(soft) && Lstar(soft) < Lstar(T.surface);
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${soft} L*${Lstar(soft)}   quiet sheet sits between page (${Lstar(T.bg)}) and chrome (${Lstar(T.surface)})`);
  }
}

console.log(`\n${failures === 0 ? "ALL PAIRS PASS" : `${failures} FAILING PAIR(S)`}`);
return failures;
}

if (isMain) process.exit(verify() === 0 ? 0 : 1);
