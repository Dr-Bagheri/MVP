import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  /* NOT A SECTION THAT VANISHES, examined and left (2026-09-16). The one
     match is `me === null ? null : personName(me, locale)` — the HOST's name
     inside the attendees dropdown. The section's frame is fully drawn while
     the identity read is in flight: the control, its border and its chevron
     are all there, and what is missing is one name in the closed label. A
     skeleton for a single name inside a trigger would be a grey bar that is
     the same size as the word it replaces, which is not a frame — it is the
     word, greyed. And `me === null` is BOTH states this product keeps apart
     (still asking / nobody), so the honest render is the one that claims
     neither. Listed rather than rewritten as `me && …`: the same branch in
     another spelling is dodging the check, not answering it. */
  "components/platform/MeetingAttendeesField.tsx": 1,
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
  /* NOT A LOADING STATE (2026-09-03, the agents rebuild): `editing === null
     ? null :` is the editor dialog's open flag. A dialog nobody opened
     genuinely renders nothing, and it has no frame to draw.
     It was TWO until 2026-09-08. The second match was `failed === null ?
     null :`, the refusal line under the form, and that line is a toast now —
     so the count came down with it, which is this list firing in the
     stale-entry direction exactly as it is meant to.
     The screen's REAL loading state is framed and is not in this count: both
     sections render their heading unconditionally with SkeletonCards inside,
     so the layout does not move when the roster lands and "loading" never
     draws the same picture as "you have no agents" — which on this screen
     would be a claim about the product rather than about the request. */
  "components/platform/Agents.tsx": 1,
  "app/[locale]/workflows/[handle]/page.tsx": 2,
  "app/[locale]/workflows/runs/[id]/page.tsx": 1,
  "components/echo/Recorder.tsx": 1,
  /* echo/SummariesSection.tsx's row LEFT on 2026-09-10, and it had been dead
     for longer than anyone could see: the file exists on no branch. The loop
     below walks the TREE and looks each file's row up, so a row naming a file
     that is gone is never visited and never fires in either direction — it sat
     here reading as coverage of a screen that does not exist. The test added
     below closes that hole for good. */
  /* NOT A LOADING STATE, and listed rather than pattern-matched away
     (2026-09-03) — the live screen's members card, which is gone with the
     rest of the plan (2026-09-08). DELETED rather than zeroed: this list
     fires in the stale-entry direction too, and a zero row reads as coverage
     while covering nothing. */
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
  /* 0181, and NOT a loading state. The one match is the progress bar's
     `ratio === null ? null :` — the TRACK renders unconditionally, and a
     null ratio means the project has no tasks at all, which the label
     beside it already says with a dash. Drawing a zero-width fill there
     would be a claim about the WORK ("nothing done") rather than about the
     board being empty.
     Listed with its reason rather than spelled around: `ratio !== null &&`
     satisfies the checker by changing the code the checker reads, which is
     the fix that reads as satisfied and moves nothing (the users/page.tsx
     note above names that exact temptation). The screen's real loading
     state is framed and is not in this count — `rows === null` renders
     SkeletonCards in the cards' own grid. */
  "components/platform/Projects.tsx": 1,
  /* 0184/0189, and NONE of these is a loading state — all three are the two
     categories this file's header names: a REAL ABSENCE and a picker's VALUE.
     `message.author_id === null` is an agent's message, which never has a
     person behind it; the same check inside the reply quote is that fact one
     level in; `match === null` is the mention picker, where no `@` is being
     typed and nothing is in flight.
     Chat.tsx itself dropped to ZERO when the room was rebuilt (2026-09-04):
     the rows and the composer moved into chat/, and this list caught the
     STALE entry in the same run that caught the two new files — which is
     exactly why it fails in both directions.
     The room's real loading states are framed and are not in this count: the
     message log renders SkeletonLines inside its own fixed box, so the layout
     does not move when the answer lands and "loading" never draws the same
     picture as "nobody has said anything". */
  "components/platform/chat/MessageRow.tsx": 2,
  "components/platform/chat/Composer.tsx": 1,
  /* 2026-09-08, and it is the room composer's entry one surface over: the hub's
     `@` picker opens on `mention === null ? null :`, where null means NOBODY IS
     WRITING A MENTION — a picker's value, not a fetch in flight. The panel's
     own three states are framed inside it and are what this rule is about: a
     query too short to ask with, a search running, and an answer that matched
     nothing, each naming which nothing it is rather than rendering an empty
     list. Listed with its reason rather than spelled around, for the reason
     the entries above give: `mention !== null &&` satisfies the checker by
     changing the code the checker reads and moves nothing. */
  "components/platform/Hub.tsx": 1,
  /* 0186, and NOT a loading state. The first match is the schedule's date
     conversion — `iso === null ? null : calendarDay(iso)` — where null is
     the picker's own word for «بدون مهلت», which this feature reads as
     "no end date". A value, not a fetch: nothing is in flight and there is
     no frame to draw for a date somebody deliberately did not pick.

     The SECOND is the same shape, added 2026-09-18 with the deadline's hour
     and minute: `value === null ? null : <TimeField…>`. A time on its own is
     not a deadline, so the control appears once a date exists — the absence
     is the answer to "is there a date", never to "has the network replied",
     and a skeleton there would reserve room for a control that is not
     coming. */
  "components/platform/tasks/TaskDialogs.tsx": 2,
  // audit finding, 2026-09-02: IntegrationDetail.tsx LEFT this list — its one
  // entry made the WHOLE page wait on api.connectors() although the icon,
  // name and description come from the catalogue; the header renders at once
  // now and the body holds two Cards of SkeletonLines while the wire answers.
  // 2026-09-06: Integrations.tsx LEFT it too — the shelf's two slots (the
  // tile's action and its control) became four placeholder tiles the real
  // tile's size while the wire answers (entry deleted, not zeroed)
  // 2026-09-03: NotificationsSettings.tsx LEFT this list — its one entry was
  // the switch cell, which rendered EMPTY until me() answered and so looked
  // identical to the two states that legitimately have no switch ("absent",
  // "unreadable"); a Skeleton the switch's own size holds the place now
  // (entry deleted, not zeroed: a zero row reads as coverage and is a hole)
  "components/platform/TopBar.tsx": 1,
  "components/platform/WorkflowRunDialog.tsx": 1,
  // 2026-09-08: dashboard/miniWidgets.tsx LEFT this list WITH ITS FILE — the
  // board it drew tiles for was replaced by Home, whose two panels hold
  // SkeletonLines while their reads answer (entry deleted, not zeroed: this
  // list asserts its entries name real files, so a stale row goes red)
  "components/platform/tasks/JalaliPicker.tsx": 1,
  /* 2026-09-08 — TWO, and neither is a section: `DayField` converts a
     project's `date` to the instant the picker speaks and back, and null
     passes through both ways. Nothing is in flight, and there is no frame
     to draw for a date nobody has picked — the same reading as the
     TaskDialogs entry above it. Listed rather than pattern-matched away:
     telling a conversion from a render by its shape is exactly the
     false-positive factory that gets a guard muted. */
  "components/platform/ProjectDetail.tsx": 2,
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

  it("every row names a file that is still in the tree", () => {
    /*
     * THE HOLE THE CHECK ABOVE CANNOT SEE (2026-09-10), and an entry in the
     * list already promised this assertion existed ("the list asserts its
     * entries name real files, so a stale row goes red") while it did not.
     *
     * The loop walks the TREE and looks each file's row up, so it fires in both
     * directions for a file that exists and in NEITHER for a row whose file is
     * gone. One such row was sitting in the list — `echo/SummariesSection.tsx`,
     * a file on no branch — reading as a considered decision about a screen that
     * does not exist. This is the stale-entry direction the list already claims
     * to fail in, said about the other kind of staleness, and it is four lines.
     */
    const missing = Object.keys(REMAINING).filter((rel) => !existsSync(join(SRC, rel)));
    expect(missing, "a row whose file is gone covers nothing — delete it").toEqual([]);
  });
});
