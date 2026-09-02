"use client";

import { ConfirmDialog } from "@/components/rowActions";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * THE WHITEBOARD (the big-milestone round, 2026-09-01) — the reference's
 * برگزاری canvas: freehand pen, highlighter, shapes, arrows, text, an
 * object eraser, undo/redo, pan and zoom.
 *
 * What it deliberately is NOT in v1: collaborative or server-persisted.
 * Strokes live in this browser (localStorage per meeting — a per-viewer
 * convenience, the platform's stated pattern for exactly this class), so a
 * reload keeps your board and a colleague's screen shows their own. The
 * honest line about that is in the toolbar's title, not hidden.
 *
 * Geometry: every shape is stored in WORLD coordinates; the view applies
 * pan/zoom at draw time, so zooming never rewrites a stroke.
 */

type Tool = "pen" | "highlight" | "eraser" | "line" | "arrow" | "rect" | "ellipse" | "text" | "hand";

interface Shape {
  tool: Exclude<Tool, "eraser" | "hand">;
  color: string;
  width: number;
  /** pen/highlight: the polyline; others: [start, end] */
  points: Array<{ x: number; y: number }>;
  text?: string;
}

const COLORS = ["#1c1a16", "#0fa85d", "#0369a1", "#c9264a", "#8f5d08"];

function storageKey(meetingId: string): string {
  return `neurai-whiteboard-${meetingId}`;
}

export function Whiteboard({ meetingId }: { meetingId: string }) {
  const t = useTranslations("meetings");
  const tCommon = useTranslations("common");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  /* the text composer: the world point pressed, and the words */
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [shapes, setShapes] = useState<Shape[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey(meetingId));
      return raw === null ? [] : (JSON.parse(raw) as Shape[]);
    } catch {
      return [];
    }
  });
  const [redoStack, setRedoStack] = useState<Shape[]>([]);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  /** the in-flight shape while the pointer is down */
  const drawing = useRef<Shape | null>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);

  const persist = useCallback((next: Shape[]) => {
    try {
      localStorage.setItem(storageKey(meetingId), JSON.stringify(next));
    } catch {
      /* storage can be absent (private window) — the board still works */
    }
  }, [meetingId]);

  /** screen px -> world coords under the current view */
  const toWorld = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - view.x) / view.zoom,
      y: (e.clientY - rect.top - view.y) / view.zoom,
    };
  }, [view]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.translate(view.x, view.y);
    ctx.scale(view.zoom, view.zoom);
    const all = drawing.current === null ? shapes : [...shapes, drawing.current];
    for (const shape of all) {
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = shape.tool === "highlight" ? 0.35 : 1;
      const [a, b] = [shape.points[0], shape.points[shape.points.length - 1]];
      if (!a || !b) continue;
      if (shape.tool === "pen" || shape.tool === "highlight") {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        for (const pt of shape.points) ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      } else if (shape.tool === "line" || shape.tool === "arrow") {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (shape.tool === "arrow") {
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const head = 10 + shape.width * 2;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - head * Math.cos(angle - 0.45), b.y - head * Math.sin(angle - 0.45));
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - head * Math.cos(angle + 0.45), b.y - head * Math.sin(angle + 0.45));
          ctx.stroke();
        }
      } else if (shape.tool === "rect") {
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else if (shape.tool === "ellipse") {
        ctx.beginPath();
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape.tool === "text" && shape.text !== undefined) {
        ctx.font = `${14 + shape.width * 2}px Vazirmatn, sans-serif`;
        ctx.fillText(shape.text, a.x, a.y);
      }
    }
    ctx.globalAlpha = 1;
  }, [shapes, view]);

  /* size the canvas to its box at device resolution; observe resizes */
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (wrap === null || canvas === null) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(redraw, [redraw]);

  const commit = (shape: Shape) => {
    setShapes((prev) => {
      const next = [...prev, shape];
      persist(next);
      return next;
    });
    setRedoStack([]);
  };

  /** the object eraser: remove the shape nearest the press, within reach */
  const eraseAt = (world: { x: number; y: number }) => {
    setShapes((prev) => {
      let bestIdx = -1;
      let bestDist = 24 / view.zoom;
      prev.forEach((shape, i) => {
        for (const pt of shape.points) {
          const d = Math.hypot(pt.x - world.x, pt.y - world.y);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
      });
      if (bestIdx === -1) return prev;
      const next = prev.filter((_, i) => i !== bestIdx);
      persist(next);
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === "hand" || e.button === 1) {
      panning.current = { x: e.clientX - view.x, y: e.clientY - view.y };
      return;
    }
    const world = toWorld(e);
    if (tool === "eraser") { eraseAt(world); return; }
    if (tool === "text") {
      /* the platform's dialog, never the browser's (user directive,
         2026-09-02) — and the world point is remembered so the text lands
         where the person pressed, not where the pointer ended up */
      setTextAt(world);
      setTextValue("");
      return;
    }
    drawing.current = {
      tool,
      color,
      width: tool === "highlight" ? 12 : 2.5,
      points: [world],
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panning.current !== null) {
      setView((v) => ({ ...v, x: e.clientX - panning.current!.x, y: e.clientY - panning.current!.y }));
      return;
    }
    const shape = drawing.current;
    if (shape === null) return;
    const world = toWorld(e);
    if (shape.tool === "pen" || shape.tool === "highlight") shape.points.push(world);
    else shape.points = [shape.points[0]!, world];
    redraw();
  };

  const onPointerUp = () => {
    panning.current = null;
    const shape = drawing.current;
    if (shape === null) return;
    drawing.current = null;
    if (shape.points.length > 1) commit(shape);
    else redraw();
  };

  const undo = () => {
    setShapes((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      setRedoStack((r) => [...r, prev[prev.length - 1]!]);
      persist(next);
      return next;
    });
  };
  const redo = () => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const shape = r[r.length - 1]!;
      setShapes((prev) => {
        const next = [...prev, shape];
        persist(next);
        return next;
      });
      return r.slice(0, -1);
    });
  };
  const clear = () => {
    setShapes((prev) => {
      if (prev.length === 0) return prev;
      setRedoStack((r) => [...r, ...prev]);
      persist([]);
      return [];
    });
  };
  const zoomBy = (factor: number) => {
    setView((v) => ({ ...v, zoom: Math.min(4, Math.max(0.25, v.zoom * factor)) }));
  };

  const toolBtn = (key: Tool, glyph: React.ReactNode, label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={tool === key}
      aria-label={label}
      title={label}
      onClick={() => setTool(key)}
      className={`tap grid h-9 w-9 place-items-center rounded-lg text-sm transition-colors ${
        tool === key ? "bg-accent-soft text-accent" : "text-fg-muted hover:text-fg"
      }`}
    >
      {glyph}
    </button>
  );

  return (
    <div ref={wrapRef} className="relative min-h-[420px] flex-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <canvas
        ref={canvasRef}
        className={tool === "hand" ? "cursor-grab" : "cursor-crosshair"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))}
      />

      {shapes.length === 0 && drawing.current === null ? (
        <p className="pointer-events-none absolute inset-x-0 top-16 text-center text-xs text-fg-subtle">
          {t("whiteboardHint")}
        </p>
      ) : null}

      {/* ── the toolbar, floated over the canvas like the reference ──── */}
      <div
        className="absolute inset-x-0 top-3 mx-auto flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-surface p-1 shadow-card"
        title={t("whiteboardLocalNote")}
      >
        {toolBtn("hand", "✋", t("wbHand"))}
        {toolBtn("pen", "✏️", t("wbPen"))}
        {toolBtn("highlight", "🖍️", t("wbHighlight"))}
        {toolBtn("line", "─", t("wbLine"))}
        {toolBtn("arrow", "→", t("wbArrow"))}
        {toolBtn("rect", "▢", t("wbRect"))}
        {toolBtn("ellipse", "◯", t("wbEllipse"))}
        {toolBtn("text", "T", t("wbText"))}
        {toolBtn("eraser", "⌫", t("wbEraser"))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={color === c}
            aria-label={t("wbColor")}
            onClick={() => setColor(c)}
            className={`tap grid h-9 w-7 place-items-center ${color === c ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
          >
            <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: c }} />
          </button>
        ))}
      </div>

      {/* ── undo / zoom cluster, bottom corner ───────────────────────── */}
      <div className="absolute bottom-3 start-3 flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-card">
        <button type="button" aria-label={t("wbUndo")} title={t("wbUndo")} onClick={undo}
          className="tap grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:text-fg">↶</button>
        <button type="button" aria-label={t("wbRedo")} title={t("wbRedo")} onClick={redo}
          disabled={redoStack.length === 0}
          className="tap grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:text-fg disabled:opacity-40">↷</button>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <button type="button" aria-label={t("wbZoomOut")} title={t("wbZoomOut")} onClick={() => zoomBy(1 / 1.2)}
          className="tap grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:text-fg">−</button>
        <span className="badge-num min-w-11 text-center text-[11px] text-fg-muted">{Math.round(view.zoom * 100)}%</span>
        <button type="button" aria-label={t("wbZoomIn")} title={t("wbZoomIn")} onClick={() => zoomBy(1.2)}
          className="tap grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:text-fg">+</button>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <button type="button" aria-label={t("wbClear")} title={t("wbClear")} onClick={clear}
          className="tap grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:text-danger">🗑</button>
      </div>
      {textAt !== null ? (
        <ConfirmDialog
          title={t("whiteboardTextPrompt")}
          body={
            <input
              autoFocus
              className="input"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
            />
          }
          confirmLabel={tCommon("add")}
          cancelLabel={tCommon("cancel")}
          danger={false}
          confirmDisabled={textValue.trim() === ""}
          onCancel={() => setTextAt(null)}
          onConfirm={() => {
            const at = textAt;
            const text = textValue.trim();
            setTextAt(null);
            commit({ tool: "text", color, width: 2, points: [at], text });
          }}
        />
      ) : null}
    </div>
  );
}
