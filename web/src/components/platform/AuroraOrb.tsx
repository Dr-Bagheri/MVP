"use client";

import type { CSSProperties } from "react";

/**
 * AURORA PULSE — the presence orb's visual body (user-supplied identity,
 * 2026-08-21). Pure presentation: the DOCK owns state and interaction and
 * mounts this inside its button; every layer here is decorative
 * (aria-hidden, pointer-events-none) so the button stays the one
 * accessible thing.
 *
 * States mirror the voice pipeline exactly:
 *  - idle       gentle float, slow orbits, faint glow
 *  - listening  receiving-sound ripples (the engaged wake session)
 *  - speaking   halo + faster ribbons, scaled by the voice's own level
 *  - muted      dimmed, motion paused (silent mode) — still clickable
 *
 * `level` (0–1, smoothed upstream) drives only what the spec allows: glow
 * opacity, halo scale/opacity, ripple presence, core scale (≤1.06) — all
 * via one CSS variable, so the DOM never re-lays-out per frame.
 */

export type AuroraState = "idle" | "listening" | "speaking" | "muted";

export function AuroraOrb({ state, level = 0 }: { state: AuroraState; level?: number }) {
  const clamped = Math.max(0, Math.min(1, level));
  return (
    <span
      className={`aurora-root relative block h-full w-full ${state === "muted" ? "" : "aurora-float"}`}
      data-state={state}
      style={{ "--audio-level": String(clamped) } as CSSProperties}
    >
      {/* ambient glow — behind everything */}
      <span aria-hidden className="aurora-glow pointer-events-none absolute -inset-5 rounded-full" />

      {/* listening: concentric receiving ripples */}
      {state === "listening" ? (
        <>
          <span aria-hidden className="aurora-ripple pointer-events-none absolute inset-0 rounded-full" />
          <span aria-hidden className="aurora-ripple pointer-events-none absolute inset-0 rounded-full" style={{ animationDelay: "0.8s" }} />
          <span aria-hidden className="aurora-ripple pointer-events-none absolute inset-0 rounded-full" style={{ animationDelay: "1.6s" }} />
        </>
      ) : null}

      {/* speaking: the halo that breathes with the voice */}
      {state === "speaking" ? (
        <span aria-hidden className="aurora-halo pointer-events-none absolute inset-0 rounded-full" />
      ) : null}

      {/* Fully procedural glass core: every visual responds through the
          state + audio-level CSS variables; no raster identity is involved. */}
      <span aria-hidden className="aurora-core pointer-events-none absolute inset-0">
        <span className="aurora-nebula absolute inset-0 block rounded-full" />
        <span className="aurora-lens absolute inset-[7%] block rounded-full" />
        <span className="aurora-specular absolute inset-0 block rounded-full" />
      </span>

      {/* The energy field is generated, not painted: three differently
          inclined rings and a speaking-only waveform react to live volume. */}
      <span aria-hidden className="aurora-orbit aurora-orbit-one pointer-events-none absolute inset-0">
        <span className="aurora-orbit-line absolute inset-x-[-13%] inset-y-[24%] block rounded-full" />
      </span>
      <span aria-hidden className="aurora-orbit aurora-orbit-two pointer-events-none absolute inset-0">
        <span className="aurora-orbit-line absolute inset-x-[-16%] inset-y-[29%] block rounded-full" />
      </span>
      <span aria-hidden className="aurora-orbit aurora-orbit-three pointer-events-none absolute inset-0">
        <span className="aurora-orbit-line absolute inset-x-[-7%] inset-y-[17%] block rounded-full" />
      </span>

      {state === "speaking" ? (
        <span aria-hidden className="aurora-voice-wave pointer-events-none absolute inset-x-[-18%] inset-y-[18%]" />
      ) : null}

      {state === "listening" ? (
        <span aria-hidden className="aurora-listen-scan pointer-events-none absolute inset-[-10%] rounded-full" />
      ) : null}
    </span>
  );
}
