import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AuroraOrb } from "./AuroraOrb";
import { createOrbParticleGeometry } from "./EchoEOrb";
import { computeRms } from "@/lib/useAudioLevel";

beforeAll(() => {
  // JSDOM intentionally has no WebGL implementation. Unit tests assert the
  // renderer contract and geometry; the browser exercises the GPU program.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("AuroraOrb", () => {
  it("carries its state and a clamped audio level", () => {
    const { container } = render(<AuroraOrb state="speaking" level={3.7} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.state).toBe("speaking");
    expect(root.dataset.audioLevel).toBe("1");
  });

  it("hands every state to the live WebGL particle renderer", () => {
    for (const state of ["idle", "listening", "speaking", "muted"] as const) {
      const { container } = render(<AuroraOrb state={state} />);
      const canvas = container.querySelector("canvas") as HTMLCanvasElement;
      expect(canvas.dataset.renderState).toBe(state);
      expect(canvas.dataset.renderer).toBe("webgl-particles");
      expect(canvas.dataset.particleCount).toBe("400");
    }
  });

  it("the renderer is decorative — nothing here competes with the button", () => {
    const { container } = render(<AuroraOrb state="idle" />);
    expect(container.querySelector("canvas")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("muted keeps the transparent particle canvas mounted", () => {
    const { container } = render(<AuroraOrb state="muted" />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("uses one canvas-rendered identity, not a raster image or static layers", () => {
    const { container } = render(<AuroraOrb state="idle" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelectorAll("span > span")).toHaveLength(0);
  });

  it("uses exactly 400 GPU points spanning a true 1x to 5x size range", () => {
    const geometry = createOrbParticleGeometry();
    const positions = geometry.getAttribute("position");
    const sizes = Array.from(geometry.getAttribute("aBaseSize").array as Float32Array);
    expect(positions.count).toBe(400);
    expect(sizes).toHaveLength(400);
    expect(Math.min(...sizes)).toBe(1);
    expect(Math.max(...sizes)).toBe(5);
    geometry.dispose();
  });
});

describe("computeRms", () => {
  it("silence (all 128) is 0; a full square wave saturates to 1", () => {
    expect(computeRms(new Uint8Array(64).fill(128))).toBe(0);
    const square = new Uint8Array(64);
    for (let i = 0; i < 64; i++) square[i] = i % 2 ? 255 : 0;
    expect(computeRms(square)).toBe(1);
  });

  it("a moderate signal lands mid-range — the orb breathes, not slams", () => {
    const gentle = new Uint8Array(64);
    for (let i = 0; i < 64; i++) gentle[i] = 128 + (i % 2 ? 32 : -32);
    const level = computeRms(gentle);
    expect(level).toBeGreaterThan(0.3);
    expect(level).toBeLessThan(0.7);
  });

  it("an empty buffer is silence, not NaN", () => {
    expect(computeRms(new Uint8Array(0))).toBe(0);
  });
});
