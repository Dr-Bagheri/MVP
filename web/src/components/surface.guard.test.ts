import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SCAFFOLD } from "@/components/scaffold/constants";

/**
 * R7 — THREE SURFACES AND NOTHING ELSE (2026-09-05).
 *
 * `.card` (a page block), `.card-row` (a card in a list), `.well` (a row inside
 * a card). The day this was written, seventy className strings in the tree
 * drew a card by hand — `rounded-xl|2xl border … bg-surface …` — in two
 * corners, with shadows by accident and five different grounds. Nobody was
 * careless; the theme offered one class and screens needed three shapes, so
 * every screen drew the other two. The three exist now, and this file keeps
 * the recipe out of the components.
 *
 * WHAT COUNTS: a class string carrying a card corner AND a border AND a surface
 * ground. Anything narrower fires on chips and inputs; anything broader misses
 * the recipe written with `bg-surface-2/40`. WHAT STAYS, as entries with
 * reasons: the floating layers (menus and popovers wear the island shadow and
 * belong to R10), the hand-rolled dialog panels (R8's second pass), the two
 * text editors that are FIELDS (R5), the one detail frame, the shell's rail,
 * and the assistant's composer (a structural exception by ruling).
 *
 * The list fails in BOTH directions, like the control guard's: more than
 * recorded is a regression, fewer is a stale entry making the guard smaller
 * than it looks.
 */
const SRC = join(process.cwd(), "src");

const RECIPE = /className=(?:"([^"]*)"|\{`([^`]*)`)/g;
const isCard = (cls: string): boolean =>
  /\brounded-(?:xl|2xl)\b/.test(cls) && /\bborder\b/.test(cls) && /\bbg-surface\b|\bbg-surface-2(?:\/\d+)?\b/.test(cls);

const REMAINING: Record<string, number> = {
  // ── floating layers: the island shadow, R10's business ────────────────
  "components/DateTimeFields.tsx": 2,          // the date and time popovers
  "components/Select.tsx": 1,                  // the listbox panel
  "components/platform/AvatarMenu.tsx": 1,     // the account menu panel
  "components/platform/NotificationBell.tsx": 1, // the bell's panel
  "components/platform/chat/Composer.tsx": 1,  // the emoji panel
  "components/platform/TaskBoard.tsx": 1,      // the column-tone popover
  "components/platform/tasks/JalaliPicker.tsx": 1, // the calendar popover
  "components/platform/meeting/Whiteboard.tsx": 2, // the two floating toolbars over the canvas
  // ── dialog panels drawn by hand, NOT on Overlay: R8's second pass ────
  "components/platform/SetMemberPassword.tsx": 1,
  "components/platform/TourOverlay.tsx": 1,
  "components/platform/WorkflowBuilder.tsx": 1,
  "components/platform/WorkflowRunDialog.tsx": 1,
  "app/[locale]/platform/page.tsx": 1,
  // ── the two dialog panels the theme DOES own (R8): the corner is the dialog's,
  //    the ground is the surface — a dialog is a floating card, not a card ──
  "components/platform/Overlay.tsx": 1,        // the Overlay panel
  "components/rowActions.tsx": 1,              // the confirm dialog's panel
  // ── fields wearing a card's corner: R5's business ────────────────────
  "components/platform/tasks/TaskDetail.tsx": 2,  // the title and description editors
  "components/platform/tasks/TaskDialogs.tsx": 2, // the label field (177) and the label popover (347)
  // ── the one detail frame (R18), the shell, the assistant's composer ──
  "components/platform/DetailPanel.tsx": 1,
  "components/platform/IconRail.tsx": 1,
  "components/platform/Hub.tsx": 1,            // the assistant is a structural exception by ruling
};

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

function handRolledCards(code: string): number {
  let n = 0;
  for (const m of code.matchAll(RECIPE)) {
    const cls = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
    if (isCard(cls)) n += 1;
  }
  return n;
}

describe("R7: three surfaces", () => {
  it("can tell a hand-rolled card from the things it must not claim", () => {
    expect(handRolledCards('<div className="rounded-2xl border border-border bg-surface p-6">')).toBe(1);
    expect(handRolledCards('<div className="mt-2 rounded-xl border border-border bg-surface-2/40 p-3">')).toBe(1);
    expect(handRolledCards('<div className={`min-w-0 rounded-xl border border-border bg-surface p-4 ${x ? "a" : "b"}`}>')).toBe(1);
    /* the theme's own shapes */
    expect(handRolledCards('<div className="card">')).toBe(0);
    expect(handRolledCards('<div className="card-row flex items-center gap-2">')).toBe(0);
    expect(handRolledCards('<div className="well p-3">')).toBe(0);
    /* a chip, an input, a plain rounded box with no surface ground */
    expect(handRolledCards('<span className="rounded-full border border-border px-2">')).toBe(0);
    expect(handRolledCards('<input className="input rounded-md border bg-field">')).toBe(0);
    expect(handRolledCards('<div className="rounded-xl bg-surface p-3">')).toBe(0);
  });

  it("no file draws MORE cards by hand than its recorded count, and none fewer", () => {
    const wrong: string[] = [];
    for (const file of sources(SRC)) {
      if (file.split(/[\\/]/).includes("ui")) continue; // shadcn source owns its own panels
      const rel = relative(SRC, file).split("\\").join("/");
      const found = handRolledCards(readFileSync(file, "utf8"));
      const allowed = REMAINING[rel] ?? 0;
      if (found > allowed) wrong.push(`${rel}: ${found} hand-rolled, ${allowed} recorded`);
      if (found < allowed) wrong.push(`${rel}: ${found} hand-rolled but ${allowed} recorded — lower the number`);
    }
    expect(
      wrong,
      "use .card / .card-row / .well (or the island-shadowed floating shapes of R8/R10):\n" + wrong.join("\n"),
    ).toEqual([]);
  });

  it("the tile is a card: the token's corner, the card's shadow", () => {
    /*
     * globals.css uses no theme(), so `.tile` carries a literal — and it
     * carried 20 for three days after the token moved to 18. Read the rule
     * body itself rather than trusting the comment beside it.
     */
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const tile = css.match(/\n\.tile \{([\s\S]*?)\n\}/);
    expect(tile, ".tile rule").not.toBeNull();
    const body = tile![1]!.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).toMatch(new RegExp(`border-radius:\\s*${SCAFFOLD.radius.modal}px;`));
    expect(body).toMatch(/box-shadow:\s*var\(--shadow-card\);/);
    /* and the three shapes exist where the components expect them */
    expect(css).toMatch(/\n  \.card-row \{/);
    expect(css).toMatch(/\n  \.well \{/);
  });
});
