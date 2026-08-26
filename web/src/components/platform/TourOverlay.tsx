"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { digits } from "@/lib/format";
import { endTour, nextTourStep, subscribeTour, tourSnapshot } from "@/lib/tour";

/**
 * The tour's face: a dimmed screen with ONE hole in it, a ring around the
 * control being taught, and a card beside it saying what to do.
 *
 * The spotlight is four opaque rectangles around the target rather than a
 * clip-path — the hole must not intercept clicks, because "press this" only
 * teaches when pressing it actually works. The four panes catch clicks
 * everywhere else so a mis-click cannot wander the app mid-lesson.
 *
 * A step whose target has not rendered yet is WAITED for (a navigation
 * needs a frame or two), and one whose target never appears is skipped with
 * the skip counted — a tour that points at nothing teaches nothing, and
 * freezing there would trap the person under the dim.
 */

const IDLE: import("@/lib/tour").TourState = { steps: [], at: -1 };

export function TourOverlay() {
  const t = useTranslations("tour");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const tour = useSyncExternalStore(subscribeTour, tourSnapshot, () => IDLE);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = tour.at >= 0 ? tour.steps[tour.at] : undefined;

  /* navigate first, when the step asks for it */
  useEffect(() => {
    if (!step?.href) return;
    if (pathname !== step.href) router.push(step.href);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathname feedback would re-push
  }, [step]);

  /* find the target — poll briefly (the page may still be mounting), track
     it on scroll/resize, and give up out loud rather than hanging */
  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let raf = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
        const measure = () => setRect(el.getBoundingClientRect());
        measure();
        const onMove = () => { raf = requestAnimationFrame(measure); };
        window.addEventListener("scroll", onMove, true);
        window.addEventListener("resize", onMove);
        cleanupMove = () => {
          window.removeEventListener("scroll", onMove, true);
          window.removeEventListener("resize", onMove);
          cancelAnimationFrame(raf);
        };
        return;
      }
      tries += 1;
      if (tries > 25) {
        // ~2.5s: the control is not on this screen — skip, don't trap
        nextTourStep();
        return;
      }
      timer = setTimeout(find, 100);
    };
    let cleanupMove: (() => void) | null = null;
    find();
    return () => {
      if (timer) clearTimeout(timer);
      cleanupMove?.();
    };
  }, [step, pathname]);

  /* Escape leaves the lesson */
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step]);

  if (!step || !rect) return null;

  const PAD = 6;
  const top = Math.max(0, rect.top - PAD);
  const left = Math.max(0, rect.left - PAD);
  const right = Math.min(window.innerWidth, rect.right + PAD);
  const bottom = Math.min(window.innerHeight, rect.bottom + PAD);

  /* the card sits under the hole when there is room, above it otherwise */
  const cardBelow = bottom + 150 < window.innerHeight;
  const cardStyle: React.CSSProperties = {
    position: "fixed",
    ...(cardBelow ? { top: bottom + 10 } : { bottom: window.innerHeight - top + 10 }),
    left: Math.max(12, Math.min(left, window.innerWidth - 332)),
    width: 320,
  };

  const pane = "fixed z-[70] bg-black/55 backdrop-blur-[1px]";
  const last = tour.at === tour.steps.length - 1;

  return (
    <div role="dialog" aria-label={t("label")}>
      {/* four panes = a hole the pointer can reach through */}
      <div className={pane} style={{ inset: `0 0 auto 0`, height: top }} onClick={endTour} />
      <div className={pane} style={{ top, left: 0, width: left, height: bottom - top }} onClick={endTour} />
      <div className={pane} style={{ top, left: right, right: 0, height: bottom - top }} onClick={endTour} />
      <div className={pane} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} onClick={endTour} />

      {/* the ring — pointer-events off so the control stays pressable */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[71] rounded-xl ring-2 ring-accent shadow-[0_0_0_6px_rgb(var(--accent)/0.25)] transition-all duration-200"
        style={{ top, left, width: right - left, height: bottom - top }}
      />

      <div style={cardStyle} className="z-[72] rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
          {t("stepOf", {
            n: digits(tour.at + 1, locale),
            of: digits(tour.steps.length, locale),
          })}
        </p>
        <p dir="auto" className="mt-1.5 text-sm leading-7 text-fg">{step.text}</p>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
            onClick={endTour}
          >
            {t("leave")}
          </button>
          <button
            type="button"
            className="btn-primary h-8 min-h-0 px-4 text-xs"
            onClick={nextTourStep}
          >
            {last ? t("done") : t("next")}
          </button>
        </div>
      </div>
    </div>
  );
}
