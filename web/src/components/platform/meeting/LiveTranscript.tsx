"use client";

import { useTranslations } from "next-intl";
import type { CaptionRow } from "@/lib/captionRows";
import { establishedSpeakers } from "@/lib/liveSpeakers";
import { useThreadFollow } from "@/lib/threadFollow";
import { digits, formatClock } from "@/lib/format";
/* the record's own four tones, so a voice looks the same either side of the
   finish — Review.tsx owns the list and this reads it */
import { SPEAKER_TONES } from "./Review";

/**
 * THE TRANSCRIPT AS IT IS BEING MADE.
 *
 * NOTHING NEW IS PRODUCED HERE. The engine has opened a live caption lane on
 * every take since M38 — `startLiveCaptions` runs unconditionally beside the
 * part recorder — and its rows have been reaching this page's snapshot the
 * whole time with nobody rendering them. So this is a READER, and that is
 * why it takes rows rather than a call id: no fetch, no poll, no second
 * source of truth about what was said.
 *
 * IT WEARS THE RECORD'S SHAPE, on the directive's own words ("similar to how
 * it looks in the regular transcription"): the tone circle, the name and the
 * clock on one line, the words under them. What it does NOT wear is the
 * record's two affordances — a voice cannot be re-linked and a line cannot be
 * played from — because neither exists yet: there is no stored speaker to
 * link and no audio to seek. Offering either would be a control that refuses.
 *
 * ── WHAT A LIVE ROW MAY CLAIM ────────────────────────────────────────────
 *
 * The provider's label is a guess in progress. `establishedSpeakers` is the
 * rule that decides when there is enough behind one to say a number out loud
 * (lib/liveSpeakers, with its own tests), and a label under that bar renders
 * with NO badge at all — the words were said and stay; we simply do not claim
 * they were somebody else. That is the same judgement the Echo recorder
 * makes, taken from the same module rather than re-derived here.
 *
 * The interim fragment is drawn muted and unstamped, because it is not yet a
 * row: the provider can and does revise it.
 */
export function LiveTranscript({ rows, interim, speakers, lane, locale }: {
  rows: readonly CaptionRow[];
  /** the fragment the provider has not finalised — may still change */
  interim: string;
  /** every label the lane has attached, in first-heard order */
  speakers: readonly string[];
  /**
   * WHICH NOTHING (rule 12). `off` = the take has not started; `down` = the
   * lane was asked for and refused, and the recording carries on without it;
   * `on` = it is listening, whether or not it has heard a word yet.
   */
  lane: "off" | "down" | "on";
  locale: string;
  /*
   * NO FLOOR IS RESERVED (user report, 2026-09-15: "when the record started
   * [it] went to scroll mode and showed me the bottom of it and i didnt see
   * the text"). There used to be a `footRoom` prop here — 224px of bottom
   * padding held for the whole take, so that the recall cards floating over
   * this box's FOOT could never cover the newest line. On a laptop the box is
   * ~300px tall, so the padding WAS the box: the follow pinned to the bottom,
   * the bottom was empty, and the words sat above the fold from the very
   * first row. The cards float over the box's TOP corner now (RecallCards.tsx,
   * over the oldest lines), the newest line is the last thing in the
   * scroller, and that is exactly what `useThreadFollow` pins to.
   */
  /*
   * IT IS ITS OWN TILE AGAIN (2026-09-16). There was an `embedded` form here
   * — no card, a rule under the clock — for the stretch when the whole live
   * stage was ONE card and a tile nested in a tile would have been two frames
   * around one thing. The stage is three surfaces now (the control row, these
   * words, the people beside them), so the transcript owns its own frame and
   * the flag has no caller; a second shape kept for nobody is the next
   * screen's chance to look different for no reason.
   */
}) {
  const t = useTranslations("meetings");
  const follow = useThreadFollow();
  const voices = establishedSpeakers(speakers, rows);

  const body = () => {
    if (lane === "down") return <p className="text-xs text-fg-muted">{t("liveUnavailable")}</p>;
    if (lane === "off") return <p className="text-sm text-fg-muted">{t("liveIdle")}</p>;
    if (rows.length === 0 && interim === "") {
      return <p className="text-sm text-fg-muted">{t("liveWaiting")}</p>;
    }
    return (
      <div
        ref={follow.scrollerRef}
        onScroll={follow.onScroll}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto pe-1"
      >
        {/* ONE wrapper, because the follow watches exactly one element: the
            interim line grows and shrinks between renders, and a sibling of
            the observed box would move the bottom without being seen */}
        <ol ref={follow.contentRef} className="space-y-3">
          {rows.map((row, i) => {
            const at = row.speaker === undefined ? -1 : voices.indexOf(row.speaker);
            const tone = at >= 0 ? SPEAKER_TONES[at % SPEAKER_TONES.length]! : null;
            const name = at >= 0 ? t("speakerNamed", { n: digits(at + 1, locale) }) : null;
            return (
              /* the key is the INDEX and it is correct here: a live row is
                 only ever appended to or added after, never reordered or
                 removed, so the index is the row's identity for its whole
                 life */
              <li key={i} className="flex items-start gap-2.5">
                {tone !== null && name !== null ? (
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${tone}`} aria-hidden>
                    {digits(at + 1, locale)}
                  </span>
                ) : (
                  /* a voice we will not name still holds the column, so the
                     words of a named and an unnamed turn start on one line */
                  <span className="h-7 w-7 shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    {name !== null ? (
                      <span className="text-xs font-semibold text-fg">{name}</span>
                    ) : null}
                    {/* the take's own clock, not the wall's — the same reading
                        the record's transcript shows, so a line found here is
                        findable there */}
                    <span className="text-caption tabular-nums text-fg-subtle" dir="ltr">
                      {formatClock(Math.floor(row.atMs / 1000), locale)}
                    </span>
                  </div>
                  <p dir="auto" className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-fg">
                    {row.text}
                  </p>
                </div>
              </li>
            );
          })}
          {interim !== "" ? (
            /* indented to the words' own column, muted, and NOT a row: it
               carries no stamp because the moment it belongs to is not
               settled either */
            <li dir="auto" className="ps-[2.375rem] text-sm leading-6 text-fg-muted">{interim}</li>
          ) : null}
        </ol>
      </div>
    );
  };

  return (
    <section
      aria-label={t("liveTranscript")}
      className="tile flex min-h-0 flex-1 flex-col p-4"
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="h-card flex items-center gap-2">
          {lane === "on" ? (
            <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />
          ) : null}
          {t("liveTranscript")}
        </h3>
        {rows.length > 0 ? (
          <span className="text-caption text-fg-subtle">
            {t("transcriptCount", { n: digits(rows.length, locale) })}
          </span>
        ) : null}
      </header>
      {body()}
    </section>
  );
}
