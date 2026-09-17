import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * **A BUTTON WEARS ONE OF THE KIT'S COATS, AND SPELLS NOTHING OF ITS OWN.**
 *
 * User, 2026-09-17: "i still feel it disconnected … fix it and make it unify
 * for all of it". The census that morning: 278 button sites in 133 distinct
 * class strings. Fifty-one had drawn an OUTLINED secondary by hand
 * (`border border-border text-fg-muted hover:text-fg`) on the tasks, projects
 * and meeting pages beside the fifty-nine wearing the kit's FILLED
 * `.btn-secondary` everywhere else; twenty-five had drawn the green primary
 * with a shadow and a heavier weight than `.btn-primary`; twenty-one spelled a
 * ghost out; and the dialog kit's own `FOOTER_CANCEL` said outlined where the
 * page kit said filled. Nobody was careless — the kit had four coats and the
 * screens needed seven, so every screen drew the other three. That is exactly
 * the mechanism `control.guard` records for SIZES, one property over.
 *
 * The seven coats are written in `globals.css` and nowhere else. This file
 * refuses, in any `className` that carries a `btn` token, every token that
 * spells a GROUND, an EDGE, a SHADOW, an INK or a WEIGHT — with or without a
 * `hover:`/`active:`/`disabled:` prefix — outside the kit files that compose
 * pills from `btn` on purpose. Layout tokens (widths, margins, flex, position,
 * visibility) are none of this file's business.
 *
 * Verified red before it was trusted: staging `btn bg-accent text-on-accent`
 * back into Summary.tsx named the file and the token; the synthetic control
 * below keeps the detector able to answer NO after the staging was removed.
 */

const SRC = join(process.cwd(), "src");

/** files that COMPOSE a pill from `btn` and legitimately spell its lift */
const KIT_FILES: Readonly<Record<string, string>> = {
  "components/platform/sectionTabs.tsx":
    "the two sub-menu rails: the lifted pill IS `btn btn-sm` plus its surface tone and card shadow — the kit's own spelling, read by every toolbar",
  "components/platform/tasks/panelStyle.ts":
    "`chipClass`, the dialog's selection chip — a chosen state that changes ground and edge and never size, the 2026-09-05 panel measurement",
};

/** a token that is a COAT's business */
const COAT_TOKEN =
  /^(?:hover:|active:|focus:|disabled:|disabled:hover:|group-hover:)?(?:bg-[\w\/.\[\]-]+|border|border-(?:border|border-strong|accent|dashed|danger|success)(?:\/\d+)?|shadow-(?:accent|sm|md|card|island)|text-(?:fg|fg-muted|fg-subtle|accent|on-accent|on-primary|danger|success|warn)|font-(?:normal|medium|semibold|bold)|opacity-\d+)$/;

const BTN_TOKEN = /^btn(?:-(?:primary|secondary|ghost|danger|soft|dashed|ghost-danger|xs|sm|icon|icon-sm|icon-lg))?$/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** every className string literal carrying a btn token, with its offenders */
export function offendingCoats(text: string): Array<{ cls: string; tokens: string[] }> {
  const out: Array<{ cls: string; tokens: string[] }> = [];
  for (const m of text.matchAll(/className="([^"]*)"/g)) {
    const tokens = m[1]!.split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => BTN_TOKEN.test(t))) continue;
    const bad = tokens.filter((t) => COAT_TOKEN.test(t));
    if (bad.length > 0) out.push({ cls: m[1]!, tokens: bad });
  }
  return out;
}

describe("a button wears one of the kit's coats (2026-09-17)", () => {
  const all = files(SRC);

  it("had something to check: the tree carries hundreds of buttons", () => {
    const n = all.reduce((sum, f) => sum + (readFileSync(f, "utf8").match(/className="[^"]*\bbtn\b/g)?.length ?? 0), 0);
    expect(n).toBeGreaterThan(150);
  });

  it("spells no ground, edge, shadow, ink or weight beside `btn` outside the kit files", () => {
    const findings: string[] = [];
    for (const f of all) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      if (rel in KIT_FILES) continue;
      for (const o of offendingCoats(readFileSync(f, "utf8"))) {
        findings.push(`${rel}: «${o.cls}» carries ${o.tokens.join(", ")} — use a kit coat (btn-primary / btn-secondary / btn-ghost / btn-soft / btn-dashed / btn-danger / btn-ghost-danger)`);
      }
    }
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("the kit files still exist — an exception naming a deleted file reads as coverage and is a hole", () => {
    for (const rel of Object.keys(KIT_FILES)) {
      expect(() => statSync(join(SRC, rel)), rel).not.toThrow();
    }
  });

  it("the detector can answer NO: a staged hand-drawn coat is named", () => {
    /* the control — without it, an empty findings list is indistinguishable
       from a detector that cannot see class strings at all */
    const staged = `<button className="btn btn-sm border border-border text-fg-muted hover:text-fg">x</button>`;
    expect(offendingCoats(staged)).toEqual([
      { cls: "btn btn-sm border border-border text-fg-muted hover:text-fg", tokens: ["border", "border-border", "text-fg-muted", "hover:text-fg"] },
    ]);
    expect(offendingCoats(`<button className="btn-secondary btn-sm shrink-0 gap-1.5">x</button>`)).toEqual([]);
    /* and a class string with no btn at all is not its subject */
    expect(offendingCoats(`<span className="border border-border text-fg-muted">x</span>`)).toEqual([]);
  });
});
