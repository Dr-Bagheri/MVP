import { describe, expect, it } from "vitest";

import { assignUnitsToSegments } from "../src/worker/translation-mapping.ts";

/**
 * Where a translation would land one line off (2026-09-06, C4): the unit's
 * midpoint decides, the offset is added to the UNIT (ml/'s timeline is the
 * part's), and no unit is ever dropped — a unit astride two lines goes to
 * the line holding its middle, a unit in a gap to the line it overlaps most,
 * a unit past every line to the nearest.
 */
const LINES = [
  { id: "a", start_ms: 30_000, end_ms: 33_000 },
  { id: "b", start_ms: 33_000, end_ms: 36_000 },
  { id: "c", start_ms: 40_000, end_ms: 42_000 },
];

describe("assignUnitsToSegments", () => {
  it("places units by midpoint on the CALL timeline — the part offset is added to the unit", () => {
    const out = assignUnitsToSegments([
      { start_ms: 0, end_ms: 2_000, text: "Hello" },     // 30_000–32_000 → a
      { start_ms: 3_500, end_ms: 5_000, text: "world" }, // 33_500–35_000 → b
    ], LINES, 30_000);
    expect(out.get("a")).toBe("Hello");
    expect(out.get("b")).toBe("world");
    expect(out.has("c")).toBe(false); // nothing invented for a line with no unit
  });

  it("a unit astride two lines goes to the line holding its middle; two units on one line join in order", () => {
    const out = assignUnitsToSegments([
      { start_ms: 2_000, end_ms: 5_000, text: "across" },   // 32_000–35_000, mid 33_500 → b
      { start_ms: 5_000, end_ms: 5_900, text: "and more" }, // → b
    ], LINES, 30_000);
    expect(out.get("b")).toBe("across and more");
    expect(out.has("a")).toBe(false);
  });

  it("a unit in a gap between lines goes to the line it overlaps most; one past every line to the nearest", () => {
    const out = assignUnitsToSegments([
      { start_ms: 5_500, end_ms: 7_000, text: "gap" },        // 35_500–37_000: overlaps b by 500, nothing else
      { start_ms: 20_000, end_ms: 21_000, text: "late" },     // 50_000+: nearest is c
    ], LINES, 30_000);
    expect(out.get("b")).toBe("gap");
    expect(out.get("c")).toBe("late");
  });

  it("empty text is skipped, and no lines means no entries", () => {
    expect(assignUnitsToSegments([{ start_ms: 0, end_ms: 100, text: "  " }], LINES, 0).size).toBe(0);
    expect(assignUnitsToSegments([{ start_ms: 0, end_ms: 100, text: "x" }], [], 0).size).toBe(0);
  });
});
