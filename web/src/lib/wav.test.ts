import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";

/** a header the other side can read, and samples that survive the trip */
describe("encodeWav", () => {
  it("writes a RIFF/WAVE header with the rate and size it was given", async () => {
    const blob = encodeWav(new Float32Array([0, 0.5, -0.5]), 16_000);
    const view = new DataView(await blob.arrayBuffer());
    const tag = (at: number) =>
      String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);       // mono
    expect(view.getUint16(34, true)).toBe(16);      // 16-bit
    expect(view.getUint32(40, true)).toBe(6);       // 3 samples × 2 bytes
    expect(blob.size).toBe(44 + 6);
  });

  it("clamps out-of-range samples instead of wrapping them", async () => {
    // the failure this prevents is audible: a sample above 1.0 wraps to
    // full negative and the snippet arrives full of clicks
    const view = new DataView(await encodeWav(new Float32Array([2, -2]), 16_000).arrayBuffer());
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
