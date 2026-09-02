import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE BROWSER'S DIALOGS NEVER APPEAR IN THIS PRODUCT.
 *
 * User directive, 2026-09-02, on a screenshot of one: "this top pop up should
 * never appear anywhere in the platform … fix it like the new column that you
 * wrote there."
 *
 * `window.prompt` / `confirm` / `alert` are the browser's windows, not ours,
 * and every property of them is wrong here:
 *   - the title says "app.neurai.pt says", which is the browser telling the
 *     reader that something is talking AT them from a page;
 *   - they are unstyled — no theme, no dark mode, no RTL, no Persian type;
 *   - they block the page thread while they are up;
 *   - they cannot carry a second answer, a hint, or a refusal message, so the
 *     first requirement past "one short string" forces a rewrite anyway.
 *
 * The platform has two right answers already: an inline composer where the
 * thing being named will appear (the task board's column, and now its topic),
 * and `ConfirmDialog`, whose `body` takes a whole form precisely so a question
 * that needs an ANSWER does not have to invent a second kind of window.
 *
 * `window.print` is deliberately NOT here: it is not a dialog we are
 * substituting for, it is the only way to reach the printer.
 */
const SRC = join(process.cwd(), "src");

function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/* both spellings: `window.prompt(` and a bare `prompt(` at a call position.
   The bare form needs the boundary or it matches `.prompt(` on our own
   objects — an agent's prompt is a field name, not a browser dialog. */
const NATIVE = /(?:\bwindow\s*\.\s*(?:prompt|confirm|alert)\s*\(|(?<![.\w])(?:prompt|confirm|alert)\s*\()/;

describe("native browser dialogs", () => {
  it("has something to check — the replacements are in use", () => {
    let users = 0;
    for (const file of sources(SRC)) {
      if (/<ConfirmDialog\b/.test(codeOnly(readFileSync(file, "utf8")))) users += 1;
    }
    expect(users).toBeGreaterThan(5);
  });

  it("appear nowhere in the product", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      if (NATIVE.test(codeOnly(readFileSync(file, "utf8")))) {
        offenders.push(relative(SRC, file).split("\\").join("/"));
      }
    }
    expect(
      offenders,
      "use an inline composer or ConfirmDialog:\n" + offenders.join("\n"),
    ).toEqual([]);
  });
});
