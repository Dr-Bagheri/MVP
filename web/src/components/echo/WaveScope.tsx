"use client";

import { useRef, type ReactNode } from "react";

/**
 * THE LIVE SCOPE — the letterboxed pair of lanes the recorder has drawn
 * since M2, extracted so the meeting's own recording screen can wear it and
 * show a spectrogram of what it is recording.
 *
 * Extracted rather than copied, because the copy is the one nobody
 * maintains: the lanes, the age gradient and the three-step glow are a
 * shape this product has exactly one of, and a second spelling of it would
 * stop matching the first the next time either is touched.
 *
 * What stays with the CALLER is everything that is about a particular
 * take — the chapter marks, the now-line, the rail underneath, the tick
 * labels — because those are readings, not chrome; they arrive here as
 * `children`, positioned against this box.
 *
 * `aria-hidden` on the frame: a bar chart of amplitudes says nothing a
 * screen reader can use, and the surfaces that draw it all state the take's
 * real condition in words beside it.
 */
export function WaveScope({ wave, level, live, slots = 96, className = "h-28", children }: {
  /** the engine's own amplitude samples, oldest first */
  wave: number[];
  /** the live level, 0..1 — decides the halo and nothing else */
  level: number;
  /** is the take actually capturing? a still scope must not glow */
  live: boolean;
  /** how many bars the window holds */
  slots?: number;
  /** the box's height, as a Tailwind class */
  className?: string;
  children?: ReactNode;
}) {
  const shown = wave.slice(-slots);
  const pad = slots - shown.length;
  /* the glow follows the LIVE level in three steps rather than
     continuously: a filter that changes every frame re-rasterises the whole
     scope, and nobody can see more than three steps of a halo.
     ── WITH HYSTERESIS (observed 2026-09-09: the halo was flashing).
     Three steps on a bare threshold is a Schmitt trigger with no gap: speech
     crosses 0.08 and 0.35 several times a second, so the halo — a container
     `filter`, i.e. a whole-layer rasterisation — was switching on and off at
     the meter's own rate, and THAT is the blink. Rising takes the high
     thresholds, falling the low ones, so a level hovering on a boundary
     stays where it is; the engine's release envelope does the rest, and the
     CSS transition on `filter` covers the step that survives both. */
  const step = useRef(0);
  if (!live) {
    step.current = 0;
  } else if (level >= 0.40) {
    step.current = 2;
  } else if (level >= 0.12) {
    if (step.current < 1) step.current = 1;
    if (step.current > 1 && level < 0.28) step.current = 1;
  } else if (level < 0.06) {
    step.current = 0;
  } else if (step.current > 1) {
    step.current = 1;
  }
  const glow = String(step.current);
  const values = Array.from({ length: slots }, (_, i) =>
    Math.max(0.02, i < pad ? 0 : shown[i - pad]!));
  const lane = (kind: "up" | "down") => (
    <div className={`wave-lane wave-lane-${kind}`}>
      {values.map((v, i) => (
        <span
          key={i}
          className="wave-bar"
          style={{ "--v": v, "--age": (i / slots).toFixed(3) } as React.CSSProperties}
        />
      ))}
    </div>
  );
  return (
    /* `dir="ltr"`: time runs left-to-right in this box on both locales —
       the newest bar is the right edge, and mirroring it would put "now"
       where a Persian reader starts reading */
    <div className={`wave-scope ${className}`} data-glow={glow} dir="ltr" aria-hidden>
      {/* the HORIZON is always drawn, not only when the scope is empty: an
          axis is what makes the lanes read as a signal in a space rather
          than as two bar charts, and it was disappearing the moment the
          first sample landed. Dotted while nothing has been captured
          ("ready"), a hairline once something has. */}
      <span className={wave.length === 0 ? "wave-idle" : "wave-axis"} />
      {lane("up")}
      {lane("down")}
      {/* the LEADING EDGE — where "now" is. Only while capturing: a still
          scope with a playhead claims a take is rolling. */}
      {live ? <span className="wave-now" /> : null}
      <span className="wave-grain" />
      {children}
    </div>
  );
}
