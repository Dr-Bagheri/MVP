import { describe, expect, it } from "vitest";
import { frameLevel, frameRms, HEARD_MS_FLOOR, HEARD_RMS_FLOOR, wasHeard } from "./micMeter";

/**
 * The meter's arithmetic, argued here rather than in a browser.
 *
 * The number that matters is the FLOOR: it decides whether an enrolment take
 * is sent or refused, so it has to sit clear of both edges — a quiet room
 * must not clear it and ordinary speech must not miss it.
 */

/** one analyser frame at a constant offset from the centre line (128) */
function frame(offset: number): Uint8Array {
  return Uint8Array.from({ length: 1024 }, () => 128 + offset);
}

describe("frameLevel", () => {
  it("digital silence is zero — the reading a muted microphone gives", () => {
    expect(frameLevel(frame(0))).toBe(0);
  });

  it("a full-scale frame saturates at 1 rather than running past the bar", () => {
    expect(frameLevel(frame(127))).toBe(1);
  });

  it("rises with the signal", () => {
    expect(frameLevel(frame(20))).toBeGreaterThan(frameLevel(frame(4)));
  });

  it("an empty frame is zero, not NaN — a NaN never clears the floor and reads as silence", () => {
    expect(frameLevel(new Uint8Array(0))).toBe(0);
  });

  /*
   * THE FLOOR, from both sides. Either assertion alone would be satisfied by
   * a floor at one extreme: 0 passes the second, 1 passes the first.
   */
  it("a nearly-silent room draws NOTHING — the bar does not twitch for a dead microphone", () => {
    /* one least-significant bit off the centre line is the quantisation
       noise of a silent capture, not a person. On the display curve alone it
       reads 0.12 of a full bar, which is what the first draft of this module
       used as its floor — caught here before it shipped. */
    expect(frameRms(frame(1))).toBeLessThan(HEARD_RMS_FLOOR);
    expect(frameLevel(frame(1))).toBe(0);
  });

  it("an ordinary speaking level clears the floor comfortably", () => {
    expect(frameRms(frame(12))).toBeGreaterThan(HEARD_RMS_FLOOR * 2);
    expect(frameLevel(frame(12))).toBeGreaterThan(0);
  });
});

describe("wasHeard", () => {
  it("needs sound for longer than a door slam", () => {
    expect(wasHeard(HEARD_MS_FLOOR - 1)).toBe(false);
    expect(wasHeard(HEARD_MS_FLOOR)).toBe(true);
  });

  it("a browser that cannot measure is not a browser that heard nothing", () => {
    /* startMicMeter reports Infinity where WebAudio is absent: the refusal
       must not fire on somebody whose take is fine and whose browser simply
       has no analyser to offer */
    expect(wasHeard(Number.POSITIVE_INFINITY)).toBe(true);
  });
});
