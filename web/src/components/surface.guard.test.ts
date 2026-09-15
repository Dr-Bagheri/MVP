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
  // ── THE FLOATING LAYERS LEFT THIS LIST ON 2026-09-08 ──────────────────
  //
  // R23 (glass) took the border off every panel in the product: a menu, a
  // popover and a hand-rolled dialog all wear `.glass-chrome` now — the
  // translucent sheet plus their own island shadow — so the recipe this guard
  // counts is simply not written in them any more. Sixteen entries went, each
  // removed because the guard fired in the STALE-ENTRY direction, which is the
  // direction that keeps a list from quietly becoming bigger than the tree it
  // describes.
  //
  // ── fields wearing a card's corner: R5's business ────────────────────
  //
  // These STAY, and the reason is the one distinction R23 preserves: a card's
  // edge is decorative and a FIELD's is a control boundary. Every sheet lost
  // its outline; a text box did not, because on a translucent panel the ground
  // inside an unbordered field is the ground behind it.
  "components/platform/tasks/TaskDetail.tsx": 2,  // the title and description editors
  "components/platform/tasks/TaskDialogs.tsx": 1, // the label field (the label popover is glass now)
  // The minutes' own edit box, and the same distinction: this is the <textarea>
  // a presenter rewrites the summary in, not a panel around it.
  "components/platform/meeting/Summary.tsx": 1,   // the summary's edit box (R5)
  // ── the shell, the assistant's composer (the detail frame, R18, stands on
  //    Overlay since 2026-09-06 and draws no card of its own — its entry left
  //    when the guard fired in the stale-entry direction) ──
  // IconRail's entry LEFT on 2026-09-08 with the shape it named: the rail is
  // 72px of labelled glyphs now, so the 248px sidebar's workspace card and
  // person card are gone and it draws none. Deleted rather than zeroed — a
  // zero row reads as coverage and is a hole, and this list fires in the
  // stale-entry direction, which is how it caught the change.
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

  it("the tile is a card: the token's corner, the card family's depth, no border", () => {
    /*
     * globals.css uses no theme(), so `.tile` carries a literal — and it
     * carried 20 for three days after the token moved to 18. Read the rule
     * body itself rather than trusting the comment beside it.
     *
     * The SHADOW half moved from `--shadow-card` to `--shadow-glass` with R23
     * (2026-09-08), and the check's MEANING did not change: a tile wears
     * whatever a card wears, and a card wears the glass depth now. The two
     * assertions under it are new — a sheet's boundary is the lit lip inside
     * that shadow, so a `border:` creeping back onto `.tile` is the bordered
     * look returning one declaration at a time, which is exactly how `.tile`
     * drifted to a 20px corner in the first place.
     */
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const tile = css.match(/\n\.tile \{([\s\S]*?)\n\}/);
    expect(tile, ".tile rule").not.toBeNull();
    const body = tile![1]!.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).toMatch(new RegExp(`border-radius:\\s*${SCAFFOLD.radius.modal}px;`));
    expect(body).toMatch(/box-shadow:\s*var\(--shadow-glass\);/);
    expect(body).toMatch(/backdrop-filter:\s*var\(--glass-filter\);/);
    expect(body, "a sheet has no outline").not.toMatch(/(?:^|\s)border:/);
    /* and the shapes exist where the components expect them */
    expect(css).toMatch(/\n  \.card-row \{/);
    expect(css).toMatch(/\n  \.well \{/);
    expect(css).toMatch(/\n  \.glass \{/);
    expect(css).toMatch(/\n  \.glass-chrome \{/);
    /*
     * The QUIET sheet (2026-09-08): the shell's third tone, for a column that
     * is chrome by position and page by tone. Its alpha is asserted as a
     * RELATIONSHIP rather than a value — the requirement is that it sits
     * between the page ground and the chrome, and a literal here would go
     * stale the first time either end is tuned. Both themes must declare it,
     * or one of them silently inherits the other's.
     */
    expect(css).toMatch(/\n  \.glass-soft \{/);
    const soft = [...css.matchAll(/--glass-soft-alpha:\s*([\d.]+);/g)].map((m) => Number(m[1]));
    const chrome = [...css.matchAll(/--glass-alpha:\s*([\d.]+);/g)].map((m) => Number(m[1]));
    expect(soft.length, "both themes declare the quiet alpha").toBeGreaterThanOrEqual(2);
    expect(chrome.length, "both themes declare the sheet alpha").toBeGreaterThanOrEqual(2);
    expect(Math.max(...soft), "the quiet sheet is not quieter than the chrome")
      .toBeLessThan(Math.min(...chrome));
  });
});
