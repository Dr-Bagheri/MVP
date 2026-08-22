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

/*
 * LISTENING LIVES ELSEWHERE (2026-08-22 rebuild, user directive: "remove
 * its main codes for behavior, do it from scratch"): the wake machine,
 * greeting/goodbye grammar, echo fingerprinting, noise and dedupe filters
 * that used to fill this file are GONE — the one listener is
 * lib/voiceLoop.ts (the M38 relay + local VAD + a five-rule behavior).
 * This file is the assistant's MOUTH only: voices, speech queues, the
 * playback state the loop needs, and the watchdogs that keep a jammed
 * engine from muting the ears forever.
 */

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

/** the orb listens too: it breathes while the assistant's voice plays */
export function subscribeSpeechPlayback(listener: (speaking: boolean) => void): () => void {
  playbackListeners.add(listener);
  return () => playbackListeners.delete(listener);
}

/** the M37 server-voice element currently playing, if any — the one audio
    source the level meter can actually tap (speechSynthesis has none) */
export function currentSpeechAudio(): HTMLAudioElement | null {
  return serverAudio;
}

/** everything the assistant has SAID OUT LOUD recently — the echo filter's
    reference text (acks and replies both; capped so it stays a fingerprint
    of the recent voice, not a transcript archive) */
let spokenHistory = "";
export function recentSpokenText(): string {
  return spokenHistory;
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

/** exported for the dock's LOCAL stop: cut whatever voice is playing NOW */
export function stopSpeaking(): void {
  speechQueue.length = 0; // whatever was waiting to be said is unsaid
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (serverAudio) {
    serverAudio.pause();
    serverAudio = null;
  }
  playbackToken += 1; // orphan any in-flight done() callbacks and pumps
  publishPlayback(false);
}

/* ── the SENTENCE QUEUE (2026-08-21 latency rework): the reply is spoken
   sentence-by-sentence AS IT STREAMS, instead of one long synthesis after
   the whole answer arrived — the first sentence is audible while the rest
   is still being written. speakQueued() appends; one pump plays the queue
   in order; stopSpeaking() empties it mid-word. ──────────────────────── */
const speechQueue: string[] = [];
let queuePumping = false;

export function speakQueued(text: string): void {
  if (typeof window === "undefined") return;
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#]/g, " ") // md residue reads terribly aloud
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return;
  spokenHistory = `${spokenHistory} ${cleaned}`.slice(-2000);
  speechQueue.push(cleaned);
  void pumpSpeechQueue();
}

async function pumpSpeechQueue(): Promise<void> {
  if (queuePumping) return;
  queuePumping = true;
  const token = ++playbackToken;
  publishPlayback(true);
  try {
    while (speechQueue.length > 0 && token === playbackToken) {
      const next = speechQueue.shift()!;
      await speakOne(next);
    }
  } finally {
    queuePumping = false;
    if (token === playbackToken) publishPlayback(false);
    // a sentence that arrived while we were closing down starts a new pump
    if (speechQueue.length > 0) void pumpSpeechQueue();
  }
}

/**
 * A watchdog around every awaited utterance (2026-08-22, the dead-orb
 * report's second cause): Chrome's speechSynthesis is known to sometimes
 * fire NEITHER onend NOR onerror — the await never settles, the pump never
 * closes, `publishPlayback(false)` never runs, and the wake machine stays
 * MUTED forever. From the outside that is indistinguishable from "the orb
 * stopped hearing me". The ceiling is generous (real speech finishes long
 * before it) and firing it also cancels the jammed engine so the NEXT
 * utterance starts clean.
 */
function speechWatchdogMs(text: string): number {
  return Math.min(30_000, 3_000 + text.length * 120);
}

function speakUtterance(utterance: SpeechSynthesisUtterance, text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (jammed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (jammed) {
        try { window.speechSynthesis.cancel(); } catch { /* fine */ }
      }
      resolve();
    };
    const watchdog = setTimeout(() => finish(true), speechWatchdogMs(text));
    utterance.onend = () => finish(false);
    utterance.onerror = () => finish(false);
    window.speechSynthesis.speak(utterance);
  });
}

/** one utterance, AWAITED to its end — sequential, never cancelling */
async function speakOne(cleaned: string): Promise<void> {
  const persian = PERSIAN_RE.test(cleaned);
  const synthAvailable = "speechSynthesis" in window;
  if (!persian) {
    if (!synthAvailable) return;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = "en-US";
    await speakUtterance(utterance, cleaned);
    return;
  }
  const voices = synthAvailable ? await loadVoices() : [];
  const faVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("fa"));
  const faVoice = faVoices.find((v) => /dilara|female/i.test(v.name)) ?? faVoices[0];
  if (faVoice) {
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.voice = faVoice;
    utterance.lang = faVoice.lang;
    await speakUtterance(utterance, cleaned);
    return;
  }
  try {
    const { api } = await import("@/api/client");
    const blob = await api.tts(cleaned.slice(0, 1200));
    const audio = new Audio(URL.createObjectURL(blob));
    serverAudio = audio; // the orb's level meter taps the CURRENT element
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (jammed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (jammed) { try { audio.pause(); } catch { /* fine */ } }
        resolve();
      };
      // same wedge, other engine: a stalled download or a never-firing
      // 'ended' must not hold the mute open forever
      const watchdog = setTimeout(() => finish(true), speechWatchdogMs(cleaned) + 15_000);
      audio.onended = () => { URL.revokeObjectURL(audio.src); finish(false); };
      audio.onerror = () => finish(false);
      audio.onpause = () => finish(false); // stopSpeaking() pauses mid-word
      void audio.play().catch(() => finish(false));
    });
    if (serverAudio === audio) serverAudio = null;
  } catch {
    if (!warnedNoPersian) {
      warnedNoPersian = true;
      const { notify } = await import("@/lib/notify");
      notify("صدای فارسی در دسترس نیست — سرویس گفتار پاسخ نداد.", "warn");
    }
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
  // remember what the voice is about to say — the echo filter's reference
  spokenHistory = `${spokenHistory} ${cleaned}`.slice(-2000);
  stopSpeaking();

  /*
   * Publish "the speakers carry my voice" for the duration — the voice
   * control deafens itself on this signal. Token-guarded: a newer speak
   * cancelling this one must not have its playback=false land after the
   * newer playback=true.
   */
  const token = ++playbackToken;
  const done = () => { if (token === playbackToken) publishPlayback(false); };
  const fireUtterance = (utterance: SpeechSynthesisUtterance) => {
    publishPlayback(true);
    // the same never-fires wedge as speakOne's, same watchdog: an ack that
    // jams the engine would leave the wake machine muted — a dead orb
    const watchdog = setTimeout(() => {
      try { window.speechSynthesis.cancel(); } catch { /* fine */ }
      done();
    }, speechWatchdogMs(cleaned));
    utterance.onend = () => { clearTimeout(watchdog); done(); };
    utterance.onerror = () => { clearTimeout(watchdog); done(); };
    window.speechSynthesis.speak(utterance);
  };

  const persian = PERSIAN_RE.test(cleaned);
  if (!persian) {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = "en-US";
    fireUtterance(utterance);
    return;
  }

  const voices = "speechSynthesis" in window ? await loadVoices() : [];
  // a WOMAN's voice for Persian (user directive, 2026-08-21): Edge ships
  // fa-IR Dilara (female) beside Farid (male) — prefer her when present
  const faVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("fa"));
  const faVoice = faVoices.find((v) => /dilara|female/i.test(v.name)) ?? faVoices[0];
  if (faVoice) {
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.voice = faVoice;
    utterance.lang = faVoice.lang;
    fireUtterance(utterance);
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
    // watchdog: a stalled stream must not hold the mute open forever
    const audioWatchdog = setTimeout(() => {
      try { serverAudio?.pause(); } catch { /* fine */ }
      done();
    }, speechWatchdogMs(cleaned) + 15_000);
    serverAudio.addEventListener("ended", () => clearTimeout(audioWatchdog));
    serverAudio.addEventListener("pause", () => { clearTimeout(audioWatchdog); done(); });
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
