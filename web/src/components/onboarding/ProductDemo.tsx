"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PRODUCT_DEMOS, productDemoMedia, type ProductDemoId } from "@/lib/productDemos";
import { useTheme } from "@/lib/useTheme";
import type { Theme } from "@/lib/theme";

/** Native, silent films. No timer advances a paused clip or interrupts a form. */
export function ProductDemo({ lesson, autoPlay = true }: { lesson?: ProductDemoId; autoPlay?: boolean }) {
  const t = useTranslations("productDemo");
  const locale = useLocale();
  const theme = useTheme();
  const [selected, setSelected] = useState<ProductDemoId>("meeting");
  const active = lesson ?? selected;
  return (
    <section aria-label={t("label")} className="w-full">
      <DemoFilm
        key={`${locale}-${theme}-${active}`}
        lesson={active}
        theme={theme}
        autoPlay={autoPlay}
        onEnded={lesson ? undefined : () => setSelected(PRODUCT_DEMOS[(PRODUCT_DEMOS.indexOf(active) + 1) % PRODUCT_DEMOS.length]!)}
      />
      {!lesson && (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label={t("choose")} role="group">
          {PRODUCT_DEMOS.map((id) => (
            <button key={id} type="button" aria-pressed={id === active} onClick={() => setSelected(id)}
              className={`btn btn-sm ${id === active ? "bg-accent-soft text-accent" : "btn-ghost text-fg-muted"}`}>
              {t(`${id}Title`)}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-sm leading-6 text-fg-muted">{t(`${active}Description`)}</p>
      <p className="mt-2 text-center text-xs leading-5 text-fg-subtle">{t("sample")}</p>
    </section>
  );
}

function DemoFilm({ lesson, theme, autoPlay, onEnded }: { lesson: ProductDemoId; theme: Theme; autoPlay: boolean; onEnded?: () => void }) {
  const locale = useLocale();
  const t = useTranslations("productDemo");
  const media = productDemoMedia(lesson, locale, theme);
  const videoRef = useRef<HTMLVideoElement>(null);
  const allowAdvance = useRef(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const descriptionId = useId();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const automatic = () => autoPlay && !motion?.matches && !connection?.saveData;
    let inView = typeof IntersectionObserver === "undefined";
    let wasVisible = false;
    let resume = automatic();
    let live = true;
    const sync = () => {
      const visible = inView && !document.hidden;
      if (visible === wasVisible) return;
      if (visible) {
        if (resume && live) void video.play()?.catch(() => undefined);
      } else {
        resume = !video.paused;
        if (!video.paused) video.pause();
      }
      wasVisible = visible;
    };
    const preference = () => {
      allowAdvance.current = automatic();
      if (!automatic()) { resume = false; if (!video.paused) video.pause(); }
    };
    allowAdvance.current = automatic();
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      inView = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.15); sync();
    }, { threshold: 0.15 });
    observer?.observe(video);
    document.addEventListener("visibilitychange", sync);
    motion?.addEventListener?.("change", preference);
    sync();
    return () => {
      live = false;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion?.removeEventListener?.("change", preference);
      if (!video.paused) video.pause();
    };
  }, [autoPlay, attempt]);

  return (
    <div>
      <video key={attempt} ref={videoRef} className="aspect-[4/3] w-full rounded-2xl bg-surface-2"
        width={1280} height={960} src={media.src} poster={media.poster}
        controls muted playsInline preload="metadata" aria-label={t(`${lesson}Title`)} aria-describedby={descriptionId}
        onError={() => setFailed(true)} onEnded={() => { if (allowAdvance.current && !document.hidden) onEnded?.(); }}>
        <track kind="captions" src={media.captions} srcLang={media.language} label={media.language === "fa" ? "فارسی" : "English"} />
        {t("unsupported")}
      </video>
      <span id={descriptionId} className="sr-only">{t(`${lesson}Description`)}</span>
      {failed && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-fg-muted" role="status">
          <span>{t("unavailable")}</span>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>{t("retry")}</button>
        </div>
      )}
    </div>
  );
}
