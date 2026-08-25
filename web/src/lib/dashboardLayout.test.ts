import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT, DEFAULT_SIZE, SIZE_SPAN, TILE_SIZES, WIDGETS, WIDGET_SIZES,
  moveWidget, sizeOf, type DashboardLayout, type WidgetKey,
} from "./dashboardLayout";
import { rowsFor } from "@/components/platform/dashboard/widgets";

const layout = (sizes: DashboardLayout["sizes"]): DashboardLayout => ({
  ...DEFAULT_LAYOUT, sizes,
});

describe("the four tile sizes", () => {
  it("gives every widget at least one size it can be", () => {
    for (const key of WIDGETS) {
      expect(WIDGET_SIZES[key].length, key).toBeGreaterThan(0);
    }
  });

  it("never defaults a widget to a size it does not support", () => {
    // the default and the allow-list are two lists that must agree; a
    // default outside its own allow-list is the shape that renders a tile
    // at a tier it was never designed for
    for (const key of WIDGETS) {
      expect(WIDGET_SIZES[key], key).toContain(DEFAULT_SIZE[key]);
    }
  });

  it("clamps a stored size the widget no longer supports", () => {
    // `topics` supports small and large; a layout saved when it also
    // supported hero must not resurrect as a hero-sized topics card
    const key: WidgetKey = "topics";
    expect(WIDGET_SIZES[key]).not.toContain("hero");
    expect(sizeOf(layout({ [key]: "hero" }), key)).toBe(DEFAULT_SIZE[key]);
  });

  it("honours a stored size the widget DOES support", () => {
    expect(sizeOf(layout({ topics: "large" }), "topics")).toBe("large");
  });

  it("answers with the default when nothing is stored", () => {
    expect(sizeOf(layout({}), "pulse")).toBe(DEFAULT_SIZE.pulse);
  });

  it("keeps every tier inside the six-column grid", () => {
    for (const size of TILE_SIZES) {
      expect(SIZE_SPAN[size].cols).toBeGreaterThan(0);
      expect(SIZE_SPAN[size].cols).toBeLessThanOrEqual(6);
    }
  });

  it("is ADDITIVE: a bigger tier never shows FEWER rows", () => {
    /**
     * The whole law of the four sizes in one assertion — Apple's rule and
     * Android's Weather ladder both say a larger tile adds information. A
     * ladder that dipped anywhere would mean growing a tile could hide a
     * row, which is the one thing resizing must never do.
     */
    const ladder = TILE_SIZES.map(rowsFor);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!, TILE_SIZES[i]).toBeGreaterThanOrEqual(ladder[i - 1]!);
    }
  });
});

describe("moving a tile", () => {
  it("moves one widget without disturbing the others' order", () => {
    const order: WidgetKey[] = ["tiles", "pulse", "recent", "people"];
    expect(moveWidget(order, "people", 1)).toEqual(["tiles", "people", "pulse", "recent"]);
  });

  it("clamps past either end instead of dropping the widget", () => {
    const order: WidgetKey[] = ["tiles", "pulse", "recent"];
    expect(moveWidget(order, "tiles", -99)).toEqual(order);
    expect(moveWidget(order, "tiles", 99)).toEqual(["pulse", "recent", "tiles"]);
  });
});
