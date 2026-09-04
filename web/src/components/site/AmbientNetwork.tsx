"use client";

import { useEffect, useRef } from "react";

/**
 * THE HERO'S AMBIENT FIELD — a network of agents, not a galaxy and not a
 * brain (2026-09-05, the site redesign).
 *
 * Drifting points joined by fainter lines, drawn almost too dark to see. It
 * is background: if it ever competes with the headline it is wrong, which is
 * why the alpha caps at 0.44 on a line and the points are barely over one
 * pixel.
 *
 * `prefers-reduced-motion` HOLDS IT STILL rather than hiding it. A blank
 * hero for somebody who asked for less movement is a different page, not a
 * calmer one — so the field is painted once and never animated.
 *
 * The colours come from CSS custom properties rather than literals, because
 * a canvas cannot inherit a token: read at paint time, they follow the theme
 * the same way every other surface does.
 */
type Point = { x: number; y: number; vx: number; vy: number };

export function AmbientNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let points: Point[] = [];

    const resize = () => {
      /* capped at 2: a 3x display would quadruple the fill cost of a
         decoration nobody is looking at */
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = rect.width < 640 ? 22 : 46;
      points = Array.from({ length: count }, (_, index) => ({
        x: (((index * 79) % count) / count) * rect.width,
        y: (((index * 47) % count) / count) * rect.height,
        vx: ((index % 5) - 2) * 0.014,
        vy: ((((index * 3) % 5)) - 2) * 0.012,
      }));
    };

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      const style = getComputedStyle(canvas);
      const line = style.getPropertyValue("--network-line").trim();
      const point = style.getPropertyValue("--network-point").trim();
      context.lineWidth = 0.65;
      points.forEach((current, index) => {
        if (!reduced) {
          current.x = (current.x + current.vx + rect.width) % rect.width;
          current.y = (current.y + current.vy + rect.height) % rect.height;
        }
        for (let next = index + 1; next < points.length; next += 1) {
          const other = points[next];
          if (!other) continue;
          const distance = Math.hypot(current.x - other.x, current.y - other.y);
          if (distance < 155) {
            context.globalAlpha = (1 - distance / 155) * 0.44;
            context.strokeStyle = line;
            context.beginPath();
            context.moveTo(current.x, current.y);
            context.lineTo(other.x, other.y);
            context.stroke();
          }
        }
        context.globalAlpha = 0.7;
        context.fillStyle = point;
        context.beginPath();
        context.arc(current.x, current.y, 1.15, 0, Math.PI * 2);
        context.fill();
      });
      context.globalAlpha = 1;
      if (!reduced) frame = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const observer = new ResizeObserver(() => { resize(); draw(); });
    observer.observe(canvas);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  return <canvas ref={canvasRef} className="network-canvas" aria-hidden />;
}
