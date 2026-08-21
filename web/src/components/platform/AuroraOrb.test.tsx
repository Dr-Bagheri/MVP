import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuroraOrb } from "./AuroraOrb";
import { computeRms } from "@/lib/useAudioLevel";

describe("AuroraOrb", () => {
  it("carries its state and a CLAMPED level on one CSS variable", () => {
    const { container } = render(<AuroraOrb state="speaking" level={3.7} />);
    const root = container.querySelector(".aurora-root") as HTMLElement;
    expect(root.dataset.state).toBe("speaking");
    expect(root.style.getPropertyValue("--audio-level")).toBe("1"); // clamped
  });

  it("ripples exist ONLY while listening; the halo only while speaking", () => {
    const idle = render(<AuroraOrb state="idle" />).container;
    expect(idle.querySelector(".aurora-ripple")).toBeNull();
    expect(idle.querySelector(".aurora-halo")).toBeNull();
    const listening = render(<AuroraOrb state="listening" />).container;
    expect(listening.querySelectorAll(".aurora-ripple")).toHaveLength(3);
    const speaking = render(<AuroraOrb state="speaking" />).container;
    expect(speaking.querySelector(".aurora-halo")).not.toBeNull();
  });

  it("every layer is decorative — nothing here competes with the button", () => {
    const { container } = render(<AuroraOrb state="idle" />);
    for (const layer of container.querySelectorAll(".aurora-root > span")) {
      expect(layer.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("muted stops floating but keeps the body (still clickable, still seen)", () => {
    const { container } = render(<AuroraOrb state="muted" />);
    const root = container.querySelector(".aurora-root") as HTMLElement;
    expect(root.classList.contains("aurora-float")).toBe(false);
    expect(container.querySelector(".aurora-core")).not.toBeNull();
  });

  it("uses the shipped Aurora Pulse artwork without adding another accessible control", () => {
    const { container } = render(<AuroraOrb state="idle" />);
    const art = container.querySelector(".aurora-art") as HTMLImageElement;
    expect(art.getAttribute("src")).toBe("/brand/aurora-pulse.png");
    expect(art.getAttribute("alt")).toBe("");
    expect(art.closest("[aria-hidden='true']")).not.toBeNull();
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
