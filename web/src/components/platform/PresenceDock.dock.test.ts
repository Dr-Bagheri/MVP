import { describe, expect, it } from "vitest";
import { dockModeFor } from "./PresenceDock";

/**
 * The drag itself needs a signed-in member and a real pointer, so what is
 * covered here is the DECISION the release makes — extracted for exactly
 * this reason. Screen: 1200×800, edge zone 72px.
 *
 * The bottom dock existed for a day and was removed (user directive,
 * 2026-08-26): the sides are the only holders. Its absence is asserted
 * below, not merely untested — a mode that quietly came back would pass a
 * suite that only checked the sides.
 */
const W = 1200;
const H = 800;

describe("where a released orb docks", () => {
  it("the middle of the screen floats", () => {
    expect(dockModeFor(600, 400, W, H)).toBe("float");
  });

  it("the left edge seats into the left holder", () => {
    expect(dockModeFor(30, 400, W, H)).toBe("side-left");
  });

  it("the right edge seats into the right holder", () => {
    expect(dockModeFor(W - 30, 400, W, H)).toBe("side-right");
  });

  it("the bottom edge FLOATS — the bottom dock is gone", () => {
    expect(dockModeFor(600, H - 10, W, H)).toBe("float");
  });

  it("a bottom corner goes to its SIDE, not to a bottom panel", () => {
    expect(dockModeFor(30, H - 10, W, H)).toBe("side-left");
    expect(dockModeFor(W - 30, H - 10, W, H)).toBe("side-right");
  });

  it("just inside the zone boundary still floats", () => {
    // the zone is 72px: one past it must NOT dock, or every drag that
    // wanders near an edge becomes a surprise panel
    expect(dockModeFor(73, 400, W, H)).toBe("float");
    expect(dockModeFor(W - 73, 400, W, H)).toBe("float");
  });
});
