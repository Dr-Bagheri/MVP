import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A TAILWIND UTILITY WRITTEN ON A `.tile` DOES NOTHING, AND LOOKS LIKE IT DOES.
 *
 * `.tile` is declared outside every `@layer` in globals.css, and unlayered CSS
 * beats layered CSS regardless of order or specificity — so every Tailwind
 * class beside it loses silently. The shell sets `flex-direction: column`,
 * which is how the meetings list shipped with each row stacked three-high
 * under markup that read `tile flex items-center gap-3`.
 *
 * The first repair was `flex-row` at each site. It read as applied, passed
 * review, passed a source-level check written for exactly this bug — and
 * computed as a column anyway, because the utility never had a chance. That
 * is the finding this guard exists for, and the reason it checks for the
 * defect rather than for the intent: a source scan cannot know whether a row
 * was meant, but it can know that `flex-row` on a tile is a lie.
 *
 * The direction is set by `.tile-row`, a companion class in the same
 * unlayered block — the same cascade mechanism, pointed the right way.
 *
 * Comments are stripped first. Left in, this guard's only finding on a clean
 * tree was the prose describing the bug: the name matching itself.
 */
const SRC = join(process.cwd(), "src");

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Every class-string literal that names the tile SHELL.
 *
 * The membership test splits on whitespace rather than matching a pattern,
 * and both halves of that are lessons this guard learned on itself:
 *
 *  · `\btile\b` also matched `glass-tile`, a different class that sets
 *    neither radius nor direction — its `rounded-xl` works perfectly. That
 *    was the guard's first finding on a clean tree, and it was wrong.
 *  · `(^|\s)tile(\s|$)` fixed the hyphen and broke something quieter: with
 *    no `m` flag, `^` means the start of the FILE, so every class beginning
 *    `"tile …"` — which is most of them — stopped being seen. The corpus
 *    assertion below is what caught it; without one the guard would have
 *    gone green on a shrunken corpus and stayed green forever.
 */
function tileClasses(): { file: string; cls: string }[] {
  const found: { file: string; cls: string }[] = [];
  for (const full of tsxFiles(SRC)) {
    const code = codeOnly(readFileSync(full, "utf8"));
    for (const match of code.matchAll(/(?:"|`)([^"`\n]*)(?:"|`)/g)) {
      const cls = match[1]!;
      if (!cls.split(/\s+/).includes("tile")) continue;
      found.push({ file: relative(SRC, full).split("\\").join("/"), cls });
    }
  }
  return found;
}

/**
 * Utilities that CONTRADICT the shell — the ones that promise a change and
 * deliver none.
 *
 * Deliberately not "every utility the shell also sets": `flex-col` on a tile
 * is redundant and TRUE, and four of them sit in the tree stating an author's
 * intent perfectly honestly. Flagging those is how a guard gets muted in a
 * week, and a muted guard still reads as coverage.
 */
const CONTRADICTS = /\b(flex-row|h-auto|overflow-(?:visible|auto)|rounded-(?:none|sm|md|lg|xl|3xl|full))\b/;

describe("utilities written on a .tile", () => {
  it("are not the ones the shell already decides", () => {
    const inert = tileClasses()
      .filter(({ cls }) => CONTRADICTS.test(cls))
      .map(({ file, cls }) => `${file} :: ${cls.trim().slice(0, 80)}`);

    expect(
      inert,
      "`.tile` is unlayered and beats these utilities — they render nothing.\n"
      + "Use `tile-row` for a list line, or a class in globals.css:\n"
      + inert.join("\n"),
    ).toEqual([]);
  });

  it("has something to check — the corpus is not empty", () => {
    /* The vacuum guard. A regex that quietly stops matching (a renamed class,
       a moved directory) would report a clean tree forever, and every pass
       after that would mean nothing at all. */
    expect(tileClasses().length).toBeGreaterThan(10);
  });

  it("`.tile-row` is declared AFTER `.tile`, which is the whole mechanism", () => {
    /* Order is what makes the companion class win, both being unlayered. Move
       it above `.tile` and it stops working with nothing else changing —
       there is no specificity or layer to fall back on. */
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const shell = css.indexOf("\n.tile {");
    const row = css.indexOf("\n.tile-row {");
    expect(shell, ".tile must exist in globals.css").toBeGreaterThan(-1);
    expect(row, ".tile-row must exist in globals.css").toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(shell);
  });
});
