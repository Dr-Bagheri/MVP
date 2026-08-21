"use client";

import { useEffect, useRef, type CSSProperties } from "react";

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
 * `level` (0–1, smoothed upstream) is handed to one procedural canvas. It
 * changes its magnetic-wave amplitude, glow, speed and core scale without
 * re-laying-out the dock — no image layer is involved.
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
      <AuroraCanvas state={state} level={clamped} />
    </span>
  );
}

function AuroraCanvas({ state, level }: { state: AuroraState; level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let context: CanvasRenderingContext2D | null = null;
    try { context = canvas.getContext("2d"); } catch { return; }
    if (!context) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = 0;
    let width = 0;
    let height = 0;
    let ratio = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);

    const render = (now: number) => {
      if (!context) return;
      const status = stateRef.current;
      const voice = levelRef.current;
      const speaking = status === "speaking";
      const listening = status === "listening";
      const energy = status === "muted" ? 0 : speaking ? 0.36 + voice * 0.64 : listening ? 0.25 + voice * 0.38 : 0.14;
      const time = reducedMotion || status === "muted" ? 0 : now / 1000;
      const cx = width / 2;
      const cy = height / 2;
      const unit = Math.min(width, height);
      const coreRadius = unit * (0.225 + voice * 0.014);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const aura = context.createRadialGradient(cx, cy, coreRadius * 0.1, cx, cy, unit * (0.52 + energy * 0.08));
      aura.addColorStop(0, `rgba(62, 188, 255, ${0.2 + energy * 0.2})`);
      aura.addColorStop(0.42, `rgba(103, 80, 255, ${0.14 + energy * 0.18})`);
      aura.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = aura;
      context.fillRect(0, 0, width, height);

      drawAuroraRibbons(context, cx, cy, unit, time, energy, false);
      drawCore(context, cx, cy, coreRadius, time, voice);
      drawAuroraRibbons(context, cx, cy, unit, time, energy, true);
      if (listening) drawListeningScan(context, cx, cy, unit, time, energy);
      if (speaking) drawVoiceRipples(context, cx, cy, unit, time, energy);

      if (!reducedMotion && status !== "muted") frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden data-render-state={state} className="aurora-canvas pointer-events-none absolute -inset-[45%] h-[190%] w-[190%]" />;
}

function drawCore(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, time: number, voice: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const core = ctx.createRadialGradient(cx - radius * 0.32, cy - radius * 0.38, radius * 0.04, cx, cy, radius * 1.12);
  core.addColorStop(0, "rgba(185, 233, 255, 0.96)");
  core.addColorStop(0.11, "rgba(62, 137, 255, 0.98)");
  core.addColorStop(0.4, "rgba(15, 34, 124, 1)");
  core.addColorStop(0.76, "rgba(5, 11, 57, 1)");
  core.addColorStop(1, "rgba(1, 4, 26, 1)");
  ctx.fillStyle = core;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 3; i++) {
    const angle = time * (0.65 + i * 0.13) + i * 2.1;
    const x = cx + Math.cos(angle) * radius * (0.33 + i * 0.11);
    const y = cy + Math.sin(angle * 1.33) * radius * (0.28 + i * 0.09);
    const light = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.52);
    light.addColorStop(0, i === 1 ? "rgba(197, 103, 255, 0.58)" : "rgba(46, 219, 255, 0.68)");
    light.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = light;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(192, 239, 255, 0.58)";
  ctx.lineWidth = Math.max(0.8, radius * 0.045);
  ctx.shadowColor = `rgba(71, 216, 255, ${0.45 + voice * 0.25})`;
  ctx.shadowBlur = radius * 0.3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.98, Math.PI * 1.03, Math.PI * 1.76);
  ctx.stroke();
  ctx.restore();
}

function drawAuroraRibbons(ctx: CanvasRenderingContext2D, cx: number, cy: number, unit: number, time: number, energy: number, foreground: boolean) {
  const ribbons = foreground ? [
    { tilt: -0.08, y: 0.10, arc: -0.23, phase: 0.5, cyan: "72, 228, 255", violet: "222, 136, 255" },
    { tilt: 0.38, y: -0.04, arc: 0.16, phase: 2.7, cyan: "122, 177, 255", violet: "192, 105, 255" },
    { tilt: -0.44, y: 0.02, arc: 0.18, phase: 4.4, cyan: "84, 208, 255", violet: "180, 104, 255" },
  ] : [
    { tilt: 0.16, y: -0.10, arc: 0.22, phase: 1.2, cyan: "69, 213, 255", violet: "178, 107, 255" },
    { tilt: -0.34, y: 0.03, arc: -0.18, phase: 3.1, cyan: "105, 164, 255", violet: "217, 124, 255" },
    { tilt: 0.67, y: 0.01, arc: 0.12, phase: 5.0, cyan: "87, 223, 255", violet: "174, 102, 255" },
  ];
  for (const [index, ribbon] of ribbons.entries()) {
    const breathing = Math.sin(time * (1.25 + energy) + ribbon.phase);
    const travel = Math.sin(time * (0.42 + energy * 0.36) + ribbon.phase);
    const span = unit * (0.58 + index * 0.035);
    const waveHeight = unit * (ribbon.arc + breathing * (0.026 + energy * 0.042));
    const line = unit * (0.047 + energy * 0.04 + (foreground ? 0.012 : 0));
    ctx.save();
    ctx.translate(cx, cy + ribbon.y * unit);
    ctx.rotate(ribbon.tilt + travel * 0.07);
    ctx.globalCompositeOperation = "screen";
    const gradient = ctx.createLinearGradient(-span, 0, span, 0);
    gradient.addColorStop(0, `rgba(${ribbon.cyan}, 0.08)`);
    gradient.addColorStop(0.2, `rgba(${ribbon.cyan}, ${foreground ? 0.45 : 0.24})`);
    gradient.addColorStop(0.52, `rgba(${ribbon.violet}, ${foreground ? 0.52 : 0.26})`);
    gradient.addColorStop(0.8, `rgba(${ribbon.cyan}, ${foreground ? 0.42 : 0.22})`);
    gradient.addColorStop(1, `rgba(${ribbon.violet}, 0.06)`);
    const path = new Path2D();
    path.moveTo(-span, unit * travel * 0.025);
    path.bezierCurveTo(
      -span * 0.56, waveHeight,
      -span * 0.12, -waveHeight * 1.15,
      span * 0.12, waveHeight * 0.52,
    );
    path.bezierCurveTo(
      span * 0.42, waveHeight * 1.08,
      span * 0.68, -waveHeight * 0.7,
      span, unit * travel * -0.02,
    );
    ctx.strokeStyle = gradient;
    ctx.lineWidth = line;
    ctx.lineCap = "round";
    ctx.shadowColor = `rgba(${ribbon.cyan}, ${0.28 + energy * 0.34})`;
    ctx.shadowBlur = unit * (0.055 + energy * 0.045);
    ctx.stroke(path);
    ctx.lineWidth = line * 0.46;
    ctx.shadowBlur = unit * 0.022;
    ctx.strokeStyle = `rgba(212, 248, 255, ${foreground ? 0.44 : 0.22})`;
    ctx.stroke(path);
    ctx.lineWidth = Math.max(0.7, line * 0.12);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 255, 255, ${foreground ? 0.48 : 0.18})`;
    ctx.stroke(path);
    ctx.restore();
  }
}

function drawListeningScan(ctx: CanvasRenderingContext2D, cx: number, cy: number, unit: number, time: number, energy: number) {
  ctx.save();
  ctx.strokeStyle = `rgba(104, 235, 255, ${0.45 + energy * 0.35})`;
  ctx.lineWidth = Math.max(0.75, unit * 0.012);
  ctx.shadowColor = "rgba(85, 206, 255, 0.8)";
  ctx.shadowBlur = unit * 0.05;
  const angle = time * 2.4;
  ctx.beginPath();
  ctx.arc(cx, cy, unit * 0.37, angle, angle + Math.PI * 0.72);
  ctx.stroke();
  ctx.restore();
}

function drawVoiceRipples(ctx: CanvasRenderingContext2D, cx: number, cy: number, unit: number, time: number, energy: number) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 3; i++) {
    const progress = (time * (0.72 + energy * 0.35) + i / 3) % 1;
    ctx.strokeStyle = `rgba(${i === 1 ? "200, 119, 255" : "79, 225, 255"}, ${(1 - progress) * (0.24 + energy * 0.28)})`;
    ctx.lineWidth = Math.max(0.5, unit * 0.008);
    ctx.beginPath();
    ctx.ellipse(cx, cy, unit * (0.27 + progress * 0.24), unit * (0.11 + progress * 0.11), -0.16, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
