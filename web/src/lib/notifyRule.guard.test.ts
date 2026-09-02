import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY OUTCOME GOES TO THE NOTIFICATION BUS.
 *
 * User directive, 2026-09-02: "any notification from buttons that saved,
 * deleted or any changes must come out of notification — make it a rule for
 * the platform."
 *
 * It is a rule and not a habit because the alternative is what the platform
 * had: a green pill beside one Save button, a banner inside one card, a
 * toast on a 2.5-second timer in a third place. Three renderings of one idea,
 * each of them gone before somebody who looked away could read it, and none
 * of them anywhere the bell could keep.
 *
 * What this catches is the SHAPE those all share — a piece of component state
 * called `saved`/`flash` that is set true and cleared on a timer. That is the
 * ad-hoc confirmation, and it is the thing a new screen reinvents without
 * meaning to.
 *
 * What it deliberately does NOT catch: `setError`, which is a different
 * subject. An error belongs beside the control that refused, where the person
 * is already looking and can act on it — a refusal that flew past as a toast
 * is a refusal nobody read.
 */
const SRC = join(process.cwd(), "src");

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** `const [saved, setSaved] = useState` and its family */
const AD_HOC_STATE = /const \[(saved|flash|toast|justSaved|showSaved)\b/;

describe("a save, a delete or a change", () => {
  it("is announced through the bus, never as a component's own pill", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const code = codeOnly(readFileSync(file, "utf8"));
      if (AD_HOC_STATE.test(code)) {
        offenders.push(relative(SRC, file).split("\\").join("/"));
      }
    }
    expect(
      offenders,
      "these hold their own confirmation state — call notify() instead:\n"
      + offenders.join("\n"),
    ).toEqual([]);
  });

  it("has something to check — the bus is actually used", () => {
    /* The vacuum guard. If `notify` were renamed or the lib moved, the rule
       above would pass over a platform that had stopped following it, and a
       green suite would mean nothing at all. */
    let callers = 0;
    for (const file of sources(SRC)) {
      if (/\bnotify\s*\(/.test(codeOnly(readFileSync(file, "utf8")))) callers += 1;
    }
    expect(callers).toBeGreaterThan(5);
  });
});
