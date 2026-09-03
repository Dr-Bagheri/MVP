import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

/**
 * SHADCN'S COLOUR NAMES MUST EXIST IN OUR THEME, OR THEY EMIT NOTHING.
 *
 * A component library ships classes like `focus:text-accent-foreground`. If
 * our config registers `accent` as a flat colour, that class names a colour
 * Tailwind has never heard of and produces NO CSS AT ALL. Nothing warns. The
 * component renders, the class is in the markup, a reviewer reads it as
 * themed — and a focused menu row gets the accent ground with the page's
 * ordinary ink on top of it.
 *
 * This repo has shipped that exact defect before by hand (`text-on-accent`,
 * registered in globals.css and never in the theme, contrast measurably
 * WORSE after the "fix"). A library multiplies the chances, because the
 * classes arrive already written by somebody who assumed a different config.
 *
 * So: every `*-foreground` class the ui/ components use must resolve.
 */
const UI = join(process.cwd(), "src", "components", "ui");

function registered(): Set<string> {
  const colors = (config.theme?.extend?.colors ?? {}) as Record<string, unknown>;
  const names = new Set<string>();
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === "string") { names.add(key); continue; }
    for (const inner of Object.keys(value as object)) {
      names.add(inner === "DEFAULT" ? key : `${key}-${inner}`);
    }
  }
  return names;
}

function foregroundClassesUsed(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const entry of readdirSync(UI)) {
    if (!entry.endsWith(".tsx")) continue;
    const text = readFileSync(join(UI, entry), "utf8");
    /* the utility prefix is dropped and only the COLOUR NAME kept — the same
       name reaches Tailwind whether it was written as bg-, text- or border-,
       and whether or not a variant prefixes it */
    for (const m of text.matchAll(/(?:bg|text|border|ring|ring-offset|fill|stroke|divide|outline)-([a-z]+(?:-[a-z]+)*-foreground)\b/g)) {
      out.push({ name: m[1]!, file: entry });
    }
  }
  return out;
}

describe("the shadcn colour bridge", () => {
  it("has something to check — the components do use these classes", () => {
    /* without this, a day when ui/ is empty or the regex stops matching
       turns the assertion below into a pass about nothing */
    expect(foregroundClassesUsed().length).toBeGreaterThan(3);
  });

  it("registers every `*-foreground` colour the components ask for", () => {
    const known = registered();
    const missing = foregroundClassesUsed()
      .filter(({ name }) => !known.has(name))
      .map(({ name, file }) => `${name}  (used in ui/${file})`);
    expect(
      [...new Set(missing)],
      "these emit NO CSS — add the key to tailwind.config.ts:\n" + missing.join("\n"),
    ).toEqual([]);
  });

  it("gives a bare `border` the theme's own colour", () => {
    /*
     * User report, 2026-09-03: "remove the outer highlight of it the white."
     * The composer's menu drew a rgb(229,231,235) edge around a near-black
     * panel — Tailwind's gray-200, which is what `borderColor.DEFAULT` is
     * until something says otherwise.
     *
     * This file already catches a `*-foreground` class with no entry. It did
     * not catch this, because the failing class was `border` with no colour at
     * all: the components ask for the DEFAULT, and a default is not a name a
     * scan for names can find. Six ui/ files write it today and the seventh
     * arrives with the next `shadcn add`, so the assertion is on the config
     * rather than on the files.
     */
    const config = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
    const block = /borderColor:\s*\{[^}]*DEFAULT:\s*"([^"]+)"/.exec(config);
    expect(block, "tailwind.config.ts sets borderColor.DEFAULT").not.toBeNull();
    expect(block![1], "it points at the theme's --border token")
      .toContain("var(--border)");
  });

  it("no overlay slides in from a side", () => {
    /*
     * User directive, 2026-09-03: "the pop window appears with this animation
     * that it comes from side, change the animation to just slowly appears."
     *
     * shadcn ships a directional slide on every surface, and the next
     * `shadcn add` will bring one back with it — which is exactly the shape
     * the border-colour finding had: a class the LIBRARY writes, authored
     * against a config we do not have, arriving with a component nobody
     * re-reads.
     *
     * The classes are REMOVED rather than overridden, so this checks for their
     * absence in the CLASS LISTS and tolerates the word in a comment — the
     * files explain why the slide is gone, and a check that could not tell an
     * explanation from a regression would make the explanation unwritable.
     */
    const offenders: string[] = [];
    for (const entry of readdirSync(UI)) {
      if (!entry.endsWith(".tsx")) continue;
      const text = readFileSync(join(UI, entry), "utf8")
        /* comments out, class lists left — block comments first, then line */
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/slide-(?:in|out)-(?:from|to)-/.test(text)) offenders.push(entry);
    }
    expect(offenders, "these still slide — fade only").toEqual([]);
  });

  it("the overlays still animate AT ALL — the control", () => {
    /*
     * Without this, deleting every animation class would satisfy the check
     * above perfectly. A panel that appears with no transition reads as a
     * repaint rather than as something opening, so the fade is the property
     * being kept and its presence is the half worth asserting.
     */
    const fading = readdirSync(UI)
      .filter((e) => e.endsWith(".tsx"))
      .filter((e) => /data-\[state=open\]:fade-in/.test(readFileSync(join(UI, e), "utf8")));
    expect(fading.length, "overlays that fade in").toBeGreaterThan(2);
  });

  it("THE CONTROL: an unregistered name is actually detected", () => {
    /* proves the check can fail. Without this the test above passes for a
       config that registers nothing, as long as the regex finds nothing. */
    const known = registered();
    expect(known.has("accent-foreground")).toBe(true);
    expect(known.has("nonsense-foreground")).toBe(false);
  });
});
