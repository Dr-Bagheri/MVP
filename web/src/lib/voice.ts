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

export type WakeState = "idle" | "engaged";

export interface WakeHandlers {
  /** the name was heard alone — ack out loud and show the listening chip */
  onWake: () => void;
  /** a command to run — either in the same breath or inside the session */
  onCommand: (command: string) => void;
  onState?: (state: WakeState) => void;
}

/**
 * "That's all" in either language — said as a WHOLE utterance while
 * engaged, it ends the conversation session on the spot.
 */
const STOP_RE = /^\s*(?:stop|enough|cancel|never mind|thanks,? that'?s all|بسه|بس کن|تمام|کافیه|هیچی|ممنون همین)[\s.,،!?]*$/i;

/**
 * The wake DECISION machine, separated from the recognizer plumbing so it
 * can be tested with fed transcripts and fake timers.
 *
 * Three states, shaped by two live complaints:
 *
 * IDLE → PRIMED: the name appears in an INTERIM transcript. The first
 * version acked ("Yes?") right here — and talked OVER anyone saying
 * "hey echo, go to the archive" in one breath (user: "it does not let me
 * finish the sentence"). Now the ack waits `ackDelayMs`: if more words
 * follow the name in the next interims, the ack is cancelled and the
 * FINAL carries the command; only a name that stays alone gets the "Yes?".
 *
 * ENGAGED — the conversation session (user: "it should stand by listening
 * and getting commands", not one wake word per command): after a wake or
 * a command the machine STAYS engaged for `engageMs`, every final
 * utterance is a command, each command renews the session, interim speech
 * keeps it alive, and a stop word («بسه» / "stop") or silence ends it.
 */
export function createWakeMachine(
  handlers: WakeHandlers,
  options: { ackDelayMs?: number; engageMs?: number } = {},
): {
  feed: (transcript: string, isFinal: boolean) => void;
  setMuted: (muted: boolean) => void;
  cancel: () => void;
} {
  const ackDelayMs = options.ackDelayMs ?? 900;
  const engageMs = options.engageMs ?? 45_000;
  let state: "idle" | "primed" | "engaged" = "idle";
  /** while the assistant's own voice is playing, the mic hears IT — a
      machine that listens then would answer itself in a loop */
  let muted = false;
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  let engageTimer: ReturnType<typeof setTimeout> | null = null;

  const clearAck = () => { if (ackTimer) clearTimeout(ackTimer); ackTimer = null; };
  const clearEngage = () => { if (engageTimer) clearTimeout(engageTimer); engageTimer = null; };

  const toIdle = () => {
    clearAck();
    clearEngage();
    const wasVisible = state === "engaged";
    state = "idle";
    if (wasVisible) handlers.onState?.("idle");
  };

  const engage = () => {
    clearAck();
    clearEngage();
    const entering = state !== "engaged";
    state = "engaged";
    if (entering) handlers.onState?.("engaged");
    engageTimer = setTimeout(toIdle, engageMs);
  };

  const renew = () => {
    clearEngage();
    engageTimer = setTimeout(toIdle, engageMs);
  };

  return {
    setMuted(next) {
      muted = next;
      // speech that straddled the mute began as the assistant's own voice
      if (next && state === "primed") toIdle();
      // a long spoken reply must not silently expire the session while the
      // person was only ever listening to it
      if (!next && state === "engaged") renew();
    },
    feed(transcript, isFinal) {
      if (muted) return;
      if (state === "idle") {
        const m = matchWake(transcript);
        if (!m.woke) return;
        if (m.command) {
          // wake + command in one breath — run it from the FINAL only
          if (isFinal) { engage(); handlers.onCommand(m.command); }
          else state = "primed"; // command coming — never ack over it
          return;
        }
        if (isFinal) {
          // definitely the name alone
          engage();
          handlers.onWake();
          return;
        }
        // the name, mid-utterance: hold the ack briefly — the sentence may
        // still be going ("hey echo, go to…")
        state = "primed";
        ackTimer = setTimeout(() => {
          engage();
          handlers.onWake();
        }, ackDelayMs);
      } else if (state === "primed") {
        const m = matchWake(transcript);
        if (!isFinal) {
          // more words arrived after the name — a command is being spoken
          if (m.woke && m.command) clearAck();
          return;
        }
        clearAck();
        if (m.woke && m.command) { engage(); handlers.onCommand(m.command); return; }
        if (m.woke) { engage(); handlers.onWake(); return; }
        // the recognizer revised the wake away — a mishear, let it go
        toIdle();
      } else {
        // engaged: the conversation session
        if (!isFinal) { renew(); return; } // speech in progress keeps it alive
        if (STOP_RE.test(transcript)) { toIdle(); return; }
        const m = matchWake(transcript);
        // saying the name again mid-session is a re-ack, not a command
        if (m.woke && !m.command) { renew(); handlers.onWake(); return; }
        const command = (m.woke ? m.command : transcript.trim());
        if (!command) { renew(); return; }
        renew();
        handlers.onCommand(command);
      }
    },
    cancel: toIdle,
  };
}

/**
 * The assistant's own PLAYBACK state, published so the voice control can
 * deafen itself while the speakers carry its voice — otherwise the mic
 * transcribes the reply and the assistant starts answering itself.
 */
const playbackListeners = new Set<(speaking: boolean) => void>();
let playbackToken = 0;
function publishPlayback(speaking: boolean): void {
  for (const listener of playbackListeners) listener(speaking);
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
  const onPlayback = (speaking: boolean) => machine.setMuted(speaking);
  playbackListeners.add(onPlayback);
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
  try { rec.start(); } catch { playbackListeners.delete(onPlayback); return null; }
  return {
    stop: () => {
      stopped = true;
      playbackListeners.delete(onPlayback);
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

  /*
   * Publish "the speakers carry my voice" for the duration — the voice
   * control deafens itself on this signal. Token-guarded: a newer speak
   * cancelling this one must not have its playback=false land after the
   * newer playback=true.
   */
  const token = ++playbackToken;
  const done = () => { if (token === playbackToken) publishPlayback(false); };
  const speakUtterance = (utterance: SpeechSynthesisUtterance) => {
    publishPlayback(true);
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  };

  const persian = PERSIAN_RE.test(cleaned);
  if (!persian) {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = "en-US";
    speakUtterance(utterance);
    return;
  }

  const voices = "speechSynthesis" in window ? await loadVoices() : [];
  const faVoice = voices.find((v) => v.lang.toLowerCase().startsWith("fa"));
  if (faVoice) {
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.voice = faVoice;
    utterance.lang = faVoice.lang;
    speakUtterance(utterance);
    return;
  }

  // no browser voice speaks Persian — the server does (M37)
  try {
    const { api } = await import("@/api/client");
    const blob = await api.tts(cleaned.slice(0, 1200));
    serverAudio = new Audio(URL.createObjectURL(blob));
    publishPlayback(true);
    serverAudio.onended = () => {
      if (serverAudio) URL.revokeObjectURL(serverAudio.src);
      done();
    };
    serverAudio.onerror = done;
    await serverAudio.play();
  } catch {
    done();
    if (!warnedNoPersian) {
      warnedNoPersian = true;
      const { notify } = await import("@/lib/notify");
      // hard-coded Persian: the only audience for this sentence asked for
      // Persian speech, and this module has no i18n context to reach
      notify("صدای فارسی در دسترس نیست — سرویس گفتار پاسخ نداد.", "warn");
    }
  }
}
