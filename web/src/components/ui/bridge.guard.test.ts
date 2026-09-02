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

  it("THE CONTROL: an unregistered name is actually detected", () => {
    /* proves the check can fail. Without this the test above passes for a
       config that registers nothing, as long as the regex finds nothing. */
    const known = registered();
    expect(known.has("accent-foreground")).toBe(true);
    expect(known.has("nonsense-foreground")).toBe(false);
  });
});
