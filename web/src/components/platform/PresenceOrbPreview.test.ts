import { describe, expect, it } from "vitest";
import { createPresenceParticleGeometry } from "./PresenceOrbPreview";

describe("GPU presence particles", () => {
  it("builds exactly 400 points spanning the full 1x to 5x size range", () => {
    const geometry = createPresenceParticleGeometry();
    const positions = geometry.getAttribute("position");
    const sizes = geometry.getAttribute("aBaseSize");
    const values = Array.from(sizes.array as Float32Array);

    expect(positions.count).toBe(400);
    expect(sizes.count).toBe(400);
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(5);

    geometry.dispose();
  });
});
