import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AuroraOrb } from "./AuroraOrb";
import { computeRms } from "@/lib/useAudioLevel";

beforeAll(() => {
  // JSDOM intentionally has no 2D implementation. Browser rendering is
  // exercised by the production build; unit tests need only assert that the
  // canvas remains the one decorative renderer.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("AuroraOrb", () => {
  it("carries its state and a CLAMPED level on one CSS variable", () => {
    const { container } = render(<AuroraOrb state="speaking" level={3.7} />);
    const root = container.querySelector(".aurora-root") as HTMLElement;
    expect(root.dataset.state).toBe("speaking");
    expect(root.style.getPropertyValue("--audio-level")).toBe("1"); // clamped
  });

  it("hands every state to the live procedural renderer", () => {
    for (const state of ["idle", "listening", "speaking", "muted"] as const) {
      const { container } = render(<AuroraOrb state={state} />);
      const canvas = container.querySelector(".aurora-canvas") as HTMLCanvasElement;
      expect(canvas.dataset.renderState).toBe(state);
    }
  });

  it("the renderer is decorative — nothing here competes with the button", () => {
    const { container } = render(<AuroraOrb state="idle" />);
    expect(container.querySelector(".aurora-canvas")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("muted stops floating but keeps the body (still clickable, still seen)", () => {
    const { container } = render(<AuroraOrb state="muted" />);
    const root = container.querySelector(".aurora-root") as HTMLElement;
    expect(root.classList.contains("aurora-float")).toBe(false);
    expect(container.querySelector(".aurora-canvas")).not.toBeNull();
  });

  it("uses one canvas-rendered identity, not a raster image or static layers", () => {
    const { container } = render(<AuroraOrb state="idle" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll(".aurora-canvas")).toHaveLength(1);
    expect(container.querySelectorAll(".aurora-root > span")).toHaveLength(0);
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
