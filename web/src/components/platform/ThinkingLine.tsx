"use client";

import { useTranslations } from "next-intl";

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
export function ThinkingLine() {
  const t = useTranslations("platform");
  return (
    <span className="mt-1.5 flex items-center gap-2 text-fg-muted">
      <ThinkingMark />
      {/*
        THE WORD, not the icon alone. A lone spinner says "something is
        happening" and nothing about what — which is what the reported
        screenshot showed: an orange mark on an empty column with no name and
        no sentence beside it.
      */}
      <span className="text-xs">{t("thinking")}</span>
    </span>
  );
}

/** The wait's mark: a ring with a gap, turning. */
export function ThinkingMark() {
  return (
    <svg viewBox="0 0 20 20" className="thinking-spin h-4 w-4 shrink-0" aria-hidden>
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Mid-sentence: the caret goes where the next character will be. */
export function TypingCaret() {
  return <span className="ms-1 animate-pulse text-fg-muted">▍</span>;
}
