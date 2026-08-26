import { describe, expect, it } from "vitest";
import { dockModeFor } from "./PresenceDock";

/**
 * The drag itself needs a signed-in member and a real pointer, so what is
 * covered here is the DECISION the release makes — extracted for exactly
 * this reason. Screen: 1200×800, edge zone 72px.
 */
const W = 1200;
const H = 800;

describe("where a released orb docks", () => {
  it("the middle of the screen floats", () => {
    expect(dockModeFor(600, 400, W, H)).toBe("float");
  });

  it("the left edge becomes a left side panel", () => {
    expect(dockModeFor(30, 400, W, H)).toBe("side-left");
  });

  it("the right edge becomes a right side panel", () => {
    expect(dockModeFor(W - 30, 400, W, H)).toBe("side-right");
  });

  it("the bottom becomes a bottom panel", () => {
    expect(dockModeFor(600, H - 30, W, H)).toBe("bottom");
  });

  it("a corner goes to the BOTTOM — the wider panel wins", () => {
    // both edges claim a corner release; the rule is stated, so it is
    // asserted: bottom outranks the sides
    expect(dockModeFor(30, H - 30, W, H)).toBe("bottom");
    expect(dockModeFor(W - 30, H - 30, W, H)).toBe("bottom");
  });

  it("just inside the zone boundary still floats", () => {
    // the zone is 72px: one past it must NOT dock, or every drag that
    // wanders near an edge becomes a surprise panel
    expect(dockModeFor(73, 400, W, H)).toBe("float");
    expect(dockModeFor(W - 73, 400, W, H)).toBe("float");
    expect(dockModeFor(600, H - 73, W, H)).toBe("float");
  });
});
