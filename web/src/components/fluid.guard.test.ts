import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **EVERY SIZE RIDES THE SCREEN** (user ruling, 2026-09-15: "for the pc and
 * laptop just change the font size, button size, table size based on the
 * screen and fit everything").
 *
 * The root font-size is fluid (globals.css: 15.5px at 1280, 17.5 at 1920),
 * so a size written in rem scales with the monitor and a size written in px
 * does not. Before this guard 205 text sizes and a dozen widths were px, so
 * captions and count badges stayed one size on every screen while everything
 * around them grew — the "it fits on some screens and not on others" report.
 *
 * What may stay px: radii (a corner is not a size that should grow with the
 * type), hairlines up to 3px, blur, and the 44px touch floor that
 * units.guard keeps ABSOLUTE on purpose. Everything else is a token or a rem.
 */
const SRC = join(process.cwd(), "src");
function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}
const rel = (full: string) => full.slice(SRC.length + 1).replace(/\\/g, "/");
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/* a px font size, anywhere */
const PX_TEXT = /(?<![\w-])text-\[\d+(?:\.\d+)?px\]/g;
/* a px box size of 4px or more: w/h/min/max, on a utility */
const PX_BOX = /(?<![\w-])(?:min-|max-)?[wh]-\[(\d+(?:\.\d+)?)px\]/g;

describe("fluid.guard — sizes are tokens or rem, never px", () => {
  it("no px font size anywhere in the tree", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const hits = code(readFileSync(file, "utf8")).match(PX_TEXT);
      if (hits) offenders.push(`${rel(file)}: ${[...new Set(hits)].join(" ")}`);
    }
    expect(offenders, "use text-caption / text-micro / text-detail or a rem").toEqual([]);
  });

  it("no px box size over the hairline threshold", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const text = code(readFileSync(file, "utf8"));
      for (const m of text.matchAll(PX_BOX)) {
        const px = Number(m[1]);
        if (px > 3 && px !== 44) offenders.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(offenders, "write it in rem, or name a token").toEqual([]);
  });

  it("the page column is a share of the screen, not a pixel width", () => {
    const page = code(readFileSync(join(SRC, "components/scaffold/Page.tsx"), "utf8"));
    expect(page).toContain("md:px-page-gutter");
    expect(page).toContain("md:px-page-gutter-reading");
    expect(page).not.toMatch(/max-w-content/);
    expect(page).not.toMatch(/mx-auto/);
  });

  it("can answer NO — the patterns catch what they are for", () => {
    expect("text-[11px]".match(PX_TEXT)).not.toBeNull();
    expect("text-caption".match(PX_TEXT)).toBeNull();
    expect("text-[0.6875rem]".match(PX_TEXT)).toBeNull();
    expect([..."w-[300px]".matchAll(PX_BOX)]).toHaveLength(1);
    expect([..."h-[44px] w-[3px]".matchAll(PX_BOX)].map((m) => Number(m[1]))).toEqual([44, 3]);
    expect([..."min-w-[14rem] w-control-sm".matchAll(PX_BOX)]).toHaveLength(0);
  });
});
