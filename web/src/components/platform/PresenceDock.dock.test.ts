import { describe, expect, it } from "vitest";
import { clampSocketY, dockModeFor, holderSideFor, orbStyle, type OrbPin } from "./PresenceDock";

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

describe("the seated orb and its socket agree about y", () => {
  /*
   * User report, 2026-09-02: "its position is not inside its circle". The
   * holder draws the socket at clampSocketY(pin.y); the orb was drawn at the
   * raw pin.y. A stored pin the window has since outgrown is the case where
   * they differ — the socket climbs to stay on screen, the orb does not.
   * The viewport is passed in so the assertion is about the rule, not about
   * whatever jsdom's window happens to measure.
   */
  const viewport = { width: 1280, height: 600 };

  it("puts the orb where the socket is, even for a pin below the clamp", () => {
    const pin: OrbPin = { mode: "side-right", x: 1267, y: 590 };
    const style = orbStyle(pin, null, viewport);
    expect(style.top).toBe(clampSocketY(590, viewport.height));
    expect(style.top).toBe(600 - 72);
    expect(style.left).toBe(1280 - 13);
  });

  it("and above it", () => {
    const pin: OrbPin = { mode: "side-left", x: 13, y: 40 };
    expect(orbStyle(pin, null, viewport).top).toBe(120);
  });

  it("the control: a pin inside the range is not moved, and a float is never clamped", () => {
    expect(orbStyle({ mode: "side-right", x: 0, y: 300 }, null, viewport).top).toBe(300);
    const floating = orbStyle({ mode: "float", x: 400, y: 590 }, null, viewport);
    expect(floating).toEqual({ left: 400, top: 590 });
  });
});
