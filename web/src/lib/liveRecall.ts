"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { RecalledDecision } from "@/api/types";

/**
 * Item 7 — the live meeting's quiet second brain, from the page's side.
 *
 * Every few seconds it hands the recent transcript to the server and, when
 * the room is talking about something already decided, a card appears. The
 * server's rule is "at least two distinctive words in common"; this file's
 * job is everything about NOT BEING ANNOYING, which is most of the design:
 *
 *   * it asks at most once every `EVERY_MS`, and only when enough NEW words
 *     have arrived — a window that has not moved cannot produce a new answer,
 *     and asking anyway is a request per tick for the life of the meeting;
 *   * a decision shown once is never shown again in this meeting, even if it
 *     keeps matching — the second appearance of a card somebody has already
 *     read is what teaches them to stop reading;
 *   * a dismissal is permanent for the meeting, for the same reason;
 *   * a failure is SILENT. Recall is a courtesy; a red line on the stage
 *     about a background read nobody asked for is worse than the silence.
 *
 * ── WHY THE WINDOW IS THE TAIL AND NOT THE WHOLE TRANSCRIPT ──────────────
 *
 * A meeting's full transcript matches everything eventually, so recall would
 * become a list of every decision the organisation has ever taken, ordered by
 * nothing. The tail is what the room is on NOW, which is the only thing that
 * makes the card worth interrupting for.
 */

/** How often the server may be asked, at most. */
const EVERY_MS = 12_000;
/** How much of the tail counts as "what is being said now". */
const WINDOW_CHARS = 700;
/** New characters needed before the window is worth asking about again. */
const MIN_NEW_CHARS = 120;

export interface LiveRecall {
  /** what to draw, newest first — already filtered of everything seen */
  cards: RecalledDecision[];
  dismiss: (id: string) => void;
}

/**
 * `enabled` is the host-and-recording gate, passed in rather than derived:
 * the page knows both, and a hook that read them itself would be a second
 * opinion about who the host is.
 */
export function useLiveRecall(
  meetingId: string,
  transcript: string,
  enabled: boolean,
): LiveRecall {
  const [cards, setCards] = useState<RecalledDecision[]>([]);
  /* every id this meeting has already put on screen or had dismissed. A ref,
     not state: it must not cause a render, and it must survive one. */
  const seen = useRef<Set<string>>(new Set());
  const lastAsked = useRef(0);
  const lastLength = useRef(0);
  const inFlight = useRef(false);

  /*
   * Dismissing takes it OFF THE SCREEN, and nothing more.
   *
   * The first version also added the id to `seen`, which reads as the thing
   * that stops a dismissed card coming back — and could never fail, because
   * a card is added to `seen` the moment it is SHOWN and there is no way to
   * dismiss one that was not. Two spellings of one rule, one of them
   * unexercised, is the shape this repo keeps finding; the surviving spelling
   * is the filter below, and its own mutation goes red.
   */
  const dismiss = useCallback((id: string) => {
    setCards((prev) => prev.filter((card) => card.id !== id));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const words = transcript.trim();
    if (words === "") return;
    /* the two throttles are different questions and both have to pass: "has
       enough time passed" and "is there anything new to ask about" */
    if (words.length - lastLength.current < MIN_NEW_CHARS) return;
    if (Date.now() - lastAsked.current < EVERY_MS) return;
    if (inFlight.current) return;

    inFlight.current = true;
    lastAsked.current = Date.now();
    lastLength.current = words.length;
    let live = true;

    void (async () => {
      try {
        const found = await api.recallDecisions(meetingId, words.slice(-WINDOW_CHARS));
        if (!live) return;
        const fresh = found.filter((card) => !seen.current.has(card.id));
        if (fresh.length === 0) return;
        for (const card of fresh) seen.current.add(card.id);
        /* newest arrival on top, and never more than a few on screen: a
           column of cards during a meeting is a second thing to read */
        setCards((prev) => [...fresh, ...prev].slice(0, 3));
      } catch {
        /* SILENT. See the header: a courtesy that failed is not news, and the
           next tick tries again in twelve seconds. */
      } finally {
        inFlight.current = false;
      }
    })();

    return () => { live = false; };
  }, [meetingId, transcript, enabled]);

  return { cards, dismiss };
}
