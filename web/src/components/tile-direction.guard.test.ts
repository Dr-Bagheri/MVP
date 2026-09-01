import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.tile` IS A COLUMN, AND SAYING `flex` DOES NOT CHANGE THAT.
 *
 * The shell class sets `flex-direction: column` itself, so `tile flex
 * items-center gap-3` — which every reader, including its author, sees as a
 * horizontal row — computes as a centred vertical stack. It shipped to
 * production that way on the meetings list: icon, title, meta, badge and
 * menu piled on top of each other, each row three times its height. Nothing
 * in the markup was wrong to look at. Only the rendered artifact disagreed.
 *
 * So a `.tile` that also declares `flex` must say WHICH direction. The
 * default stops being invisible, and the next author is asked one question
 * at the moment they can still answer it.
 *
 * Comments are stripped from the corpus first. Left in, this guard's only
 * finding on a clean tree was the sentence above describing the bug — the
 * name matching itself, which is how a checker earns its own mute button.
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

/** every class-string literal in the tree that names `tile` and `flex` */
function tileFlexClasses(): { file: string; cls: string }[] {
  const found: { file: string; cls: string }[] = [];
  for (const full of tsxFiles(SRC)) {
    const code = codeOnly(readFileSync(full, "utf8"));
    for (const match of code.matchAll(/(?:"|`)([^"`]*\btile\b[^"`]*)(?:"|`)/g)) {
      const cls = match[1]!;
      if (!/\bflex\b/.test(cls)) continue;
      found.push({ file: relative(SRC, full).split("\\").join("/"), cls });
    }
  }
  return found;
}

describe("a .tile that declares flex", () => {
  it("names its direction, because the class already chose one", () => {
    const undirected = tileFlexClasses()
      .filter(({ cls }) => !/\bflex-(col|row)\b/.test(cls))
      .map(({ file, cls }) => `${file} :: ${cls.trim().slice(0, 80)}`);

    expect(
      undirected,
      "`.tile` is flex-direction: column — add flex-row (or flex-col) so the "
      + "markup says what it renders:\n" + undirected.join("\n"),
    ).toEqual([]);
  });

  it("has something to check — the corpus is not empty", () => {
    /* The vacuum guard. A regex that quietly stops matching (a rename of the
       class, a move of the components directory) would report a clean tree
       forever, and a pass would mean nothing. */
    expect(tileFlexClasses().length).toBeGreaterThan(3);
  });
});
