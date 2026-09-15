import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FIXING ONE INSTANCE DOES NOT FIX ITS SIBLINGS (2026-09-09).
 *
 * `useSeededName` was written on 2026-09-02 for the four seeded task columns
 * and wired into ONE component — the board. Seven months of screens later,
 * the same four rows were being rendered raw in six other places: the
 * projects kanban, the task detail's column picker, the new-task dialog's
 * chips, the list/calendar row chip, the project detail's work list and the
 * meeting page's mini board. So «بک‌لاگ» sat in the picker of a card whose
 * board column, one click away, said "Backlog" — one row of the database
 * disagreeing with itself on one screen, with nothing malfunctioning.
 *
 * Nothing could have gone red for that: the resolver's own tests were about
 * the resolver, and every screen's tests were about that screen.
 *
 * ── WHY THIS SHAPE AND NOT A NICER ONE ────────────────────────────────────
 *
 * A per-file COUNT of bare uses, failing in both directions, which is the
 * shape `surface.guard.test.ts` and `control.guard.test.ts` already use here.
 * Too many is the regression; too few is a stale entry, and an entry nobody
 * ever has to shrink is a backlog nobody can see.
 *
 * It matches the QUALIFIED form a real render must take (`col.name`,
 * `column.name`) rather than the word "name" — this repo has already had a
 * tripwire stay green because a column's NAME matched its own presence in the
 * code that failed to use it, and it has already deleted one checker for
 * manufacturing false positives. And it strips `seededName(...)` first, so a
 * wired site is not counted as a bare one.
 *
 * The two entries below are the uses that MUST stay bare, each with the
 * reason, because each is about the STORED string rather than the displayed
 * one — and a version of this guard that "fixed" them would be a real defect:
 * a rename box pre-filled with a translation would rename the column to the
 * reader's language the moment somebody pressed save.
 */
/* `process.cwd()` + a relative path, which is what every other tree-scanning
   guard in this repo does (`api/bodyForward.guard.test.ts` and its siblings).
   NOT `import.meta.url`: vitest rewrites it, and the two attempts before this
   one produced a bare drive-root path and then a non-file URL — a scan of nothing, which a
   checker without the had-something-to-check assertion below would have
   reported as a clean sweep. Same trap as the WorkflowBuilder catalogue
   reads, which cannot resolve at all from a directory whose name has a space
   in it. */
const SRC = join(process.cwd(), "src");

/** file → how many BARE `col.name` / `column.name` uses it is allowed. */
const BARE_ALLOWED: Readonly<Record<string, { count: number; why: string }>> = {
  "components/platform/TaskBoard.tsx": {
    count: 2,
    why: "the rename box: `defaultValue={col.name}` and the did-it-change test."
      + " Pre-filling a TRANSLATION here renames the column to the reader's"
      + " language on the next save — the stored word is the subject.",
  },
  "lib/agentSurface.ts": {
    count: 1,
    why: "an agent naming a column matches against what is STORED; matching a"
      + " localized string would resolve differently per reader.",
  },
};

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { sources(full, out); continue; }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** the file's text with every wired use removed, so only bare ones remain */
function bareUses(text: string): number {
  const wired = text.replace(/seededName\(\s*(?:col|column)\.name\s*\)/g, "");
  return (wired.match(/\b(?:col|column)\.name\b/g) ?? []).length;
}

describe("a seeded column name is localized wherever it is RENDERED", () => {
  const files = sources(SRC);

  it("has something to check — the corpus and the resolver both exist", () => {
    /* the vacuum this guard could pass in: an empty file list, or a renamed
       resolver, either of which would make every assertion below a pass
       about nothing */
    expect(files.length).toBeGreaterThan(100);
    expect(readFileSync(join(SRC, "lib/seededNames.ts"), "utf8")).toContain("useSeededName");
  });

  it("every bare use is a listed one, with its reason", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(SRC.length).replace(/\\/g, "/").replace(/^\/+/, "");
      const bare = bareUses(readFileSync(file, "utf8"));
      const allowed = BARE_ALLOWED[rel]?.count ?? 0;
      if (bare !== allowed) offenders.push(`${rel}: ${bare} bare, ${allowed} allowed`);
    }
    expect(
      offenders,
      "a seeded column name rendered without useSeededName reads Persian on an"
      + " English screen and English on a Persian one:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("every entry names a file that still exists — an allow-list for a deleted file reads as coverage", () => {
    const present = new Set(files.map((f) => f.slice(SRC.length).replace(/\\/g, "/").replace(/^\/+/, "")));
    for (const rel of Object.keys(BARE_ALLOWED)) expect(present.has(rel), rel).toBe(true);
  });

  it("CONTROL: the counter can tell a wired use from a bare one", () => {
    /* the discriminating question. A counter that saw both — or neither —
       would satisfy the assertion above against any tree at all. */
    expect(bareUses("<span>{column.name}</span>")).toBe(1);
    expect(bareUses("<span>{seededName(column.name)}</span>")).toBe(0);
    expect(bareUses("aria-label={seededName(col.name)} title={col.name}")).toBe(1);
    /* and it does not match the word on its own, which is the trap that made
       an earlier tripwire in this repo pass against a column nothing read */
    expect(bareUses("const name = row.name; // column name")).toBe(0);
  });
});
