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
  it("renders only at sizes on the scale", () => {
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

  it("nothing uses a text character where an icon belongs", () => {
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

  it("the registry names every icon in the file", () => {
    // the list is the vocabulary; an icon missing from it is invisible to
    // anyone looking for one, and gets re-drawn instead
    const text = readFileSync(join(ROOT, "components/icons.tsx"), "utf8");
    const exported = [...text.matchAll(/^export const (Icon[A-Za-z0-9]+)/gm)].map((m) => m[1]!);
    expect(exported.length).toBeGreaterThan(40);
    expect(Object.keys(ICONS)).toHaveLength(exported.length);
  });
});
