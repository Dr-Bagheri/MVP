import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE CONTROL, ONE SHAPE.
 *
 * User directive, 2026-09-02: "the look of the platform is like 10 different
 * developers made it — one is small, one is big, one has one shape for button,
 * the other has the other one."
 *
 * That was measurable, and the measurement is the reason this file exists: on
 * the day it was written, 47 controls in this codebase had hand-rolled their
 * own geometry, in ELEVEN different shapes — h-10 rounded-xl, h-8 rounded-lg,
 * h-9 rounded-xl, h-11 rounded-xl, h-7 rounded-md, and on. Against 109 that
 * used `.btn`.
 *
 * Nobody was being careless. `.btn` offered exactly ONE size, so any screen
 * that wanted a compact control had to invent one, and eleven inventions is
 * what the directive was describing. The sizes exist now (`.btn-sm`,
 * `.btn-icon`, measured off the reference), so inventing a twelfth is a
 * choice rather than a necessity — and this is what makes it a visible one.
 *
 * REMAINING is not a permission list, it is a WORKLIST with a number beside
 * each entry. Converting a file means lowering its count; the assertion fails
 * either way — too many is a regression, too few is a stale entry that is
 * quietly making the guard smaller than it looks. An allow-list nobody has to
 * shrink is a backlog nobody can see.
 */
const SRC = join(process.cwd(), "src");

const REMAINING: Record<string, number> = {
  "app/[locale]/(auth)/pending/page.tsx": 1,
  "app/[locale]/(auth)/suspended/page.tsx": 1,
  "components/RichTextEditor.tsx": 1,
  "components/echo/SpeakersDirectory.tsx": 1,
  "components/platform/Hub.tsx": 1,
  "components/platform/IconRail.tsx": 1,
  "components/platform/Integrations.tsx": 1,
  "components/platform/Meetings.tsx": 1,
  "components/platform/TaskBoard.tsx": 1,
  "components/platform/TopBar.tsx": 1,
  "components/platform/WorkflowRunDialog.tsx": 1,
  "components/platform/meeting/Room.tsx": 1,
  "components/platform/meeting/Stage.tsx": 1,
  "components/scaffold/SectionMenu.tsx": 1,
};

function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * A control's geometry written by hand: a fixed height AND a corner AND a
 * flex row that centres its contents. Deliberately all four — `h-8` alone is
 * a spacing utility, `rounded-lg` alone is a card, and a guard that fires on
 * either would be the false-positive factory that gets a check muted inside a
 * week.
 */
function handRolled(code: string): number {
  let n = 0;
  for (const m of code.matchAll(/className=[`"]([^`"]{0,220}?)[`"]/g)) {
    const cls = m[1]!;
    if (/\bbtn\b|\bbtn-/.test(cls)) continue;
    if (!/\bh-\d+(?:\.\d+)?\b/.test(cls)) continue;
    if (!/\brounded-(?:md|lg|xl|2xl|full)\b/.test(cls)) continue;
    if (!/\b(?:inline-)?flex\b/.test(cls) || !cls.includes("items-center")) continue;
    n += 1;
  }
  return n;
}

describe("controls share one shape", () => {
  it("has something to check — .btn is what most of the product already uses", () => {
    let users = 0;
    for (const file of sources(SRC)) {
      if (/\bbtn(?:-\w+)?\b/.test(codeOnly(readFileSync(file, "utf8")))) users += 1;
    }
    expect(users).toBeGreaterThan(20);
  });

  it("no file hand-rolls MORE button geometry than its recorded count", () => {
    const wrong: string[] = [];
    for (const file of sources(SRC)) {
      if (file.split(/[\/]/).includes("ui")) continue; // shadcn source owns its own variants
      const rel = relative(SRC, file).split("\\").join("/");
      const found = handRolled(codeOnly(readFileSync(file, "utf8")));
      const allowed = REMAINING[rel] ?? 0;
      if (found > allowed) wrong.push(`${rel}: ${found} hand-rolled, ${allowed} recorded`);
      if (found < allowed) wrong.push(`${rel}: ${found} hand-rolled but ${allowed} recorded — lower the number`);
    }
    expect(
      wrong,
      "use .btn / .btn-sm / .btn-icon, or update the worklist:\n" + wrong.join("\n"),
    ).toEqual([]);
  });
});
