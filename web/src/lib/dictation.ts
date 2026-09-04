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
 *
 * The states are meant to be told apart at a glance rather than read: bright
 * accent on a soft ground while it is listening, muted ink with no ground
 * while it is not, and a pulse only on the live one.
 */
export function micTone(status: DictationStatus): string {
  return status === "listening"
    ? "animate-pulse bg-accent-soft text-accent"
    : "text-fg-muted hover:bg-surface-2 hover:text-fg";
}

export function useDictation(
  lang: string,
  onText: (text: string) => void,
): { status: DictationStatus; toggle: () => void } {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const recRef = useRef<RecognitionLike | null>(null);
  // ref, not closure: onresult fires long after the render that created it,
  // and a stale onText would append into an input state that no longer exists
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  /*
   * DOES THE PERSON STILL WANT THE MIC OPEN?
   *
   * Separate from "is a recogniser running", because those stop being the
   * same thing the moment the browser ends a session by itself — which it
   * does, constantly. See `onend`.
   */
  const wantRef = useRef(false);

  const toggle = useCallback(() => {
    if (recRef.current) {
      wantRef.current = false;
      recRef.current.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r?.isFinal) text += r[0].transcript;
      }
      if (text.trim()) onTextRef.current(text.trim());
    };
    rec.onerror = (e) => {
      const fatal = e.error === "not-allowed" || e.error === "service-not-allowed";
      /* a refused microphone is not something to reopen — and `aborted` is
         a stop we asked for. Anything else is transient and `onend` retries. */
      if (fatal || e.error === "aborted") wantRef.current = false;
      if (fatal) {
        setStatus("denied");
        return;
      }
      /*
       * A TRANSIENT ERROR MUST NOT REPORT IDLE (user report, 2026-09-04: "the
       * voice hotkey does not work now — it was working and adding my command
       * to the prompt box").
       *
       * `no-speech` is what Chrome sends when somebody pauses, which is most
       * of the time. This said `idle` unconditionally, and `onend` then
       * reopened the session — so the microphone was open while the screen and
       * every caller believed it was closed. Push-to-talk asks
       * `status !== "listening"` before starting, so the NEXT press called
       * toggle on a live recogniser and STOPPED it: the hotkey did nothing,
       * twice in a row, forever.
       *
       * The fix is in `onend`, which says `listening` again the moment it
       * reopens — ONE mechanism, and the provable one: a probe that removed
       * the guard which used to stand here left the suite green, because the
       * restart overwrites this status either way. Two mechanisms where
       * neither can fail for its own reason is a place for a future edit to
       * hide, so this is a plain `idle` and the restart is what corrects it.
       */
      setStatus("idle");
    };
    rec.onend = () => {
      /*
       * CHROME ENDS THE SESSION ON A PAUSE, whatever `continuous` says.
       *
       * User report, 2026-09-04: "when I am doing a voice command it will be
       * cut mid command — it seems it has a limit for writing down a
       * paragraph and did not get the full command." There is no length
       * limit. The recogniser stops itself after a few seconds of silence,
       * `onend` fires, and this went straight to idle — so thinking for a
       * breath in the middle of a sentence ended the dictation, and the half
       * already transcribed sat in the box looking like all of it.
       *
       * `continuous = true` is what makes people believe otherwise; it keeps
       * a session alive across pauses WITHIN a phrase, and the engine still
       * closes the session. The only thing that actually keeps a microphone
       * open is reopening it, so that is what this does — while the person
       * has not asked for it to stop.
       */
      if (wantRef.current) {
        try {
          rec.start();
          /* and it is listening again — said out loud, because a transient
             error may have been reported in between and the status is what
             every caller reads to decide whether to start or stop */
          setStatus("listening");
          return;
        } catch {
          /* start() throws if the engine is not ready to be restarted; fall
             through and report idle rather than spin */
          wantRef.current = false;
        }
      }
      recRef.current = null;
      // denied/unsupported must survive the end event — they are the message
      setStatus((s) => (s === "listening" ? "idle" : s));
    };
    recRef.current = rec;
    wantRef.current = true;
    setStatus("listening");
    try {
      rec.start();
    } catch {
      recRef.current = null;
      wantRef.current = false;
      setStatus("idle");
    }
  }, [lang]);

  useEffect(
    () => () => {
      /* the flag first: aborting fires `onend`, and a teardown that reopened
         the microphone on the way out is the worst possible restart */
      wantRef.current = false;
      recRef.current?.abort?.();
    },
    [],
  );

  return { status, toggle };
}
