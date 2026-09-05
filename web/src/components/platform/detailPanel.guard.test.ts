import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R18 — ONE DETAIL FRAME (user ruling, 2026-09-05: "when you click on a
 * project it should open a pop-up window, not change the page — this problem
 * is systematic").
 *
 * The frame a detail opens in — the fixed backdrop, the card, the top bar, the
 * body and the 283px rail — is spelled ONCE, in `DetailPanel`. Anything that
 * opens over a list uses it. This guard fails when a second copy of the frame
 * appears anywhere in the tree, and when either of the two details that
 * already wear it stops.
 */
const SRC = join(process.cwd(), "src");

/** the frame's first line — the one string every copy would have to carry */
const FRAME = "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto";

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

describe("R18: one detail frame", () => {
  it("the frame is spelled once, in DetailPanel", () => {
    const carriers = sources(SRC)
      .filter((file) => readFileSync(file, "utf8").includes(FRAME))
      .map((file) => relative(SRC, file).split("\\").join("/"));
    expect(carriers).toEqual(["components/platform/DetailPanel.tsx"]);
  });

  it("the task detail and the project detail both open in it", () => {
    for (const file of ["components/platform/tasks/TaskDetail.tsx", "components/platform/ProjectDetail.tsx"]) {
      expect(readFileSync(join(SRC, file), "utf8"), `${file} must render <DetailPanel>`).toMatch(/<DetailPanel\b/);
    }
  });
});
