import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE CLASS, ONE RULE (after the `.chip` collision of 2026-09-17).
 *
 * Design «ج» added a `.chip` for the toolbar's second row — outlined, 24
 * tall, a pointer — beside a `.chip` that globals.css had carried since
 * 2026-09-03 as THE THEME'S BADGE (the calls page's share codes, the skills
 * page's tool names, the Hub's agent names). Neither rule was wrong and the
 * screen was: the later rule won the font size and the padding, so the kit's
 * chip rendered a size its own test did not name, and every badge in the
 * product grew a hairline, a fixed height and a pointer it never asked for.
 * Typecheck, 1796 tests and the build gate were green throughout — a second
 * rule for a class is valid CSS, and only the computed value disagrees (the
 * artifact-reads-as-satisfied class, one layer down from `text-on-accent`).
 *
 * The rule: a plain class selector (`.name {`) is defined ONCE in
 * globals.css, at the same at-rule context. A redefinition INSIDE an
 * `@media` or `@supports` block is the override it looks like (reduced
 * motion, the print sheet) and is not a duplicate; a second top-level rule
 * is. Comments are stripped before reading, so prose about a class is not a
 * copy of it (the name-matching-itself trap, pointed the other way).
 */
const CSS_PATH = join(process.cwd(), "src", "app", "globals.css");

/** Plain class selectors defined more than once at the same at-rule context. */
export function duplicatedClassRules(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const seen = new Map<string, number>();
  const dupes = new Set<string>();
  // The at-rule context is the stack of @media/@supports (and the like)
  // blocks the cursor is inside; @layer is transparent — every rule in
  // this file sits in one, and a layer is not a condition.
  const context: string[] = [];
  const stack: Array<"context" | "rule"> = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    const close = text.indexOf("}", i);
    if (open === -1 && close === -1) break;
    if (close !== -1 && (open === -1 || close < open)) {
      if (stack.pop() === "context") context.pop();
      i = close + 1;
      continue;
    }
    const start = Math.max(text.lastIndexOf("}", open), text.lastIndexOf("{", open - 1), text.lastIndexOf(";", open)) + 1;
    const selector = text.slice(start, open).trim();
    if (selector.startsWith("@")) {
      const transparent = /^@layer\b/.test(selector);
      stack.push(transparent ? "rule" : "context");
      if (!transparent) context.push(selector.replace(/\s+/g, " "));
    } else {
      stack.push("rule");
      const m = /^\.([A-Za-z0-9_-]+)$/.exec(selector);
      if (m) {
        const key = `${context.join(" > ")}|.${m[1]}`;
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        if (n > 1) dupes.add(`.${m[1]}${context.length ? ` (inside ${context.join(" > ")})` : ""}`);
      }
    }
    i = open + 1;
  }
  return [...dupes].sort();
}

describe("globals.css — one class, one rule", () => {
  it("names a class defined twice at one context and ignores a media override", () => {
    // The check must be able to answer YES before its NO is believed.
    expect(duplicatedClassRules(".a { x: 1 } .b { x: 2 } .a { x: 3 }")).toEqual([".a"]);
    expect(duplicatedClassRules(".a { x: 1 } @media (prefers-reduced-motion: reduce) { .a { x: 0 } }")).toEqual([]);
    expect(duplicatedClassRules("@layer components { .a { x: 1 } } @layer components { .a { x: 2 } }")).toEqual([".a"]);
    expect(duplicatedClassRules("/* .a { } */ .a { x: 1 }")).toEqual([]);
    expect(duplicatedClassRules(".a { x: 1 } .a:hover { x: 2 } [data-theme=\"light\"] .a { x: 3 }")).toEqual([]);
  });

  it("defines every plain class once in globals.css", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    // Had something to check: the file defines the kit.
    expect((css.match(/^\s*\.[A-Za-z0-9_-]+\s*\{/gm) ?? []).length).toBeGreaterThan(50);
    expect(duplicatedClassRules(css)).toEqual([]);
  });
});
