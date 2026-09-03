import { render, waitFor } from "@testing-library/react";
import dynamic from "next/dynamic";
import { beforeAll, describe, expect, it, vi } from "vitest";
/*
 * THE ORB IS UNMOUNTED, NOT DELETED (user directive, 2026-09-03: "we are going
 * to remove the orb FOR NOW"). Nothing in the product imports `EchoEOrb` since
 * the assistant became a docked sidebar, so three.js is in no route's bundle —
 * and this file is what keeps the part retrievable rather than merely present:
 * it compiles the renderer, mounts it, and asserts its contract, so the day it
 * is asked for back it is known to work rather than hoped to.
 *
 * The `AuroraOrb.tsx` re-export barrel is gone (a static re-export beside a
 * dynamic import was a second, non-splitting door into three.js). The name
 * stays as the local alias because that is what the product called it on
 * screen.
 */
import { EchoEOrb as AuroraOrb, createOrbParticleGeometry } from "./EchoEOrb";
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
      expect(canvas.dataset.particleCount).toBe("300");
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

  /**
   * The dynamic boundary the orb was loaded through, kept alive with it.
   *
   * three.js is 560 KB and was in every route's first-load set because the
   * dock was statically imported by the root layout; the fix was this
   * `next/dynamic` import, and the failure it can produce is a SILENT one — a
   * wrong module path or a renamed export renders nothing where the orb should
   * be, and no other test in this directory would notice.
   *
   * `tsc` catches a misspelled export name; this catches the rest of the
   * mechanism — that the lazy module resolves and mounts a real canvas. That
   * is the shape the orb has to come back in whenever it comes back, so the
   * assertion outlives the consumer that motivated it.
   */
  it("survives the next/dynamic boundary it is loaded through", async () => {
    const Lazy = dynamic(() => import("./EchoEOrb").then((m) => m.EchoEOrb), { ssr: false });
    const { container } = render(<Lazy state="listening" level={0.5} />);

    await waitFor(() => {
      expect(container.querySelector("canvas")).not.toBeNull();
    });
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.dataset.renderState).toBe("listening");
    expect(canvas.dataset.renderer).toBe("webgl-particles");
  });

  it("uses exactly 300 GPU points spanning a true 1x to 5x size range", () => {
    const geometry = createOrbParticleGeometry();
    const positions = geometry.getAttribute("position");
    const directions = geometry.getAttribute("aDirection");
    const impacts = geometry.getAttribute("aImpact");
    const sizes = Array.from(geometry.getAttribute("aBaseSize").array as Float32Array);
    expect(positions.count).toBe(300);
    expect(directions.count).toBe(300);
    expect(directions.itemSize).toBe(2);
    expect(impacts.count).toBe(300);
    expect(sizes).toHaveLength(300);
    expect(Math.min(...sizes)).toBe(1);
    expect(Math.max(...sizes)).toBe(5);

    const directionValues = directions.array as Float32Array;
    for (let index = 0; index < directions.count; index += 1) {
      const x = directionValues[index * 2]!;
      const y = directionValues[index * 2 + 1]!;
      expect(Math.hypot(x, y)).toBeCloseTo(1, 5);
    }
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
