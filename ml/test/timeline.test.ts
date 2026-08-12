import { describe, expect, it } from "vitest";
import { TimelineMap } from "../src/timeline.js";

// The contract's load-bearing guarantee: after we cut silence out to save
// money, every timestamp we hand back still points at the ORIGINAL audio.
describe("TimelineMap", () => {
  const regions = [
    { start_ms: 1000, end_ms: 3000 }, // trimmed 0    – 2000
    { start_ms: 8000, end_ms: 9500 }, // trimmed 2000 – 3500
    { start_ms: 12000, end_ms: 13000 }, // trimmed 3500 – 4500
  ];
  const map = new TimelineMap(regions);

  it("reports the speech duration, not the wall duration", () => {
    expect(map.speechMs).toBe(4500);
  });

  it("maps the start of each region", () => {
    expect(map.toOriginal(0)).toBe(1000);
    expect(map.toOriginal(2000)).toBe(8000);
    expect(map.toOriginal(3500)).toBe(12000);
  });

  it("maps points inside a region", () => {
    expect(map.toOriginal(500)).toBe(1500);
    expect(map.toOriginal(2750)).toBe(8750);
  });

  it("never places a timestamp inside the silence it removed", () => {
    // 2000 is the seam: the instant before it belongs to region 0's tail,
    // never to the 5 seconds of silence that followed.
    expect(map.toOriginal(1999)).toBeLessThanOrEqual(3000);
    expect(map.toOriginal(2001)).toBeGreaterThanOrEqual(8000);
  });

  it("clamps past the end instead of inventing time", () => {
    expect(map.toOriginal(99_999)).toBe(13000);
  });

  it("is the identity when nothing was trimmed", () => {
    const id = TimelineMap.identity(60_000);
    expect(id.toOriginal(0)).toBe(0);
    expect(id.toOriginal(42_000)).toBe(42_000);
    expect(id.speechMs).toBe(60_000);
  });

  it("handles negative or zero input by pinning to the first region", () => {
    expect(map.toOriginal(-5)).toBe(1000);
  });
});
