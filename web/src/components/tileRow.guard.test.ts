import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * **A `.tile` that is a row says `tile-row`.**
 *
 * `.tile` dresses the dashboard's cards and declares `flex-direction: column`
 * (globals.css). Tailwind's `flex` sets the display and nothing else, so a
 * class list reading `tile flex items-center gap-3` — which LOOKS like a row
 * in a diff, and passes every guard that counts corners, borders and grounds
 * — renders as a centred vertical stack. The projects list row shipped that
 * way and stood on production as seven lines, one item each (2026-09-15);
 * the meetings and task lists' rows carry `tile-row` and never did.
 *
 * The rule, as a check: every className token list that contains the bare
 * token `tile` and a row-shaped intent (`items-center`, `items-start`,
 * `justify-between`, `flex-row`) and does NOT say `flex-col` must also carry
 * `tile-row`. Tokens, never substrings — `tile-chip` and `tile-remove` are
 * other classes, and a substring match would name them (the name-matching-
 * itself trap this repo has minted three times).
 *
 * `flex-col` is the exclusion with its reason: a column tile that centres
 * its children (`tile flex flex-col items-center`) is a column on purpose.
 *
 * Verified red on the projects list row before it was fixed.
 */
const ROOTS = ["src/components", "src/app"];

function* tsxFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* tsxFiles(full);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) yield full;
  }
}

/** every string literal handed to className — plain and template forms */
function classStrings(source: string): string[] {
  const out: string[] = [];
  const re = /className=\{?\s*[`"']([^`"']*)[`"']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]!);
  return out;
}

describe("tileRow.guard — a .tile that is a row says tile-row", () => {
  it("names every row-shaped tile that forgot tile-row (want none)", () => {
    const offenders: string[] = [];
    let tiles = 0;
    for (const root of ROOTS) {
      for (const file of tsxFiles(join(process.cwd(), root))) {
        const source = readFileSync(file, "utf8");
        for (const cls of classStrings(source)) {
          const tokens = cls.split(/\s+/).filter(Boolean);
          if (!tokens.includes("tile")) continue;
          tiles += 1;
          const rowShaped = tokens.some((t) =>
            ["items-center", "items-start", "justify-between", "flex-row"].includes(t));
          if (!rowShaped || tokens.includes("flex-col") || tokens.includes("tile-row")) continue;
          offenders.push(`${file.replace(process.cwd(), "").replace(/\\/g, "/")}: "${cls}"`);
        }
      }
    }
    /* had something to check: the scan saw the tiles it is about */
    expect(tiles).toBeGreaterThan(5);
    expect(offenders, "a tile that reads as a row and renders as a stack").toEqual([]);
  });

  it("the control: a row that says tile-row passes, one that only says flex does not", () => {
    const judge = (cls: string) => {
      const tokens = cls.split(/\s+/);
      const rowShaped = tokens.some((t) => ["items-center", "items-start", "justify-between", "flex-row"].includes(t));
      return tokens.includes("tile") && rowShaped && !tokens.includes("flex-col") && !tokens.includes("tile-row");
    };
    expect(judge("tile tile-row flex items-center gap-3 p-3.5")).toBe(false);
    expect(judge("tile flex flex-col items-center gap-3 p-4")).toBe(false);
    expect(judge("tile-chip flex items-center")).toBe(false);
    expect(judge("tile flex items-center gap-3 px-3 py-2.5")).toBe(true);
  });
});
