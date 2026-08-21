/**
 * Voice in and voice out (user directive, 2026-08-21: wake words «echo /
 * salam echo / hi echo / سلام اکو», commands sent by voice alone, and the
 * assistant replying "by its own voice" — Persian in → Persian out).
 *
 * Everything here is feature-detected: SpeechRecognition is Chrome-shaped
 * (webkit prefix) and simply absent elsewhere; speechSynthesis is broader.
 * Absence is reported to the caller as null/false — never a throw — so the
 * dock can say "this browser can't do voice" instead of dying quietly.
 */

/* the Web Speech API has no lib.dom types for the webkit constructor */
interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
}
interface RecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResultLike };
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceInputSupported(): boolean {
  return typeof window !== "undefined" && recognitionCtor() !== null;
}

/**
 * The wake phrase: an optional greeting, then the name — either script.
 * Whatever FOLLOWS the name in the same utterance is the command
 * ("hey echo, record new call" → "record new call").
 *
 * `ecco`/`eko` are accepted as the name: the recognizer runs in the UI
 * language, and an English model spells the spoken name however English
 * lets it (live transcripts: "Ecco salon" for «سلام اکو»).
 */
const WAKE_RE = /(?:^|\s)(?:(?:hey|hi|salam|سلام)[\s,،]+)?(?:echo|ecco|eko|اکو)(?!\p{L})[\s.,،!?]*/iu;

/**
 * What the ENGLISH recognizer makes of «سلام اکو» spoken whole: the two
 * words fuse into the nearest English word ("Salon", live transcript,
 * 2026-08-21). Only honoured as a COMPLETE utterance — "salon" inside a
 * sentence is someone's actual word.
 */
const SALAM_ARTIFACT_RE = /^\s*(?:salon|salam|salaam|slalom)[\s.,،!?]*$/i;

export function matchWake(transcript: string): { woke: boolean; command: string } {
  if (SALAM_ARTIFACT_RE.test(transcript)) return { woke: true, command: "" };
  const m = WAKE_RE.exec(transcript);
  if (!m) return { woke: false, command: "" };
  const command = transcript.slice(m.index + m[0].length).trim();
  // "Ecco salon": the name matched, and the trailing greeting-artifact is
  // recognizer residue, not a command — a bare wake, not a question.
  if (SALAM_ARTIFACT_RE.test(command)) return { woke: true, command: "" };
  return { woke: true, command };
}

export interface WakeListenerHandle {
  stop: () => void;
}

/**
 * Continuous background listening for the wake word. Auto-restarts on end
 * (Chrome stops recognition after silence); stop() ends it for real.
 * onWake receives the command remainder ("" = name alone, wait for more).
 */
export function startWakeListener(opts: {
  lang: string;
  onWake: (command: string) => void;
  onError?: (error: string) => void;
}): WakeListenerHandle | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  let stopped = false;
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result?.isFinal) continue;
      const { woke, command } = matchWake(result[0].transcript);
      if (woke) opts.onWake(command);
    }
  };
  rec.onend = () => {
    // Chrome ends recognition on silence — presence means restart, always
    if (!stopped) {
      try { rec.start(); } catch { /* already started — a race, fine */ }
    }
  };
  rec.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      stopped = true;
      opts.onError?.(event.error);
    }
    // other errors (no-speech, network) fall through to onend's restart
  };
  try { rec.start(); } catch { return null; }
  return {
    stop: () => { stopped = true; try { rec.abort(); } catch { /* fine */ } },
  };
}

/**
 * One utterance → one final transcript (the composer's mic button and the
 * "yes?" window after a bare wake word). Resolves null on silence/denial.
 */
export function listenOnce(lang: string): { done: Promise<string | null>; cancel: () => void } | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = false;
  let settle: (value: string | null) => void = () => undefined;
  const done = new Promise<string | null>((resolve) => { settle = resolve; });
  let result: string | null = null;
  rec.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    if (last?.isFinal) result = last[0].transcript.trim() || null;
  };
  rec.onend = () => settle(result);
  rec.onerror = () => settle(null);
  try { rec.start(); } catch { return null; }
  return { done, cancel: () => { try { rec.abort(); } catch { /* fine */ } } };
}

const PERSIAN_RE = /[؀-ۿ]/;

/**
 * Speak a reply in its own language: Persian text gets a fa-IR voice,
 * anything else en-US — the mirror of the assistant's language rule.
 * Cancels whatever was still being spoken: the newest reply wins.
 */
export function speak(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ") // fenced blocks are for eyes, not voice
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = PERSIAN_RE.test(cleaned) ? "fa-IR" : "en-US";
  window.speechSynthesis.speak(utterance);
}
