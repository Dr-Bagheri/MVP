"use client";

import { useTranslations } from "next-intl";
import type { AgentToolCall } from "@/api/types";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { PHASE_KEYS, runningPhase } from "@/lib/thinkingPhase";

/**
 * THE WAIT, SHOWN — one component, two surfaces.
 *
 * User report, 2026-09-04: "the thinking and its icon for agents and Echo was
 * removed also when you were removing the tools details under it."
 *
 * They were right, and the mechanism is worth writing down. The panel never
 * had a thinking indicator of its own: while a turn ran, the TOOL CHIPS
 * appeared one at a time — «جست‌وجو», «ساخت تسک» — and that is what read as
 * "it is working". So the chips were doing a second job nobody had assigned
 * them, and removing the job they WERE assigned took the other one with it.
 * The panel went from a stream of activity to an avatar, a name, a colon and
 * nothing at all.
 *
 * The lesson, since it will happen again: a thing that incidentally reads as
 * progress is load-bearing even though nothing says so, and deleting it is a
 * change to a feature nobody wrote down.
 *
 * ── WHERE IT SITS ─────────────────────────────────────────────────────────
 *
 * At the FOOT of the message, on its own line, under the name and whatever
 * has been said so far (user directive: "add it under the name and its
 * response in the lowest part like Claude does it"). It used to sit inline
 * right after the name, which put the spinner where the first word was about
 * to appear — so the answer arrived by shoving the indicator sideways.
 * Underneath, the text lands where it was always going to land and the line
 * below it simply goes away.
 *
 * ── TWO WAITS, SAID DIFFERENTLY ───────────────────────────────────────────
 *
 * Nothing written yet is THINKING and gets the spinner and the word. Mid
 * sentence is TYPING and gets the caret, inline, where the next character
 * will be. A blinking cursor in front of an empty answer claims words are
 * arriving when none have; a spinner under a half-written sentence claims the
 * opposite. They are different facts and the screen says which.
 */
export function ThinkingLine({ tools = [] }: { tools?: readonly AgentToolCall[] }) {
  const t = useTranslations("platform");
  const phase = runningPhase(tools);
  /* the tone stays on the ROW: the mark draws in `currentColor`, and the
     shimmer sets its own ink over it */
  return (
    <span className="mt-1.5 flex items-center gap-2 text-fg-muted">
      <ThinkingMark />
      {/*
        THE WORD, not the icon alone. A lone spinner says "something is
        happening" and nothing about what — which is what the reported
        screenshot showed: an orange mark on an empty column with no name and
        no sentence beside it.

        ── AND NOW THE WORD SAYS WHICH WAIT ──────────────────────────────────

        21st.dev's pending-search state (Agent Elements) is a shimmering label
        naming the work — «Searching…» — and no spinner at all. The naming is
        the part worth taking: this line ran for the whole of every turn
        saying «در حال فکر کردن…», including the seconds spent reading a
        transcript or writing a task. It reads the tool that is running RIGHT
        NOW off the message's own `tool_calls` (see lib/thinkingPhase for why
        it is a PHASE and not the tool's own label, and why an unclassified
        tool falls back to this word rather than guessing a verb).

        THE MARK STAYS, against the upstream. It was removed once and the user
        reported it back (2026-09-04: "the thinking and its icon for agents
        and Echo was removed"), so it is not ours to drop for a nicer
        silhouette — and it is what carries the wait when a reader has asked
        for reduced motion, where the shimmer deliberately stops.
      */}
      <TextShimmer className="text-xs">
        {t(phase === null ? "thinking" : PHASE_KEYS[phase])}
      </TextShimmer>
    </span>
  );
}

/** circumference of the ring the mark is drawn on, so the sweep is a percentage */
const RING_C = 2 * Math.PI * 7.5;

/**
 * The wait's mark: a ring with a gap, turning.
 *
 * TWO CIRCLES, NOT A CIRCLE AND AN ARC. The lit part used to be a hand-written
 * arc `path`, which fixed it at exactly a quarter and made the sweep a thing
 * you could only change by re-deriving bezier coordinates. Drawn instead as a
 * second full circle with a `stroke-dasharray` — one dash the length of the
 * sweep, one gap the length of the rest — the proportion is arithmetic on the
 * circumference, and 21st.dev's ring (beautifului.dev) is the same
 * construction at 28%, which sits better than a quarter: enough arc to read
 * as a direction of travel, not so much that the gap stops registering.
 *
 * THE TRACK IS A TOKEN NOW. It was `currentColor` at 0.25 opacity, so it was
 * a function of whatever ink the row inherited AND translucent over whatever
 * was behind it — on the glass surfaces that means the track picks up the
 * panel, the page and the blur, and lands at a different value on each one.
 * `--border` is the decorative-hairline token, which is what a track is, and
 * it is opaque, so the ring is the same ring wherever it is drawn. The lit
 * arc stays `currentColor`: that half SHOULD follow the row's tone.
 */
export function ThinkingMark() {
  /* r=7.5 → C = 2π·7.5 ≈ 47.12; the lit sweep is 28% of it, the gap the rest */
  const dash = `${(RING_C * 0.28).toFixed(2)} ${(RING_C * 0.72).toFixed(2)}`;
  return (
    /* THE <g> TURNS, NOT THE <svg> AND NOT A WRAPPER. Everything about the
       pivot lives in viewBox coordinates, where the ring's centre is the
       literal (10, 10) these circles are drawn around — see globals.css for
       why every version that rotated a LAYOUT box wobbled instead of spinning,
       and why neither a box measurement nor a computed `transform-origin`
       could tell. The <svg> stays the flex child and keeps `shrink-0`. */
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" aria-hidden>
      <g className="thinking-spin">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="rgb(var(--border))" strokeWidth="2" />
        <circle
          cx="10"
          cy="10"
          r="7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      </g>
    </svg>
  );
}

/**
 * Mid-sentence: the caret goes where the next character will be.
 *
 * A DRAWN BAR, NOT A GLYPH. This was `▍` — a real character, so the font
 * decided its width, its height and where it sat on the baseline, and this
 * app renders Persian and Latin in different faces. The caret changed shape
 * depending on the script it was trailing. A 2px box measured in `em` is the
 * same caret after either. See `.stream-caret` in globals.css for the blink,
 * which is `step-end` — on, off, nothing in between — rather than the eased
 * fade of `animate-pulse`, which read as idling rather than as writing.
 */
export function TypingCaret() {
  return <span className="stream-caret" aria-hidden />;
}
