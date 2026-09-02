"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import {
  finish,
  pause,
  recorderSnapshot,
  resume,
  subscribeRecorder,
} from "@/lib/recordingEngine";
import {
  getRecorderAnchorSnapshot,
  getServerRecorderAnchorSnapshot,
  subscribeRecorderAnchor,
} from "@/components/platform/recorderAnchor";
import { formatClock } from "@/lib/format";

/**
 * The mini recorder (user directive, 2026-08-22): while a take is live and
 * the person is ANYWHERE but the recorder screen, this pill keeps it visible
 * and controllable — the red dot, the clock, pause/resume, finish, and a
 * click through to the full recorder. It exists because the engine survives
 * navigation; a rolling mic with no visible presence would be the worst kind
 * of quiet.
 *
 * Placement (user directive, 2026-08-23): it DOCKS into the top bar beside
 * the calendar/clock, at the centre-side end of that cluster — the bar
 * offers `recorderAnchor` and the pill portals in, styled like the bar's
 * other bordered controls. Screens without the bar (the platform console,
 * auth) register no anchor, and the pill falls back to floating: a live mic
 * must never be invisible.
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
  const anchor = useSyncExternalStore(
    subscribeRecorderAnchor,
    getRecorderAnchorSnapshot,
    getServerRecorderAnchorSnapshot,
  );

  const live = s.phase === "recording" || s.phase === "paused" || s.phase === "finishing";
  if (!live) return null;

  // the recorder screen renders the full controls — the pill stands down
  // (locale-stripped pathname; aliases record/upload/new-meeting land there).
  // Matched by SEGMENT, not prefix: startsWith("/echo/record") also swallowed
  // "/echo/records" — the records LIST — and the pill silently never showed
  // there while a take was rolling.
  const echoSection =
    pathname === "/echo" ? "" : pathname.startsWith("/echo/") ? (pathname.split("/")[2] ?? "") : null;
  const onRecorderScreen =
    echoSection !== null && ["", "new-meeting", "record", "upload"].includes(echoSection);
  /*
   * A MEETING'S OWN PAGE renders the take as well — its top bar carries the
   * clock and the end button, and its stage carries the light. With this
   * pill there too, one rolling microphone was shown in three places at once
   * (user report, 2026-09-02), and three renderings of one fact are three
   * things to keep in step. Same reasoning as the recorder screen above: the
   * pill exists for ANYWHERE ELSE, where nothing would otherwise say a mic
   * is open.
   */
  const onMeetingPage = /^\/meetings\/[^/]+/.test(pathname);
  if (onRecorderScreen || onMeetingPage) return null;

  const docked = anchor !== null;

  const pill = (
    <div
      /*
       * NOTHING IN THIS PILL WRAPS. It is a fixed-height strip in the top bar,
       * and «پایان و پردازش» is long enough to break onto a second line inside
       * a 36px box — which does not make the pill taller, it makes its
       * contents overflow it (user report, 2026-09-02, with the screenshot).
       * `whitespace-nowrap` on the row and `shrink-0` on every control is the
       * fix; the TITLE is the one thing allowed to give way, because a
       * truncated title still says which take this is.
       */
      className={
        docked
          ? "flex h-9 min-w-0 items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-surface pe-1 ps-2.5"
          : "fixed bottom-4 start-4 z-40 flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface py-1.5 pe-2 ps-3 shadow-xl"
      }
    >
      <button
        type="button"
        className="tap flex min-w-0 items-center gap-2"
        onClick={() => router.push("/echo")}
        aria-label={t("pillOpen")}
        title={t("pillOpen")}
      >
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
            s.phase === "recording" ? "animate-pulse bg-danger" : "bg-fg-subtle"
          }`}
          aria-hidden
        />
        <span
          className={`truncate text-xs font-medium text-fg ${
            docked ? "hidden max-w-28 md:inline" : "max-w-32"
          }`}
        >
          {s.title || t("untitledCall")}
        </span>
        <span className="ltr shrink-0 text-xs tabular-nums text-fg-muted">
          {formatClock(Math.floor(s.recordedMs / 1000), locale)}
        </span>
      </button>
      {s.phase === "finishing" ? (
        <span className="shrink-0 px-2 text-xs text-fg-muted">{t("finishing")}</span>
      ) : (
        <>
          {s.phase === "recording" ? (
            <button
              type="button"
              className="btn btn-sm shrink-0 font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
              onClick={pause}
            >
              {t("pause")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm shrink-0 font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
              onClick={resume}
            >
              {t("resume")}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm shrink-0 bg-accent text-on-accent"
            onClick={() => void finish()}
            /* the full sentence stays reachable as the tooltip — the docked
               strip has room for a verb, not for a description of the job */
            title={t("finish")}
          >
            {docked ? t("finishShort") : t("finish")}
          </button>
        </>
      )}
    </div>
  );

  return docked ? createPortal(pill, anchor) : pill;
}
