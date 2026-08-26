import { describe, expect, it } from "vitest";
import { dockModeFor, holderSideFor } from "./PresenceDock";

/**
 * The drag itself needs a signed-in member and a real pointer, so what is
 * covered here is the DECISION the release makes. Screen width 1200,
 * edge zone 72px.
 *
 * Two removed modes are asserted ABSENT, not merely untested — a mode that
 * quietly came back would pass a suite that only checked the happy side:
 * the bottom dock (removed 2026-08-26 morning) and the menu-side dock
 * (removed 2026-08-26 evening — one holder only, opposite the rail).
 */
const W = 1200;

describe("which side holds the dock", () => {
  it("is the side OPPOSITE the menu rail", () => {
    // the rail sits at inline-start: LTR left rail → right holder,
    // RTL right rail → left holder
    expect(holderSideFor("ltr")).toBe("side-right");
    expect(holderSideFor("rtl")).toBe("side-left");
  });
});

describe("where a released orb goes (LTR — holder on the right)", () => {
  const allowed = holderSideFor("ltr");

  it("the middle of the screen floats", () => {
    expect(dockModeFor(600, W, allowed)).toBe("float");
  });

  it("the holder's own edge seats it", () => {
    expect(dockModeFor(W - 30, W, allowed)).toBe("side-right");
  });

  it("the MENU's edge floats — there is no holder over the rail", () => {
    expect(dockModeFor(30, W, allowed)).toBe("float");
  });

  it("just inside the zone boundary still floats", () => {
    expect(dockModeFor(W - 73, W, allowed)).toBe("float");
  });
});

describe("where a released orb goes (RTL — holder on the left)", () => {
  const allowed = holderSideFor("rtl");

  it("the left edge seats it, the right edge floats", () => {
    expect(dockModeFor(30, W, allowed)).toBe("side-left");
    expect(dockModeFor(W - 30, W, allowed)).toBe("float");
  });
});
