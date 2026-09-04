import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * **The page rhythm belongs to the scaffold, and to nothing else.**
 *
 * This test exists because of what the inventory found on 2026-08-27: the
 * page column had been COPIED into five surfaces, the copies froze at the
 * value the original had before a one-line bump, and every one of those
 * screens sat 12px higher than the rest of the platform. Nothing went red,
 * because nothing had ever asserted `PageContainer`'s classes — so "the
 * margins and spaces everywhere is unset" was true and invisible at the
 * same time.
 *
 * Two rules, both narrow enough that a pass means something:
 *
 *  1. the NAMED steps (`px-page-inline`, `pt-page`, …) may only be written
 *     inside the scaffold — anywhere else is a surface re-implementing the
 *     page column instead of rendering inside it;
 *  2. the OLD hand-rolled spelling (`pb-16`, `md:px-10`, `md:pt-7`) may not
 *     come back anywhere, since those are the literals the copies were made
 *     of.
 *
 * Exceptions are ENTRIES WITH REASONS, never a loosened pattern — a false
 * positive here would get this file muted inside a week, which is worse
 * than not having it.
 */

const WEB = join(process.cwd(), "src");
const SCAFFOLD = join(WEB, "components", "scaffold");

/** Named steps: theirs to write, nobody else's. */
const RHYTHM = [
  "px-page-inline", "px-page-inline-md",
  "pt-page", "pt-page-sm", "pt-page-menu",
  "pb-page-bottom",
  /* the SECTION SCROLL's height (2026-08-29). Same rule for the same reason:
     the record page had already grown one hand-written
     `max-h-[calc(100dvh-13rem)]`, and a section that picks its own height is
     the page column's story repeating one level down. `SectionScroller` is
     the only place this may be written. */
];

/**
 * Surfaces allowed to compose the rhythm themselves, each because it is NOT
 * a page in the scaffold's sense. Anything not listed here must render
 * inside `PageContainer` and therefore never names a step.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  /* Hub.tsx LEFT this list on 2026-09-02: the assistant page renders it
     inside <PageContainer width="small"> now, so it names no rhythm step of
     its own. An allow-list entry for a file that no longer deviates reads as
     coverage and is a hole — which is exactly what the assertion below
     exists to catch, and did. */
  /*
   * Hub.tsx is BACK, for one line and a different reason from the copies this
   * guard was built to catch (2026-09-04).
   *
   * It does not draw a page column — the assistant page's PageContainer does.
   * What it names the step for is the opposite: the thread's scroller pulls
   * ITSELF OUT of that padding with `-mx-page-inline` and puts it back with
   * `px-page-inline`, so the scrollbar lands at the column's edge where a page
   * scrollbar belongs instead of floating 28px inside it.
   *
   * A negative margin that must equal the container's padding is exactly the
   * case for naming the step rather than typing 28px — the number has to move
   * WITH the rhythm or the bar drifts back inside. The literal is what this
   * guard forbids; the token is what it exists to make possible.
   */
  "components/platform/Hub.tsx":
    "the thread's scroller negates the page gutter to put its scrollbar at the column edge, and must move with the rhythm rather than pin a literal",
  "app/[locale]/platform/page.tsx":
    "the operations console renders outside PlatformShell entirely — the vendor's room, not a product page — and still owes the product's gutters",
};

/** The literals the five copies were made of. Their return means a new copy. */
const LEGACY = ["pb-16", "md:px-10", "md:pt-7", "md:pt-4"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(WEB).map((full) => ({
  rel: full.slice(WEB.length + 1).replace(/\\/g, "/"),
  full,
  /* COMMENTS STRIPPED before any pattern sees the text (2026-09-02). The
     guard's first true fire after the Hub stopped drawing its own rhythm was
     a COMMENT in Hub.tsx that mentioned `pb-page-bottom` while explaining
     why the hub does not use it — the name matching itself, the same trap
     the stacking guard fell into on its first run. A checker that reads
     prose as code manufactures false positives, and one of those gets muted
     within a week. */
  text: readFileSync(full, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " "),
  inScaffold: full.startsWith(SCAFFOLD),
}));

describe("the page rhythm is the scaffold's", () => {
  it("has files to check at all", () => {
    /* the vacuous-checker guard: an empty corpus passes every assertion
       below while proving nothing about the app */
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.inScaffold)).toBe(true);
  });

  it("names its steps only inside the scaffold, or in a listed exception", () => {
    const offenders = files
      .filter((f) => !f.inScaffold)
      .filter((f) => ALLOWED[f.rel] === undefined)
      .filter((f) => RHYTHM.some((step) => f.text.includes(step)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("every exception is a real file — a stale reason is a rule about nothing", () => {
    /* an allow-list entry for a file that no longer exists reads as coverage
       and is a hole; this is the entry's own expiry check */
    const present = new Set(files.map((f) => f.rel));
    expect(Object.keys(ALLOWED).filter((rel) => !present.has(rel))).toEqual([]);
  });

  it("does not let the old hand-rolled page padding come back", () => {
    const offenders = files
      .filter((f) => LEGACY.some((cls) => new RegExp(`(^|["'\\s])${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'\\s]|$)`).test(f.text)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("keeps ONE page container — nobody re-implements the column", () => {
    /* the signature of the five copies, verbatim */
    const offenders = files
      .filter((f) => !f.inScaffold)
      .filter((f) => /mx-auto w-full max-w-content(-wide)? px-/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

/**
 * THE SHELL SCROLL's guard half (user directive, 2026-08-28: the menu and
 * sub-menu hold still; only the content scrolls). The behaviour lives in
 * MenuLayout and PlatformShell; what a guard can catch textually is the
 * graver regression: a surface declaring its own viewport-height ROOT — a
 * second shell, which is how a page grows its own scroll model and the menu
 * starts moving again. Inner `overflow-y-auto` boxes are deliberately NOT
 * policed (see scaffold.test.tsx for why: no pattern separates them from a
 * page scroller without manufacturing false positives).
 */
const VIEWPORT_ROOT = /(^|["'\s])(?:min-)?h-(?:dvh|screen|\[100[dsl]?vh\])(["'\s]|$)/;

/** Surfaces allowed a viewport-height root, each because it is not a page
 *  INSIDE the shell. Anything else renders under PlatformShell and inherits
 *  its scroll model. */
const SHELL_ALLOWED: Readonly<Record<string, string>> = {
  "components/platform/PlatformShell.tsx":
    "the shell itself — its h-dvh root is what keeps the document from ever scrolling",
  "app/[locale]/platform/page.tsx":
    "the vendor operations console renders outside PlatformShell entirely and owns its own document",
  "app/[locale]/(auth)/layout.tsx":
    "auth screens render before any shell exists",
  "app/[locale]/error.tsx":
    "the error boundary can mount when the shell itself failed to",
  "components/site/MarketingSite.tsx":
    "the company's front page renders outside PlatformShell entirely — it is a "
    + "document a stranger scrolls, not a page inside the shell's scroll model",
  "app/[locale]/join/[code]/page.tsx":
    "the guest door (0158) renders outside PlatformShell — the person here has "
    + "no account, so every element of the shell would be a door that refuses "
    + "them; it owns its own document the way the auth screens do",
};

describe("the shell scroll belongs to the shell", () => {
  it("no surface declares a second viewport-height root", () => {
    const offenders = files
      .filter((f) => SHELL_ALLOWED[f.rel] === undefined)
      .filter((f) => VIEWPORT_ROOT.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the pattern still recognises the real shell — a guard matching nothing guards nothing", () => {
    /* the negative-control rule: if a class rename ever makes this regex
       blind, this fails instead of the guard passing vacuously forever */
    const shell = files.find((f) => f.rel === "components/platform/PlatformShell.tsx");
    expect(shell).toBeDefined();
    expect(VIEWPORT_ROOT.test(shell!.text)).toBe(true);
  });

  it("every shell exception is a real file — a stale reason is a rule about nothing", () => {
    const present = new Set(files.map((f) => f.rel));
    expect(Object.keys(SHELL_ALLOWED).filter((rel) => !present.has(rel))).toEqual([]);
  });

  it("the shell still pins the document: h-dvh root, one min-h-0 scroll column", () => {
    /* class-string pins, jsdom's honest ceiling — the computed behaviour was
       measured on the live render when this landed.

       2026-09-03: the root briefly gained `md:pe-[var(--assistant-rail)]` for
       the assistant's column, and lost it again the same day when the sidebar
       was made to float rather than push. The pin stays the SUBSTRING it was
       always about — `flex h-dvh bg-bg text-fg` still opens the class list —
       rather than the whole quoted attribute, which pinned the absence of
       every future utility along with it. */
    const shell = files.find((f) => f.rel === "components/platform/PlatformShell.tsx")!;
    expect(shell.text).toContain('"flex h-dvh bg-bg text-fg');
    expect(shell.text).toContain("min-h-0 flex-1 overflow-y-auto");
  });
});
