import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A SECTION DOES NOT WAIT TO EXIST.
 *
 * User directive, 2026-09-02: "even if it's loading the icon must be there and
 * the information in it must be loading … make a solid section for them and
 * just the information should load in it, not the way it is now that it does
 * not show the section until it loads the information for it. Add this as a
 * rule in whole platform too."
 *
 * The shape being forbidden is `data === null ? null : …`. It reads as
 * careful — render nothing until there is something true to show — and what
 * it produces is a page that assembles itself in front of the reader: a
 * heading, then a gap, then a table drops in and pushes everything below it
 * down. Every section arriving on its own schedule looks like a different
 * product each second the page is open.
 *
 * Two consequences, and the second is the one that matters most here:
 *   - the layout moves under the pointer as data lands;
 *   - "loading" and "empty" become the same picture, which is the kinds-of-
 *     nothing confusion rendered in pixels.
 *
 * The fix is Skeleton / SkeletonLines / SkeletonCards and `loading` on
 * DataTable: the frame is structure, structure is known before the network,
 * and only the contents wait.
 *
 * REMAINING is a WORKLIST, not a permission list. Each entry carries its count
 * and the assertion fails in BOTH directions — too many is a regression, too
 * few is a stale entry quietly making the guard smaller than it looks. An
 * allow-list nobody has to shrink is a backlog nobody can see.
 *
 * Not every entry is a defect: several are modal flags (`detailId === null ?
 * null :`), an error code, or a picker's value — a dialog that is not open
 * genuinely renders nothing. Those stay listed rather than pattern-matched
 * away, because every attempt to tell a list from a flag by its NAME is the
 * false-positive factory that gets a check muted inside a week.
 */
const SRC = join(process.cwd(), "src");

const REMAINING: Record<string, number> = {
  "app/[locale]/management/connectors/page.tsx": 1,
  "app/[locale]/management/server/page.tsx": 1,
  "app/[locale]/management/users/page.tsx": 1,
  "app/[locale]/workflows/[handle]/page.tsx": 2,
  "app/[locale]/workflows/runs/[id]/page.tsx": 1,
  "components/echo/Recorder.tsx": 1,
  "components/echo/SummariesSection.tsx": 1,
  "components/platform/AgentOverviewPanel.tsx": 2,
  "components/platform/IntegrationDetail.tsx": 1,
  "components/platform/Integrations.tsx": 2,
  "components/platform/NotificationsSettings.tsx": 1,
  "components/platform/TopBar.tsx": 1,
  "components/platform/WorkflowRunDialog.tsx": 1,
  "components/platform/dashboard/miniWidgets.tsx": 5,
  "components/platform/tasks/JalaliPicker.tsx": 1,
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

const VANISHES = /\b\w+\s*===\s*null\s*\?\s*null\s*:/g;

describe("a section renders its frame before its data", () => {
  it("has something to check — the skeletons are actually used", () => {
    let users = 0;
    for (const file of sources(SRC)) {
      const code = codeOnly(readFileSync(file, "utf8"));
      if (/\bSkeleton(?:Lines|Cards)?\b|\bloading=\{/.test(code)) users += 1;
    }
    expect(users).toBeGreaterThan(4);
  });

  it("no file renders NOTHING-while-loading more often than its recorded count", () => {
    const wrong: string[] = [];
    for (const file of sources(SRC)) {
      if (file.split(/[\/]/).includes("ui")) continue;
      const rel = relative(SRC, file).split("\\").join("/");
      const found = codeOnly(readFileSync(file, "utf8")).match(VANISHES)?.length ?? 0;
      const allowed = REMAINING[rel] ?? 0;
      if (found > allowed) wrong.push(`${rel}: ${found} vanish-while-loading, ${allowed} recorded`);
      if (found < allowed) wrong.push(`${rel}: ${found} found but ${allowed} recorded — lower the number`);
    }
    expect(
      wrong,
      "render the frame and a Skeleton inside it, or update the worklist:\n" + wrong.join("\n"),
    ).toEqual([]);
  });
});
