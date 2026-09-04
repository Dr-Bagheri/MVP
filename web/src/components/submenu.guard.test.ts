import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE CHEVRON ON A SUBMENU, AND IT MIRRORS.
 *
 * User report, 2026-09-04, on the meetings table: "there is a bug in the kebab
 * menu — we have two way arrow, make it one outward."
 *
 * Both were real. `ui/dropdown-menu.tsx` renders a `ChevronRight` inside every
 * `DropdownMenuSubTrigger`, and `rowActions` drew a second one in the trigger's
 * children — on a comment asserting that the first was applied "via a child
 * selector", which was simply wrong about a file eighteen lines long. Only the
 * hand-rolled one carried `rtl:-scale-x-100`, so on a Persian menu the two
 * pointed in opposite directions: one out of the menu, one into it.
 *
 * The duplicate is gone and the flip moved to the shared trigger. That second
 * half matters more than the first: three other files use this trigger and
 * never drew their own chevron, so every one of them had an arrow pointing the
 * wrong way on every Persian screen, and nobody had reported it.
 *
 * This check is cheap and the class of bug is not: a duplicated affordance
 * inside a shared primitive is invisible in review — each file looks correct
 * on its own — and only shows up rendered, in one writing direction.
 */
const SRC = join(process.cwd(), "src");
const PRIMITIVE = join(SRC, "components", "ui", "dropdown-menu.tsx");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** the body of every `<DropdownMenuSubTrigger …>…</DropdownMenuSubTrigger>` */
function subTriggerBodies(code: string): string[] {
  const out: string[] = [];
  const open = /<DropdownMenuSubTrigger\b/g;
  for (let m = open.exec(code); m; m = open.exec(code)) {
    const close = code.indexOf("</DropdownMenuSubTrigger>", m.index);
    if (close !== -1) out.push(code.slice(m.index, close));
  }
  return out;
}

describe("a submenu's arrow", () => {
  it("is drawn ONCE, by the shared trigger", () => {
    const primitive = readFileSync(PRIMITIVE, "utf8");
    expect(
      (primitive.match(/<ChevronRight\b/g) ?? []).length,
      "the shared sub-trigger must draw exactly one chevron",
    ).toBe(1);
  });

  it("and it mirrors, so it points OUT of the menu in both directions", () => {
    const primitive = readFileSync(PRIMITIVE, "utf8");
    const chevron = primitive.slice(primitive.indexOf("<ChevronRight"));
    expect(
      chevron.slice(0, chevron.indexOf("/>")),
      "a chevron that does not flip points into the menu it opens, in RTL",
    ).toContain("rtl:-scale-x-100");
  });

  it("no caller adds its own on top", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      if (file === PRIMITIVE) continue;
      for (const body of subTriggerBodies(readFileSync(file, "utf8"))) {
        /* any chevron INSIDE the trigger's children is a second arrow: the
           shared one is appended after them */
        if (/Chevron|IconChevron/.test(body)) {
          offenders.push(file.slice(SRC.length + 1).replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders, "the sub-trigger already draws one — this makes two").toEqual([]);
  });

  it("the control: the parser DOES find the trigger bodies it is checking", () => {
    /*
     * Without this, a renamed component or a changed tag would make the sweep
     * above scan nothing and report a clean tree forever — the vacuum this
     * repo keeps finding in its own instruments.
     */
    let seen = 0;
    for (const file of sources(SRC)) {
      if (file === PRIMITIVE) continue;
      seen += subTriggerBodies(readFileSync(file, "utf8")).length;
    }
    expect(seen, "no sub-triggers found — the sweep had nothing to check").toBeGreaterThan(3);
    /* and it can answer YES: a staged body with a chevron in it is caught */
    expect(
      subTriggerBodies('<DropdownMenuSubTrigger><IconChevronRight /></DropdownMenuSubTrigger>')
        .some((b) => /Chevron/.test(b)),
    ).toBe(true);
  });
});
