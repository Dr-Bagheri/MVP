import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The settings mark is drawn in TWO files, and they must draw the same thing.
 *
 * This exists because of how the user found out it wasn't true. They asked
 * for a settings icon that reads as settings; `IconSettings` in
 * `components/icons.tsx` was redrawn, shipped, deployed — and the icon on
 * screen did not move, because the rail imports `NAV_ICON` from
 * `components/platform/icons.tsx`, where `CogIcon` is a separate drawing of
 * the same idea. The change was real, the deploy was real, and the user
 * reported the same thing a second time.
 *
 * The two files are not merged because their `base()` helpers genuinely
 * differ — one defaults to 16px with a 1.7 stroke, the other has no default
 * size and a 1.8 stroke — so a re-export would resize every icon in the rail.
 * Two drawings is therefore the deliberate state, and this is what stops the
 * deliberate state from becoming a divergent one.
 *
 * It compares GEOMETRY (the `d` and circle attributes), not the whole
 * source: the wrappers differ by design, and a check that demanded identical
 * text would fail for the reason the files are separate in the first place.
 */
const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

/** every path `d` and circle position inside one icon's JSX body */
function geometry(source: string, marker: string): string[] {
  const at = source.indexOf(marker);
  expect(at, `${marker} should exist`).toBeGreaterThan(-1);
  // the body runs to the closing `);` of the arrow function
  const body = source.slice(at, source.indexOf("\n);", at));
  const shapes = [
    ...[...body.matchAll(/\sd="([^"]+)"/g)].map((m) => `path:${m[1]}`),
    ...[...body.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)]
      .map((m) => `circle:${m[1]},${m[2]},${m[3]}`),
  ];
  expect(shapes.length, `${marker} should draw something`).toBeGreaterThan(0);
  return shapes.sort();
}

describe("the settings mark", () => {
  it("is the same drawing in both icon sets", () => {
    expect(geometry(read("./platform/icons.tsx"), "export const CogIcon"))
      .toEqual(geometry(read("./icons.tsx"), "export const IconSettings"));
  });

  it("can tell two different drawings apart — the control", () => {
    /*
     * The question this file must answer NO to. Both halves above read from
     * the same regex, so a `geometry` that returned [] for everything would
     * make the comparison trivially true. This runs it over two marks that
     * are genuinely different and demands they differ.
     */
    const set = read("./icons.tsx");
    expect(geometry(set, "export const IconSettings"))
      .not.toEqual(geometry(set, "export const IconCheck"));
  });
});
