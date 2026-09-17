import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * **A HEADING WEARS ONE OF FIVE ROLES, AND SPELLS NO SIZE OF ITS OWN.**
 *
 * User, 2026-09-17: "i still feel it disconnected". Forty-six distinct heading
 * class strings were counted that morning across 107 headings — `text-lg
 * font-bold` on four dialogs beside `text-base font-semibold` on three,
 * `text-sm font-semibold` on Home's cards beside `.h-section` on Settings',
 * green bold numbered headings on the summary tab, `text-2xl` and `text-xl` on
 * the gate. Each was the right size for its author's eye on its author's day,
 * which is what forty-six spellings of five things looks like.
 *
 * The five are `globals.css`: `.h-page`, `.h-dialog`, `.h-section`, `.h-card`,
 * `.h-label`. This file refuses a SIZE, WEIGHT, INK or LEADING utility on any
 * `<h1..h4 className="…">` outside three named files — and refuses a heading
 * that wears none of the five, because a bare `<h3>` inherits the body and is
 * a heading you can only find by reading.
 *
 * The exceptions carry their reasons and are checked to still exist: an entry
 * naming a deleted file reads as coverage and is a hole.
 */

const SRC = join(process.cwd(), "src");

const EXCEPTIONS: Readonly<Record<string, string>> = {
  /* SummaryBody.tsx and markdown.tsx were entries here for one afternoon:
     "the models' own headings scale with the prose they sit in". Read on
     production, that gave the summary card a prose sub-heading at 17.8/700
     ABOVE the card's own numbered sections at 13.2/600 — a ladder that
     climbs as it descends. Rendered content is chrome the moment it sits
     inside a card with headings of its own; both wear `.h-card` now. */
  "components/onboarding/bits.tsx":
    "the first-time flow's own frame (RULEBOOK 1a): its title is the reveal's, drawn once, outside the shell",
  "app/[locale]/(auth)/DemoPanel.tsx":
    "the gate's demo half, outside the shell — the film's caption line, not a product heading",
  "components/platform/home/HomeSnapshot.tsx":
    "the hub's greeting («صبح بخیر، …») is the one large line in the product by ruling (the assistant and the dashboard may differ in STRUCTURE); the card titles in the same file DO wear h-card",
};

const ROLE = /^h-(?:page|dialog|section|card|label)$/;
const FORBIDDEN =
  /^(?:text-(?:xs|sm|base|lg|xl|2xl|3xl|\[[^\]]+\]|page-title|section-title|pane-title|group-label|detail|caption|micro|fg|fg-muted|fg-subtle|accent)|font-(?:normal|medium|semibold|bold|extrabold)|leading-[\w.\[\]-]+)$/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Template literals are NOT the product's chrome: the call page builds an
 * exported HTML document in one, and the rich-text editor serialises its
 * own `<h3>` in another. A heading written INSIDE a backtick string is a
 * document somebody downloads, and its size is that document's business
 * (`minutesDocument.ts` says so at length). Stripped before the scan, the
 * way `board.guard` strips comments — and a control below proves the strip
 * cannot hide a real heading.
 */
function withoutTemplateLiterals(source: string): string {
  /* comments first: this tree's prose comments quote class names in
     backticks, and an unbalanced one would open a "template literal" that
     swallowed the code after it — a heading hidden by a sentence about one */
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  /* a regex cannot pair the backticks of a literal NESTED inside another's
     `${…}` (the call page's export builds one that way), so this walks:
     inside a literal everything is dropped until its own closing backtick,
     a `${` opens an expression whose code is kept and whose braces are
     counted, and a backtick inside that expression opens a nested literal */
  let out = "";
  const stack: Array<{ kind: "tpl" } | { kind: "expr"; depth: number }> = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const top = stack[stack.length - 1];
    if (top?.kind === "tpl") {
      if (ch === "\\") { i++; continue; }
      if (ch === "`") { stack.pop(); continue; }
      if (ch === "$" && text[i + 1] === "{") { stack.push({ kind: "expr", depth: 0 }); i++; continue; }
      continue;
    }
    if (ch === "`") { stack.push({ kind: "tpl" }); continue; }
    if (top?.kind === "expr") {
      if (ch === "{") top.depth++;
      else if (ch === "}") { if (top.depth === 0) { stack.pop(); continue; } top.depth--; }
    }
    out += ch;
  }
  return out;
}

export function offendingHeadings(source: string): string[] {
  const text = withoutTemplateLiterals(source);
  const out: string[] = [];
  for (const m of text.matchAll(/<h[1-4]\b[^>]*?className="([^"]*)"/g)) {
    const tokens = m[1]!.split(/\s+/).filter(Boolean);
    const bad = tokens.filter((t) => FORBIDDEN.test(t));
    const role = tokens.some((t) => ROLE.test(t));
    if (bad.length > 0) out.push(`«${m[1]}» spells ${bad.join(", ")}`);
    else if (!role) out.push(`«${m[1]}» wears no heading role`);
  }
  /* a heading with NO className at all inherits the body — the same absence */
  /* not one inside a quoted STRING: the rich-text editor hands
     `formatBlock` the literal "<h3>", which is a command, not a heading */
  for (const m of text.matchAll(/(^|[^"'])(<h[1-4]\b(?![^>]*className=)[^>]*>)/g)) {
    out.push(`«${m[2]!.slice(0, 40)}» has no className — no role`);
  }
  return out;
}

describe("a heading wears one of five roles (2026-09-17)", () => {
  const all = files(SRC);

  it("had something to check", () => {
    const n = all.reduce((sum, f) => sum + (readFileSync(f, "utf8").match(/<h[1-4]\b/g)?.length ?? 0), 0);
    expect(n).toBeGreaterThan(60);
  });

  it("every heading outside the named exceptions wears a role and spells nothing else", () => {
    const findings: string[] = [];
    for (const f of all) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      if (rel in EXCEPTIONS) continue;
      for (const o of offendingHeadings(readFileSync(f, "utf8"))) findings.push(`${rel}: ${o}`);
    }
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("the exceptions still name real files", () => {
    for (const rel of Object.keys(EXCEPTIONS)) expect(() => statSync(join(SRC, rel)), rel).not.toThrow();
  });

  it("the detector can answer NO", () => {
    expect(offendingHeadings(`<h2 className="text-lg font-bold text-fg">x</h2>`)).toEqual([
      "«text-lg font-bold text-fg» spells text-lg, font-bold, text-fg",
    ]);
    expect(offendingHeadings(`<h3 className="mb-2">x</h3>`)).toEqual(["«mb-2» wears no heading role"]);
    expect(offendingHeadings(`<h3>x</h3>`)).toEqual(["«<h3>» has no className — no role"]);
    /* a quoted "<h3>" is a string somebody hands to an editor command */
    expect(offendingHeadings(`exec("formatBlock", v === "h" ? "<h3>" : "<p>")`)).toEqual([]);
    expect(offendingHeadings(`<h2 className="h-dialog truncate">x</h2>`)).toEqual([]);
    /* a heading inside a TEMPLATE LITERAL is a document, not chrome — and the
       strip must not swallow the JSX heading that follows the string */
    expect(offendingHeadings([
      "const html = `<h1 style=\"margin:0\">${title}</h1>`;",
      "<h2 className=\"text-lg font-bold\">x</h2>",
    ].join("\n"))).toEqual([
      "«text-lg font-bold» spells text-lg, font-bold",
    ]);
    /* NESTED: a literal inside another's `${…}` — the call page's export —
       must be skipped whole, and the walk must come back out to the code */
    expect(offendingHeadings([
      "const html = `<body>${summary ? `<h2>${esc(t(\"summary\"))}</h2>` : \"\"}</body>`;",
      "<h2 className=\"h-section\">x</h2>",
      "<h2 className=\"text-lg\">y</h2>",
    ].join("\n"))).toEqual(["«text-lg» spells text-lg"]);
    /* and a comment quoting one backtick must not swallow the heading below it */
    expect(offendingHeadings([
      "/* the kit's `h-card role */",
      "// see `sectionTabClass",
      "<h2 className=\"text-lg\">z</h2>",
    ].join("\n"))).toEqual(["«text-lg» spells text-lg"]);
  });
});
