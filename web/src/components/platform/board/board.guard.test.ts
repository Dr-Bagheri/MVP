import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R17 — ONE BOARD (user ruling, 2026-09-05: "there are basically two same
 * kanban tables in tasks and projects that are supposed to be the same but
 * they are different").
 *
 * The two boards read `boardStyle` for every class that makes a column a
 * column. This guard keeps them reading it: the literals may live in ONE file
 * and neither board may spell them again — because a copy is exactly how the
 * two came to differ within a day of the second one being written.
 *
 * The third test is the control: the module must still SAY the numbers, or
 * "neither board carries the literal" would pass against a module that had
 * quietly lost its shape.
 */
const SRC = join(process.cwd(), "src");

/**
 * Comments stripped, string-aware: a comment in TaskBoard that EXPLAINS the
 * 70vh floor is prose about the shape, not a copy of it, and a guard that
 * counted it would be the name-matching-itself trap pointed the other way.
 * (The stripper knows what it is inside of before it decides what a slash
 * means — `accept="audio/*"` in a string opened a comment in an earlier
 * guard's first draft and blanked half a file.)
 */
function codeOnly(text: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (quote !== null) {
      if (ch === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
      if (ch === quote) quote = null;
      out += ch; i += 1; continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; out += ch; i += 1; continue; }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2; continue;
    }
    if (ch === "/" && next === "/") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl; continue;
    }
    out += ch; i += 1;
  }
  return out;
}

const read = (p: string) => codeOnly(readFileSync(join(SRC, p), "utf8"));

const BOARDS = ["components/platform/TaskBoard.tsx", "components/platform/Projects.tsx"];
const MODULE = "components/platform/board/boardStyle.tsx";

/** the shape, in the words a copy would have to use */
const LITERALS = [
  "w-[300px]",
  "min-h-[70vh]",
  "scroll-quiet flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2",
  "scroll-quiet min-h-0 flex-1 space-y-2 overflow-y-auto pt-1",
  "cursor-pointer rounded-xl border border-border bg-surface p-3 shadow-card",
  "border-dashed border-border font-medium text-fg-muted hover:border-border-strong hover:text-fg",
];

describe("R17: one board", () => {
  it("both boards read the module", () => {
    for (const board of BOARDS) {
      expect(read(board), `${board} must import boardStyle`).toMatch(/from "\.\/board\/boardStyle"/);
    }
  });

  it("neither board spells the shape by hand", () => {
    for (const board of BOARDS) {
      const code = read(board);
      for (const literal of LITERALS) {
        expect(code, `${board} carries "${literal}" — read it from boardStyle`).not.toContain(literal);
      }
    }
  });

  it("the module itself still says the numbers — the control", () => {
    const code = read(MODULE);
    for (const literal of LITERALS) expect(code).toContain(literal);
  });
});
