"use client";

/**
 * Dictation for the assistant composer — the mic button's actual job.
 *
 * Uses the browser's SpeechRecognition (Chrome/Edge; Google's recognizer
 * handles fa-IR). This is deliberately NOT Echo's pipeline: Echo records
 * calls into storage for transcription and summary; this turns a spoken
 * sentence into composer text and keeps nothing. Different promise,
 * different machinery.
 *
 * The absence taxonomy matters here (rule 12): "this browser cannot do
 * this" (unsupported), "the person said no" (denied), and "it stopped"
 * (idle) are three different nothings, and the button must not render
 * them as one.
 *
 * ── THE SESSION IS NOT THE MICROPHONE ────────────────────────────────────
 *
 * Four user reports, one cause. 2026-09-04: "it will be cut mid command";
 * "the voice hotkey does not work now". 2026-09-05: "make it push to talk".
 * 2026-09-06: "after a couple of seconds it does not hear me any more, and
 * it gave me less than half the sentences I talked."
 *
 * Chrome ENDS A RECOGNITION SESSION BY ITSELF — on a pause, on a network
 * hiccup, on its own timers — whatever `continuous` says. So "is the
 * microphone open" and "is a session running" stop being the same question
 * the moment the person pauses for breath, and every earlier version of this
 * file conflated them somewhere: `onend` went to idle (the cut command); a
 * transient error reported idle (the dead hotkey); a restart of the SAME
 * object inside `onend` that threw was treated as the person stopping (the
 * mic that stops hearing after a couple of seconds); and with
 * `interimResults` off, every word Chrome had heard but not yet finalised
 * when the session died went nowhere (the half sentences).
 *
 * So this file keeps three things apart and never lets one stand in for
 * another:
 *   · `wantRef`   — the PERSON's wish: the button pressed, the key held
 *   · `recRef`    — the live SESSION, if there is one right now
 *   · `pendingRef`— the words heard so far that Chrome has not finalised
 * A session that ends while the wish stands is REOPENED — a fresh object,
 * after a short delay, because restarting the object that just died is the
 * call that used to throw — and everything it had heard lands in the box
 * before it goes. Press and release, the status, and the reopen all read
 * the wish, never the session.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type DictationStatus = "idle" | "listening" | "unsupported" | "denied";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?: () => void;
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function recognitionCtor(): (new () => RecognitionLike) | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => RecognitionLike)
    | undefined;
}

/**
 * How long after Chrome closes a session before a fresh one is opened. Long
 * enough for the engine to release the capture it just closed (a start on
 * its heels is the call that failed), short enough that a breath in the
 * middle of a sentence loses nothing — the pending words are already in the
 * box by then.
 */
export const REOPEN_DELAY_MS = 150;

/**
 * WHAT A MIC LOOKS LIKE WHILE IT IS LISTENING (user report, 2026-09-05: "the
 * mic in the chat does not show when it is active — make the 3 of them the
 * same way").
 *
 * The three surfaces with a mic — the assistant page, the assistant sidebar
 * and the room's composer — had two answers between them, and the room's was
 * silently broken: it wrote `text-danger` NEXT TO the `text-fg-subtle` its
 * base class already carried, and two utilities setting the same property are
 * resolved by their order in the STYLESHEET, not in the string. So the class
 * was present, a reviewer could see it, a grep could find it, and the glyph
 * never changed colour. That is the CSS-layer failure this repo keeps
 * meeting: the artifact reads as satisfied and only the computed value
 * disagrees.
 *
 * One function, so there is one answer. It returns the WHOLE tone — ground
 * and ink together — precisely so no caller has to compose it with a base
 * class that also sets a colour.
 */
export function micTone(status: DictationStatus): string {
  return status === "listening"
    ? "animate-pulse bg-accent-soft text-accent"
    : "text-fg-muted hover:bg-surface-2 hover:text-fg";
}

export function useDictation(
  lang: string,
  onText: (text: string) => void,
): { status: DictationStatus; toggle: () => void; start: () => void; stop: () => void } {
  const [status, setStatus] = useState<DictationStatus>("idle");
  // refs, not closures: the handlers fire long after the render that created
  // them, and a stale onText would append into an input state that no longer
  // exists
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const langRef = useRef(lang);
  langRef.current = lang;
  /** the person's wish — pressed, or holding the key */
  const wantRef = useRef(false);
  /** the live session, if any */
  const recRef = useRef<RecognitionLike | null>(null);
  /** a reopen waiting its delay */
  const reopenRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** words heard, not yet finalised — delivered if the session dies on them */
  const pendingRef = useRef("");

  /** consecutive transient errors (network / audio-capture) since the last word */
  const errorRunRef = useRef(0);

  const cancelReopen = useCallback(() => {
    if (reopenRef.current !== null) {
      clearTimeout(reopenRef.current);
      reopenRef.current = null;
    }
  }, []);

  const open = useCallback(function open(): void {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      wantRef.current = false;
      setStatus("unsupported");
      return;
    }
    const rec = new Ctor();
    rec.lang = langRef.current;
    /* interim results ON: they are the words this file delivers when a
       session dies mid-sentence. Chrome resends the whole unfinished phrase
       on every event, so the pending text is REPLACED each time, and a final
       clears what it finalised by no longer being interim. */
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let finals = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) {
          /* a final is new only from resultIndex on — earlier finals were
             delivered by the event that finalised them */
          if (i >= e.resultIndex) finals += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      pendingRef.current = interim.trim();
      const said = finals.trim();
      if (said) onTextRef.current(said);
      errorRunRef.current = 0; // something was heard: the run of errors is over
    };
    rec.onerror = (e) => {
      const fatal = e.error === "not-allowed" || e.error === "service-not-allowed";
      if (fatal) {
        /* a refused microphone is not something to reopen — and nothing it
           "heard" is worth keeping */
        wantRef.current = false;
        pendingRef.current = "";
        setStatus("denied");
        return;
      }
      /* `aborted` is a stop somebody asked for — this hook's teardown, or a
         second recogniser taking the one microphone Chrome allows; reopening
         after it would fight that caller forever. Everything else —
         no-speech, network, audio-capture — is transient: the `end` that
         follows reopens, and the status is NOT touched here, because the
         microphone is still wanted and about to be open again. */
      /* only the LIVE session's abort is the person's; a superseded one
         aborting while its successor already listens must not switch the
         wish off under the successor (2026-09-06) */
      if (e.error === "aborted" && recRef.current === rec) wantRef.current = false;
      /* a transient error that repeats is not transient: offline, or no
         device — count it, and after five in a row stop wanting, so the
         button stops pulsing over a microphone nothing can hear */
      if (e.error === "network" || e.error === "audio-capture") {
        errorRunRef.current += 1;
        if (errorRunRef.current >= 5) {
          wantRef.current = false;
          errorRunRef.current = 0;
        }
      }
    };
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      /* what it heard and never finalised goes into the box, not the void */
      const unfinished = pendingRef.current;
      pendingRef.current = "";
      if (unfinished) onTextRef.current(unfinished);
      if (wantRef.current) {
        cancelReopen();
        reopenRef.current = setTimeout(() => {
          reopenRef.current = null;
          if (wantRef.current && recRef.current === null) open();
        }, REOPEN_DELAY_MS);
        return;
      }
      // denied/unsupported must survive the end event — they are the message
      setStatus((s) => (s === "listening" ? "idle" : s));
    };
    recRef.current = rec;
    try {
      rec.start();
      setStatus("listening");
    } catch {
      /* the engine refused to open at all — say so rather than spin */
      recRef.current = null;
      wantRef.current = false;
      setStatus("idle");
    }
  }, [cancelReopen]);

  const toggle = useCallback(() => {
    if (wantRef.current) {
      wantRef.current = false;
      cancelReopen();
      const live = recRef.current;
      /* stop, not abort: Chrome finalises the last phrase on stop and sends
         it before `end`, so a release mid-word still lands the word */
      if (live) live.stop();
      else setStatus("idle"); // released inside the reopen gap: nothing to stop
      return;
    }
    wantRef.current = true;
    setStatus("listening");
    /* a fast re-press lands while the last session is still winding down
       (Chrome takes up to ~800 ms to fire `end` after stop()). Opening a
       second recogniser then made Chrome abort the first, whose `aborted`
       switched the wish off under the new one: mic open, status idle, key
       dead. With the wish set, that session's own `onend` reopens. */
    if (recRef.current !== null) return;
    open();
  }, [cancelReopen, open]);

  useEffect(
    () => () => {
      /* the wish first: aborting fires `end`, and a teardown that reopened
         the microphone on the way out is the worst possible restart; the
         pending words go too — the box they were for is going away */
      wantRef.current = false;
      cancelReopen();
      pendingRef.current = "";
      recRef.current?.abort?.();
    },
    [cancelReopen],
  );

  /*
   * PRESS AND RELEASE (user, 2026-09-05: "push to talk, not push to activate")
   * read the WISH, never the rendered status and never the session: the
   * status is React state a frame behind, and the session is null for the
   * length of every reopen gap — a release that landed in that gap and asked
   * "is a session running?" would find none, do nothing, and leave the
   * microphone to reopen itself under a finger that had already let go.
   */
  const start = useCallback(() => { if (!wantRef.current) toggle(); }, [toggle]);
  const stop = useCallback(() => { if (wantRef.current) toggle(); }, [toggle]);

  return { status, toggle, start, stop };
}
