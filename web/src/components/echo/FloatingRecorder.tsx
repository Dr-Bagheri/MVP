"use client";

import { useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import {
  finish,
  pause,
  recorderSnapshot,
  resume,
  subscribeRecorder,
} from "@/lib/recordingEngine";
import { formatClock } from "@/lib/format";

/**
 * The floating mini recorder (user directive, 2026-08-22): while a take is
 * live and the person is ANYWHERE but the recorder screen, this pill keeps
 * it visible and controllable — the red dot, the clock, pause/resume,
 * finish, and a click through to the full recorder. It exists because the
 * engine now survives navigation; a rolling mic with no visible presence
 * would be the worst kind of quiet.
 *
 * Hidden on the recorder's own screens (/echo new-meeting and its aliases)
 * — two live controls for one take is how they disagree.
 */
export function FloatingRecorder() {
  const t = useTranslations("capture");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const s = useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot);

  const live = s.phase === "recording" || s.phase === "paused" || s.phase === "finishing";
  if (!live) return null;

  // the recorder screen renders the full controls — the pill stands down
  // (locale-stripped pathname; aliases record/upload/new-meeting land there)
  const onRecorderScreen =
    pathname === "/echo" ||
    pathname.startsWith("/echo/new-meeting") ||
    pathname.startsWith("/echo/record") ||
    pathname.startsWith("/echo/upload");
  if (onRecorderScreen) return null;

  return (
    <div className="fixed bottom-4 start-4 z-40 flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pe-2 ps-3 shadow-xl">
      <button
        type="button"
        className="tap flex items-center gap-2"
        onClick={() => router.push("/echo")}
        aria-label={t("pillOpen")}
        title={t("pillOpen")}
      >
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            s.phase === "recording" ? "animate-pulse bg-danger" : "bg-fg-subtle"
          }`}
          aria-hidden
        />
        <span className="max-w-32 truncate text-xs font-medium text-fg">
          {s.title || t("untitledCall")}
        </span>
        <span className="ltr text-xs tabular-nums text-fg-muted">
          {formatClock(Math.floor(s.recordedMs / 1000), locale)}
        </span>
      </button>
      {s.phase === "finishing" ? (
        <span className="px-2 text-xs text-fg-muted">{t("finishing")}</span>
      ) : (
        <>
          {s.phase === "recording" ? (
            <button
              type="button"
              className="tap h-7 rounded-full px-2.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
              onClick={pause}
            >
              {t("pause")}
            </button>
          ) : (
            <button
              type="button"
              className="tap h-7 rounded-full px-2.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
              onClick={resume}
            >
              {t("resume")}
            </button>
          )}
          <button
            type="button"
            className="tap h-7 rounded-full bg-accent px-2.5 text-xs font-semibold text-on-accent"
            onClick={() => void finish()}
          >
            {t("finish")}
          </button>
        </>
      )}
    </div>
  );
}
