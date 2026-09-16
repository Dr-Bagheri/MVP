"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PRODUCT_DEMOS, productDemoMedia, type ProductDemoId } from "@/lib/productDemos";
import { useTheme } from "@/lib/useTheme";
import type { Theme } from "@/lib/theme";

/**
 * Native, silent films. No timer advances a paused clip or interrupts a form.
 *
 * THE FILM JUST PLAYS (user directive, 2026-09-16: "make the video for
 * onboarding and the sign-up page just play, not with clip options that you
 * can stop or change the bar"). No `controls`: a scrubber, a pause key and a
 * mute key on a ten-second silent loop are a player's chrome over a
 * picture, and on the first screen a stranger sees they read as a thing to
 * operate rather than a thing to watch. What a film needs to say for itself
 * is on the page — its title in the chip row, its one sentence under it.
 * A fixed lesson LOOPS (a film that stops on its last frame with no key to
 * restart it reads as broken); the gate's carousel does not loop a clip, it
 * advances to the next one on `ended`, which is the same continuity across
 * five films. Reduced motion keeps the poster still, as before — and with no
 * key to press, the poster IS the picture.
 */
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
      {/* the film's one sentence, and nothing under it: the «ten-second
          samples · fictional data · silent» line left on the user's word
          (2026-09-16) — a caption about the footage is not about the product */}
      <p className="mt-3 text-center text-sm leading-6 text-fg-muted">{t(`${active}Description`)}</p>
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
        muted playsInline loop={onEnded === undefined} preload="metadata" aria-label={t(`${lesson}Title`)} aria-describedby={descriptionId}
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
