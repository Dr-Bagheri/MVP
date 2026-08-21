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

export type WakeState = "idle" | "awaiting";

export interface WakeHandlers {
  /** the name was heard alone — ack out loud and show the listening chip */
  onWake: () => void;
  /** a command to run — either in the same breath or inside the window */
  onCommand: (command: string) => void;
  onState?: (state: WakeState) => void;
}

/**
 * The wake DECISION machine, separated from the recognizer plumbing so it
 * can be tested with fed transcripts and fake timers.
 *
 * Speed is the design (user: "hey echo has a delay — make it faster"): the
 * machine acts on INTERIM results, so a bare «echo» gets its "Yes?" the
 * moment the recognizer first prints the word — not a second later when
 * end-of-speech finalizes it. Commands still wait for the FINAL transcript
 * (an interim command is half a sentence), and the old stop-the-listener/
 * start-a-fresh-one round-trip after the ack is gone entirely: the same
 * continuous stream feeds the command window.
 *
 * The one subtlety: after an interim bare-wake opens the window, that same
 * utterance's own FINAL arrives — as «echo» (ignored: it is the wake, not
 * a command) or as «echo record new call» (the person kept talking: the
 * remainder IS the command).
 */
export function createWakeMachine(
  handlers: WakeHandlers,
  windowMs = 10_000,
): { feed: (transcript: string, isFinal: boolean) => void; cancel: () => void } {
  let state: WakeState = "idle";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const toIdle = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (state !== "idle") {
      state = "idle";
      handlers.onState?.("idle");
    }
  };

  return {
    feed(transcript, isFinal) {
      if (state === "idle") {
        const m = matchWake(transcript);
        if (!m.woke) return;
        if (m.command) {
          // wake + command in one breath — run it, but only from the FINAL:
          // an interim here is a sentence still being spoken
          if (isFinal) handlers.onCommand(m.command);
          return;
        }
        // bare wake — interim or final, whichever arrives first wins
        state = "awaiting";
        handlers.onState?.("awaiting");
        handlers.onWake();
        timer = setTimeout(toIdle, windowMs);
      } else {
        if (!isFinal) return;
        const m = matchWake(transcript);
        // the waking utterance's own final catching up — not a command
        if (m.woke && !m.command) return;
        const command = (m.woke ? m.command : transcript.trim());
        if (!command) return; // stay in the window
        toIdle();
        handlers.onCommand(command);
      }
    },
    cancel: toIdle,
  };
}

/**
 * Continuous background listening for the wake word. Auto-restarts on end
 * (Chrome stops recognition after silence); stop() ends it for real.
 */
export function startVoiceControl(opts: {
  lang: string;
  onWake: () => void;
  onCommand: (command: string) => void;
  onState?: (state: WakeState) => void;
  onError?: (error: string) => void;
}): WakeListenerHandle | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const machine = createWakeMachine(opts);
  let stopped = false;
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.continuous = true;
  rec.interimResults = true; // the speed lives here — see createWakeMachine
  rec.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      machine.feed(result[0].transcript, result.isFinal);
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
      machine.cancel();
      opts.onError?.(event.error);
    }
    // other errors (no-speech, network) fall through to onend's restart
  };
  try { rec.start(); } catch { return null; }
  return {
    stop: () => {
      stopped = true;
      machine.cancel();
      try { rec.abort(); } catch { /* fine */ }
    },
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
 * Voices load ASYNC in Chrome: getVoices() is [] until `voiceschanged`.
 * Waiting bounded — a browser that never fires it still answers.
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

/** the audio element playing the SERVER-side Persian voice, if any */
let serverAudio: HTMLAudioElement | null = null;
let warnedNoPersian = false;

function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (serverAudio) {
    serverAudio.pause();
    serverAudio = null;
  }
}

/**
 * Speak a reply in its own language — the mirror of the assistant's
 * language rule. Cancels whatever was still being spoken: newest wins.
 *
 * Persian is the ladder (user directive, 2026-08-21: "I want TTS for the
 * Persian version, that can talk Persian"): a REAL fa voice in the browser
 * if one exists (Edge ships one; Windows Chrome ships none), else the
 * platform's own TTS lane (M37: piper on the server via POST /v1/tts) —
 * never a non-Persian voice mangling Persian text, and never silence
 * without a word: if both rungs are missing the person is told once.
 */
export function speak(text: string): void {
  void speakAsync(text);
}

async function speakAsync(text: string): Promise<void> {
  if (typeof window === "undefined") return;
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ") // fenced blocks are for eyes, not voice
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return;
  stopSpeaking();

  const persian = PERSIAN_RE.test(cleaned);
  if (!persian) {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
    return;
  }

  const voices = "speechSynthesis" in window ? await loadVoices() : [];
  const faVoice = voices.find((v) => v.lang.toLowerCase().startsWith("fa"));
  if (faVoice) {
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.voice = faVoice;
    utterance.lang = faVoice.lang;
    window.speechSynthesis.speak(utterance);
    return;
  }

  // no browser voice speaks Persian — the server does (M37)
  try {
    const { api } = await import("@/api/client");
    const blob = await api.tts(cleaned.slice(0, 1200));
    serverAudio = new Audio(URL.createObjectURL(blob));
    serverAudio.onended = () => {
      if (serverAudio) URL.revokeObjectURL(serverAudio.src);
    };
    await serverAudio.play();
  } catch {
    if (!warnedNoPersian) {
      warnedNoPersian = true;
      const { notify } = await import("@/lib/notify");
      // hard-coded Persian: the only audience for this sentence asked for
      // Persian speech, and this module has no i18n context to reach
      notify("صدای فارسی در دسترس نیست — سرویس گفتار پاسخ نداد.", "warn");
    }
  }
}
