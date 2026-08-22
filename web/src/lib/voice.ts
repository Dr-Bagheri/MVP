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
 * ONE wake word: the NAME — «echo / اکو» — wherever it appears in the
 * utterance (user simplification, 2026-08-22: "just go with hearing just
 * echo, remove other listening start options — it's getting stuck").
 * The greeting grammar, the fused-greeting artifacts («هایکو») and the
 * whole-utterance salam forms ("Salon") are all GONE: every extra trigger
 * was another way to misfire. What remains: the name's honest spellings
 * through both recognizers (اکو/ایکو in fa, ecco/eko in en), and the
 * remainder AFTER the name is the command — so "hey echo do X" still
 * works, because the name is in it.
 */
const WAKE_RE = /(?:^|\s)(?:echo|ecco|eko|اکو|ایکو)(?!\p{L})[\s.,،!?]*/iu;

export function matchWake(transcript: string): { woke: boolean; command: string } {
  const m = WAKE_RE.exec(transcript);
  if (!m) return { woke: false, command: "" };
  return { woke: true, command: transcript.slice(m.index + m[0].length).trim() };
}

export interface WakeListenerHandle {
  stop: () => void;
  /** end the current wake SESSION without killing the recognizer — the
      wake word keeps working for the next conversation */
  endSession?: () => void;
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
 * "That's all" in either language — said as a WHOLE utterance, it stops
 * whatever the assistant is doing: the machine ends its session on it,
 * and the dock routes it to a LOCAL stop (cut the voice, abort the run)
 * instead of the model (user report, 2026-08-21: "stop" reached the
 * model, which mused about recordings instead of stopping).
 */
const STOP_RE = /^\s*(?:stop|stop it|enough|cancel|never mind|thanks,? that'?s all|بسه|بس|بس کن|تمام|کافیه|هیچی|ساکت|قطع کن|ممنون همین)[\s.,،!?]*$/i;

/** the dock's local-stop gate — exported so "stop" never becomes a prompt */
export function isStopCommand(text: string): boolean {
  return STOP_RE.test(text);
}

/**
 * CONVERSATION-OVER detection (user rule, 2026-08-22): "stop" kept two
 * meanings because only BARE stop words were caught — "okay stop",
 * "thanks that's enough", "I don't have anything else" reached the model,
 * which mused about recordings. An utterance is a goodbye when it is
 * short, made ONLY of closing vocabulary, and contains a core closing
 * phrase. Real requests always carry a non-closing word ("open", "برو",
 * "records") and pass through untouched.
 */
const CLOSING_FILLER = new Set([
  // en
  "ok", "okay", "k", "no", "yes", "yeah", "nah", "thanks", "thank", "you",
  "alright", "right", "well", "so", "that", "thats", "s", "is", "it", "was",
  "all", "enough", "done", "i", "im", "m", "dont", "don", "t", "do", "not",
  "have", "anything", "nothing", "else", "more", "were", "re", "we", "are",
  "am", "good", "fine", "bye", "goodbye", "stop", "please", "now", "cool",
  "great", "perfect",
  // fa
  "باشه", "نه", "آره", "بله", "مرسی", "ممنون", "ممنونم", "متشکرم", "تشکر",
  "خیلی", "خب", "خوب", "دیگه", "دیگر", "چیزی", "چیز", "ندارم", "نداریم",
  "نیست", "همین", "بود", "تمام", "شد", "بسه", "بس", "کن", "کافیه", "کافی",
  "است", "خداحافظ", "بای", "فعلا", "لطفا", "من",
]);

const CLOSING_CORE = new RegExp(
  [
    "(don t|dont|do not) have anything( else| more)?",
    "nothing (else|more)",
    "that s? ?(all|it|enough)",
    "(i ?m|we ?re|we are|i am) (all )?done",
    "all done",
    "\\benough\\b",
    "\\bstop\\b",
    "\\bbye\\b", "\\bgoodbye\\b",
    "بسه", "بس کن", "کافیه", "کافی است", "تمام", "همین", "خداحافظ", "بای",
    "ندارم", "نداریم",
  ].join("|"),
  "iu",
);

export function isConversationOver(text: string): boolean {
  const c = canonical(text);
  if (!c) return false;
  const words = c.split(" ");
  if (words.length > 8) return false;
  if (!words.every((word) => CLOSING_FILLER.has(word))) return false;
  return CLOSING_CORE.test(c);
}

/**
 * A transcript with no letter or digit is the recognizer spelling NOISE —
 * a breath or keyboard tap arriving as "—" or "…" (user report,
 * 2026-08-22: dash-only bubbles mid-conversation, "it heard something
 * that was not"). Never a command, never a message.
 */
export function isNoiseUtterance(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/** language-agnostic canonical form for echo comparison */
function canonical(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The same utterance, spelled twice by the provider: the fast VAD
 * endpoint consumes a sentence from the INTERIM transcript, then the
 * recognizer finalizes those very words and they arrive again as finals
 * (user report, 2026-08-21: "it hears everything twice"). Two settles
 * whose canonical text is identical are ONE utterance. Deliberately
 * strict equality — an EXTENDED text (the person kept talking) must
 * pass, so no overlap heuristics here.
 */
export function sameUtterance(a: string, b: string): boolean {
  const ca = canonical(a);
  return ca !== "" && ca === canonical(b);
}

/**
 * Self-echo discrimination (the full-duplex requirement): with the mic
 * open WHILE the assistant talks, a transcript may be the assistant's own
 * voice leaking past echo-cancellation. It is an echo when the last
 * spoken reply CONTAINS it, or contains nearly all of its words — a real
 * barge-in brings words the reply never said.
 */
export function isEchoOf(utterance: string, spoken: string): boolean {
  const u = canonical(utterance);
  const s = canonical(spoken);
  if (!u || !s) return false;
  if (s.includes(u)) return true;
  const words = u.split(" ");
  if (words.length < 3) return false; // too short to fingerprint — let it through
  const spokenSet = new Set(s.split(" "));
  const hits = words.filter((word) => spokenSet.has(word)).length;
  return hits / words.length >= 0.8;
}

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
  options: { engageMs?: number; silenceMs?: number } = {},
): {
  feed: (transcript: string, isFinal: boolean) => void;
  setMuted: (muted: boolean) => void;
  cancel: () => void;
} {
  const engageMs = options.engageMs ?? 45_000;
  /** a spoken command ENDS on silence (user: "3s of silence = the input"):
      if the interim transcript stops changing for this long, it IS the
      command — no waiting on the recognizer's own slow endpointing */
  const silenceMs = options.silenceMs ?? 3_000;
  /*
   * TWO states only (2026-08-22 simplification: the interim-primed ack
   * machinery "was getting stuck" — every extra state was another way to
   * wedge). Idle listens for FINALS carrying the name; engaged is the
   * conversation session. Interims matter only inside the session, where
   * their stability drives the fast endpoint.
   */
  let state: "idle" | "engaged" = "idle";
  /** while the assistant's own voice is playing, the mic hears IT — a
      machine that listens then would answer itself in a loop */
  let muted = false;
  let engageTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  let lastInterim = "";
  /** an interim promoted at 3s-silence makes the recognizer's own final a
      duplicate — swallow exactly one */
  let swallowNextFinal = false;
  /** a BARE name in an interim already acked — the same utterance's final
      must not re-ack, but a final that grew a command still runs it */
  let ackedFromInterim = false;

  const clearEngage = () => { if (engageTimer) clearTimeout(engageTimer); engageTimer = null; };
  const clearStability = () => {
    if (stabilityTimer) clearTimeout(stabilityTimer);
    stabilityTimer = null;
    lastInterim = "";
  };

  const toIdle = () => {
    clearEngage();
    clearStability();
    swallowNextFinal = false;
    ackedFromInterim = false;
    const wasVisible = state === "engaged";
    state = "idle";
    if (wasVisible) handlers.onState?.("idle");
  };

  const engage = () => {
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
      // a long spoken reply must not silently expire the session while the
      // person was only ever listening to it
      if (!next && state === "engaged") renew();
    },
    feed(transcript, isFinal) {
      if (muted) return;
      /*
       * The interim-stability endpoint, shared by the session AND by an
       * interim wake that carried words after the name (user: some commands
       * are short, some long): when the interim stops CHANGING for
       * silenceMs, that text IS the command — promoted without waiting for
       * the recognizer's final. The eventual final for the same utterance
       * is swallowed once.
       */
      const trackInterim = (text: string) => {
        if (text && text !== lastInterim) {
          lastInterim = text;
          if (stabilityTimer) clearTimeout(stabilityTimer);
          stabilityTimer = setTimeout(() => {
            const promoted = lastInterim;
            clearStability();
            if (!promoted || state !== "engaged" || muted) return;
            swallowNextFinal = true;
            if (STOP_RE.test(promoted)) { toIdle(); return; }
            const pm = matchWake(promoted);
            const command = pm.woke ? pm.command : promoted;
            if (!command) return;
            renew();
            handlers.onCommand(command);
          }, silenceMs);
        }
      };

      if (state === "idle") {
        const m = matchWake(transcript);
        if (!m.woke) return;
        if (isFinal) {
          // the utterance is complete: the name alone acks; name + words runs
          engage();
          if (m.command) handlers.onCommand(m.command);
          else handlers.onWake();
          return;
        }
        /*
         * INTERIM wake (2026-08-22, round 2 — the "calling it echo does not
         * work" report): Chrome routinely ends a quiet recognition session
         * WITHOUT finalizing the interim that carried the name — the
         * restart discards it, and a finals-only idle reads as a dead orb.
         * So the name in an interim wakes IMMEDIATELY. Stuck-proofness is
         * kept by having no pre-engaged state at all: waking is a one-way
         * step into the session, whose own timeout and stop words already
         * know the way out. The cost is an occasional phantom ack when a
         * mis-hear corrects itself — a chirp, against a door that opens.
         */
        engage();
        if (!m.command) {
          ackedFromInterim = true;
          handlers.onWake();
          return;
        }
        // name + speech still forming: the session's stability endpoint
        // takes it from here (promotion and the final both strip the name)
        trackInterim(transcript.trim());
        return;
      }

      // engaged: the conversation session
      if (!isFinal) {
        renew(); // speech in progress keeps the session alive
        trackInterim(transcript.trim());
        return;
      }
      clearStability();
      if (swallowNextFinal) { swallowNextFinal = false; renew(); return; }
      if (ackedFromInterim) {
        /*
         * The wake utterance's own final, after its interim already acked.
         * Not a blind swallow: if the final GREW words after the name
         * ("echo … go to records" finalized as one utterance), those words
         * are the command. A final that is not the wake utterance at all
         * (the person's next sentence) falls through to normal handling.
         */
        ackedFromInterim = false;
        const wm = matchWake(transcript);
        if (wm.woke) {
          renew();
          if (wm.command) handlers.onCommand(wm.command);
          return;
        }
      }
      if (STOP_RE.test(transcript)) { toIdle(); return; }
      const m = matchWake(transcript);
      // saying the name again mid-session is a re-ack, not a command
      if (m.woke && !m.command) { renew(); handlers.onWake(); return; }
      const command = (m.woke ? m.command : transcript.trim());
      if (!command) { renew(); return; }
      renew();
      handlers.onCommand(command);
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
    endSession: () => machine.cancel(),
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
