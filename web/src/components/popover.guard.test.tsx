import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

/**
 * A FLOATING PANEL IS A THEME DECISION, NOT A COMPONENT'S OWN (user
 * directive, 2026-09-02: "these must be rules in theme for all drop down
 * menus … why we have these silly problem").
 *
 * Every dropdown here had hand-rolled the same panel, and each copy forgot a
 * different thing: one changed the page's height when it opened (the profile
 * role row grew and pushed Save down the screen), one was clipped by a card
 * with `overflow-hidden`, one opened downward off the bottom of the viewport.
 * Those are not three bugs, they are one missing primitive.
 *
 * So the rule is: a panel that floats goes through `Popover`, which portals
 * it to the body and places it `fixed` from the trigger's rect. The two tests
 * below are the two halves of that — the behaviour, and the rule.
 */
const OPTIONS = [
  { value: "a", label: "الف" },
  { value: "b", label: "ب" },
];

describe("an open dropdown", () => {
  it("leaves the page exactly as tall as it was", async () => {
    /*
     * THE REPORTED BUG, as an assertion. An in-flow panel makes its container
     * taller the moment it opens, which moves everything below it — a Save
     * button that walks down the screen while somebody reaches for it.
     */
    render(
      <div>
        <Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="نقش" />
        <button type="button">ذخیره</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "نقش" });
    const container = trigger.closest("div")!.parentElement!;
    const before = container.getBoundingClientRect().height;

    await userEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(container.getBoundingClientRect().height).toBe(before);
  });

  it("is rendered OUTSIDE the control, where no ancestor can clip it", async () => {
    render(
      <div data-testid="clipper" style={{ overflow: "hidden" }}>
        <Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="نقش" />
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "نقش" }));
    const list = screen.getByRole("listbox");
    /* the load-bearing half: the panel is NOT inside the box that would clip
       it. A panel that merely looks right in this test while sitting inside
       the clipper is the bug, rendered small enough not to show it. */
    expect(screen.getByTestId("clipper").contains(list)).toBe(false);
    expect(document.body.contains(list)).toBe(true);
  });
});

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
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the floating-panel rule", () => {
  it("is followed: nothing hand-rolls `absolute top-full`", () => {
    /*
     * The form the copies took. `absolute top-full` is a panel hanging off a
     * control, and it is exactly the shape that both changes layout in some
     * containers and gets clipped in others. Written narrowly on purpose: a
     * broad ban on `absolute` would fire on badges, dots and overlays, and a
     * guard that cries wolf is one nobody runs twice.
     */
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const code = codeOnly(readFileSync(file, "utf8"));
      for (const match of code.matchAll(/"([^"]*top-full[^"]*)"/g)) {
        const cls = match[1]!;
        /* membership by SPLIT, not a word-boundary regex: two attempts to
           write that escape through a generator emitted a literal BACKSPACE
           instead, which the encoding sweep caught both times. A rule with
           no escape in it cannot be mis-escaped. */
        if (!cls.split(/[ ]+/).includes("absolute")) continue;
        /*
         * A DECORATION is not a menu, and this guard's first run said it
         * was: the record player's marker strip sits under the scrubber
         * with `absolute inset-x-0 top-full`, and it is pointer-events-none
         * — it cannot be clicked, cannot be clipped into uselessness, and
         * has nothing to portal. Excluded by the attribute that makes it a
         * decoration rather than by naming the file, so the next decorative
         * strip is not a false positive either.
         */
        if (/pointer-events-none/.test(cls)) continue;
        offenders.push(relative(SRC, file).split("\\").join("/"));
      }
    }
    expect(
      offenders,
      "these hang a panel off a control by hand — use <Popover>:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("has something to check — the primitive is actually used", () => {
    /*
     * The primitive is RADIX's now, imported from `@/components/ui/popover`.
     * What it replaced was a hand-rolled portal that had to learn placement,
     * clipping, flipping and — the one that settled the argument — working
     * INSIDE A MODAL, where Radix marks everything outside the dialog
     * `pointer-events: none` and a body-portalled panel renders perfectly
     * and cannot be clicked.
     *
     * Counting the IMPORT rather than the `<Popover` tag on purpose: the tag
     * is the same either way, so a count of tags could not tell the two
     * implementations apart, and would have gone on passing after the
     * hand-rolled one came back.
     */
    let users = 0;
    for (const file of sources(SRC)) {
      const code = codeOnly(readFileSync(file, "utf8"));
      if (code.includes('from "@/components/ui/popover"')) users += 1;
    }
    expect(users).toBeGreaterThan(1);
  });
});
