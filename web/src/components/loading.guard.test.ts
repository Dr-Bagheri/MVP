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
  // audit finding, 2026-09-02: connectors/page.tsx left the worklist — its one
  // vanish-while-loading slot renders a Card of SkeletonLines now (entry at 0
  // is deleted, not zeroed: a zero row reads as coverage and is a hole)
  /* NOT A LOADING STATE, examined and left (2026-09-03, the Management and
     Settings sweep). The one match is `measuredAt`'s `at === null ? null :`,
     and the branch above it is `loading ? <Skeleton/>` — so by the time this
     ternary is reached the read has ANSWERED, and a null `measured_at` means
     the metric was never measured, which the card already says out loud with
     its own "—". There is no frame to draw for a timestamp that does not
     exist. Listed with its reason rather than pattern-matched away: telling
     a real absence from a fetch in flight by the shape of the ternary is
     what a false-positive factory does. */
  "app/[locale]/management/server/page.tsx": 1,
  /* NOT A LOADING STATE, and stays at 1 rather than being written around
     (2026-09-03, the management/settings sweep). The members roster's one
     match is `detailId === null ? null : rows.find(…)` — the flag for the
     member-detail panel, whose row is already in hand from the table. A
     dialog nobody opened genuinely renders nothing, and there is no frame to
     draw for it. The list itself was framed on 2026-09-02: the DataTable
     renders unconditionally with `loading={!loaded}`, so the skeleton rows
     stand in the real table until the answer arrives and «عضوی با این نام
     پیدا نشد» appears only after it (gate.test.tsx holds the fetch open and
     measures exactly that). The ternary could be spelled without `=== null`
     and the entry would drop to zero — that is the version to refuse: it
     would satisfy the checker by changing the code the checker reads, which
     is the fix that reads as satisfied and moves nothing. */
  "app/[locale]/management/users/page.tsx": 1,
  /* NEITHER IS A LOADING STATE (2026-09-03, the agents rebuild). Both matches
     are exactly the two categories this file's header names: `editing === null
     ? null :` is the editor dialog's open flag, and `failed === null ? null :`
     is the refusal line under the form. A dialog nobody opened and an error
     that has not happened both genuinely render nothing, and neither has a
     frame to draw.
     The screen's REAL loading state is framed and is not in this count: both
     sections render their heading unconditionally with SkeletonCards inside,
     so the layout does not move when the roster lands and "loading" never
     draws the same picture as "you have no agents" — which on this screen
     would be a claim about the product rather than about the request. */
  "components/platform/Agents.tsx": 2,
  "app/[locale]/workflows/[handle]/page.tsx": 2,
  "app/[locale]/workflows/runs/[id]/page.tsx": 1,
  "components/echo/Recorder.tsx": 1,
  "components/echo/SummariesSection.tsx": 1,
  /* NOT A LOADING STATE, and listed rather than pattern-matched away
     (2026-09-03). The live stage's members card renders its host row as
     `hostName !== null ? … : null`, which is this check's shape — but the
     meeting record is already in hand by then, and a null host means the
     meeting HAS no resolvable host (the person's row is gone), which is a
     real absence with no frame to draw. Telling that from a fetch-in-flight
     by the shape of the ternary is exactly what a false-positive factory
     does, so it stays on the list with its reason. */
  "components/platform/MeetingPage.tsx": 1,
  /* 2026-09-04: the Instructions panel is a REAL ABSENCE, not a fetch in
     flight. The three shipped agents carry no instructions of their own —
     their prompt is product configuration and the wire sends null — so the
     section renders nothing rather than a heading over an apology, which is
     what the user asked for when they said "explain what Instructions is; if
     it does not serve any purpose remove it too". A skeleton here would
     promise a panel that is never coming. Same reasoning as MeetingPage
     above, and the same reason it stays listed rather than pattern-matched
     away: nothing can tell absence from loading by the shape of a ternary. */
  "components/platform/AgentDetail.tsx": 1,
  // audit finding, 2026-09-02: IntegrationDetail.tsx LEFT this list — its one
  // entry made the WHOLE page wait on api.connectors() although the icon,
  // name and description come from the catalogue; the header renders at once
  // now and the body holds two Cards of SkeletonLines while the wire answers
  "components/platform/Integrations.tsx": 2,
  // 2026-09-03: NotificationsSettings.tsx LEFT this list — its one entry was
  // the switch cell, which rendered EMPTY until me() answered and so looked
  // identical to the two states that legitimately have no switch ("absent",
  // "unreadable"); a Skeleton the switch's own size holds the place now
  // (entry deleted, not zeroed: a zero row reads as coverage and is a hole)
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
