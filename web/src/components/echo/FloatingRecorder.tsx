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
 * The mini recorder (user directive, 2026-08-22): while a take is live and
 * the person is ANYWHERE but the recorder screen, this pill keeps it visible
 * and controllable — the red dot, the clock, pause/resume, finish, and a
 * click through to the full recorder. It exists because the engine survives
 * navigation; a rolling mic with no visible presence would be the worst kind
 * of quiet.
 *
 * Placement. It USED to dock into the top bar's `recorderAnchor`, in the
 * end
 * cluster — and the bar's search box is centred on the WINDOW now, on a
 * full-width absolute layer, so the pill and the field shared the same
 * strip and the field's layer won: a rolling microphone reading as a
 * smear behind the search box.
 *
 * So the pill left the bar entirely. It floats over the assistant column —
 * inline-end, just under the bar — as its own glass sheet at z-40, which is
 * above the assistant's z-30 and below the modal layer. Nothing in the
 * chrome can cover it, and it is beside the thing a person is most likely
 * to be looking at while a take rolls.
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

  /*
   * THERE IS NO RECORDER SCREEN ANY MORE (user directive, 2026-09-04: the
   * Echo surface is gone).
   *
   * This stood the pill down on `/echo` and its capture aliases, because that
   * page drew the full controls itself and two renderings of one rolling
   * microphone are two things to keep in step. Those pages no longer exist,
   * so the condition is one place: the MEETING's own page, below, which is
   * where a take is started now.
   */
  /*
   * A MEETING'S OWN PAGE renders the take as well — its top bar carries the
   * clock and the end button, and its stage carries the light. With this
   * pill there too, one rolling microphone was shown in three places at once
   * (observed 2026-09-02), and three renderings of one fact are three
   * things to keep in step. Same reasoning as the recorder screen above: the
   * pill exists for ANYWHERE ELSE, where nothing would otherwise say a mic
   * is open.
   */
  const onMeetingPage = /^\/meetings\/[^/]+/.test(pathname);
  if (onMeetingPage) return null;

  return (
    <div
      /*
       * NOTHING IN THIS PILL WRAPS. «پایان و پردازش» is long enough to break
       * onto a second line inside a short box — which does not make the pill
       * taller, it makes its contents overflow it (observed 2026-09-02).
       * `whitespace-nowrap` on the row and `shrink-0` on every control is the
       * fix; the TITLE is the one thing allowed to give way, because a
       * truncated title still says which take this is.
       *
       * `.glass` rather than `bg-surface`: the sheet is the platform's one
       * recipe for a surface that floats over content, and over the
       * assistant's own glass it is what makes the pill read as ABOVE the
       * chat rather than as a patch cut into it.
       *
       * `top` is the bar's height plus a gap, from the `topbar` token the
       * bar itself renders at — never a repeated literal. `end-4` is the
       * INLINE end, so the pill sits over the assistant column in English
       * and over it in Persian too, instead of flipping to the far side.
       */
      className="glass fixed end-4 top-[calc(theme(height.topbar)+0.5rem)] z-40 flex items-center gap-2 whitespace-nowrap rounded-full py-1.5 pe-2 ps-3 shadow-island"
    >
      <button
        type="button"
        className="tap flex min-w-0 items-center gap-2"
        /* STRAIGHT TO THE TAKE. The engine remembers the screen the take was
           started on;
           the meetings list is the fallback for a take that has no screen of
           its own (the hub's), not the destination. */
        onClick={() => router.push(s.returnPath ?? "/meetings")}
        aria-label={t("pillOpen")}
        title={t("pillOpen")}
      >
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
            s.phase === "recording" ? "animate-pulse bg-danger" : "bg-fg-subtle"
          }`}
          aria-hidden
        />
        <span className="max-w-32 truncate text-xs font-medium text-fg">
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
            /* the full sentence stays reachable as the tooltip — a floating
               pill has room for a verb, not for a description of the job */
            title={t("finish")}
          >
            {t("finishShort")}
          </button>
        </>
      )}
    </div>
  );
}
