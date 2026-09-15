import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_SIZE, ICONS } from "./icons";

/**
 * The icon set's two house rules, as things that RUN (user directive,
 * 2026-08-26: "make a solid list of icons … and only use them so the
 * whole platform becomes unified").
 *
 * Both failures this catches were real and visible on screen: the same
 * icon rendered at 15px here and 18px there, and text characters (＋, ✕)
 * standing in for icons — which do not share the set's stroke, weight or
 * box, so they read as a different language wherever they appear.
 *
 * A comment asking people to use the scale is a comment; this fails.
 */
const ROOT = join(process.cwd(), "src");
const ALLOWED = new Set<number>(Object.values(ICON_SIZE));

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the icon set", () => {
  it("renders only at sizes on the scale", { timeout: 30_000 }, () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<Icon[A-Za-z0-9]*\s+[^>]*?(?:width|height)=\{(\d+)\}/g)) {
        const px = Number(m[1]);
        if (!ALLOWED.has(px)) offenders.push(`${file.replace(ROOT, "src")}: ${px}px`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nothing uses a text character where an icon belongs", { timeout: 30_000 }, () => {
    /* the exact characters that were doing icon work before this rule.
       They are still legal INSIDE strings — a placeholder or a message
       may say ＋ — so the check looks only at JSX text nodes. */
    const GLYPHS = /[＋✕▸⟨⟩▣⋯]/u;
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/>\s*([^<>{}\n]{1,3})\s*</g)) {
        if (GLYPHS.test(m[1]!)) offenders.push(`${file.replace(ROOT, "src")}: ${m[1]!.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("sits on the line of its own label, not on the baseline", () => {
    /*
     * `.icon` IS AN INLINE BOX (observed 2026-09-08: icons on buttons and on
     * the toast did not sit on the same line as the text beside them, on some
     * of the platform's buttons too).
     *
     * Without `vertical-align`, an inline box sits on the text BASELINE: the
     * bottom of the glyph lands where the bottom of an "n" lands, and the
     * icon rides up by the descender depth of its line. Measured in the
     * running app against this stylesheet: a glyph in a non-flex button sat
     * 5.34px above the centre of the word beside it, and 0.34px after —
     * which is the gap between cap-height centre and x-height centre, i.e.
     * as centred on the text as an icon gets.
     *
     * It hid for months because `.btn` is `inline-flex items-center`, which
     * blockifies its children and centres them: every button drawn with the
     * theme's class was right, and every hand-rolled `.tap` button, menu row
     * and glyph in a sentence was wrong. That is exactly the shape of the
     * defect: it showed on SOME buttons and not others.
     *
     * Asserted as CSS TEXT because there is no layout to measure here: jsdom
     * computes no boxes, so a rendering test would pass against the broken
     * rule. This is the declaration; the measurement above is the evidence
     * for it.
     */
    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    const block = /\.icon\s*\{([^}]*)\}/.exec(css);
    expect(block, ".icon has no rule in globals.css").not.toBeNull();
    expect(block![1]).toMatch(/vertical-align:\s*middle/);
  });

  it("is lifted onto the ENGLISH cap band, and only there", () => {
    /*
     * THE FLEX HALF of the same defect (observed 2026-09-08 on the English
     * «Start recording a meeting» button: the icon was not aligned with the
     * text beside it).
     *
     * `vertical-align` — the fix above — is IGNORED on a flex item, so `.btn`
     * and every `flex items-center` row centre the glyph on the line box
     * instead. Measured in the running app (Vazirmatn 600 at 100px, canvas
     * metrics): the line box's centre sits 24.5 above the baseline and the
     * CAP BAND's centre sits 35.5, so a centred icon lands 0.11em below the
     * middle of an English word — 2.07px on the reported button.
     *
     * Both halves of this are assertions, and the second one is the one that
     * matters: the SAME measurement on Persian reads -0.34px, because
     * Persian ink runs the full height of Vazirmatn's box (which is why the
     * box is that tall). A rule that forgot its `[dir="ltr"]` gate would
     * therefore FIX English by breaking Persian, silently, in the locale we
     * ship first — so the gate is asserted per selector rather than once.
     *
     * CSS text, not layout: jsdom computes no boxes, so a rendering test
     * would pass against an ungated rule. The measurement is the evidence;
     * this is the declaration.
     */
    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    const at = css.indexOf("translateY(-0.11em)");
    expect(at, "the cap-band nudge is gone from globals.css").toBeGreaterThan(0);

    // every selector that carries the nudge is gated on the Latin locale
    const block = css.slice(0, at);
    /* split on the commas BETWEEN selectors, never the ones inside `:is(…)` —
       a naive split reports `button` as an ungated selector, which is a red
       about the checker and not about the stylesheet */
    const selectorList = block.slice(block.lastIndexOf("*/") + 2);
    const selectors: string[] = [];
    let depth = 0, current = "";
    for (const ch of selectorList) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) { selectors.push(current); current = ""; continue; }
      current += ch;
    }
    selectors.push(current);
    const cleaned = selectors.map((x) => x.trim()).filter(Boolean);
    expect(cleaned.length).toBeGreaterThan(2);
    for (const sel of cleaned) expect(sel, `ungated selector: ${sel}`).toContain('[dir="ltr"]');

    // a glyph standing alone must stay where it is — the two icon-button
    // sizes are named exclusions, and a label is required after the glyph
    expect(block).toContain(":not(.btn-icon)");
    expect(block).toContain(":not(.btn-icon-sm)");
    expect(block).toContain(":not(.btn-icon-lg)");
    expect(block).toMatch(/:has\(\+ :not\(svg\)/);

    // and nothing anywhere may lift a glyph without that gate
    for (const m of css.matchAll(/^([^\n@}{]*)\{[^}]*translateY\(-0\.11em\)/gm)) {
      expect(m[1], `ungated rule: ${m[1]!.trim()}`).toContain('[dir="ltr"]');
    }
  });

  it("the registry names every icon in the file", () => {
    // the list is the vocabulary; an icon missing from it is invisible to
    // anyone looking for one, and gets re-drawn instead
    const text = readFileSync(join(ROOT, "components/icons.tsx"), "utf8");
    const exported = [...text.matchAll(/^export const (Icon[A-Za-z0-9]+)/gm)].map((m) => m[1]!);
    expect(exported.length).toBeGreaterThan(40);
    expect(Object.keys(ICONS)).toHaveLength(exported.length);
  });
});
