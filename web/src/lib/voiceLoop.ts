"use client";

/**
 * THE VOICE LOOP — the from-scratch rebuild (user directive, 2026-08-22:
 * "remove its main codes for behavior, do it from scratch, keep only these
 * rules"). The five rules, and nothing else:
 *
 *  1. It starts with its NAME: «echo / اکو».
 *  2. A recording makes it deaf and silent (the dock suspends the loop).
 *  3. "stop" stops it talking.
 *  4. The fastest path: the M38 relay (Soniox), raw PCM, local VAD
 *     endpointing — no browser speech recognition anywhere.
 *  5. Bilingual by construction: the relay transcribes fa+en in one
 *     stream, whatever language the sentence starts in.
 *
 * What was deliberately NOT rebuilt: the wake machine, greeting grammar,
 * goodbye vocabulary, echo fingerprinting, noise filters — the stack of
 * rules that fought each other. The replacement behavior fits in
 * `createVoiceBehavior` below and is pure enough to test line by line.
 *
 * ARCHITECTURE of the listening path:
 *   mic (AEC on) → ScriptProcessor → 16 kHz s16le PCM ring
 *     → local RMS gate (speech opens a relay session, streams the ~1.2s
 *       PRE-ROLL first so the wake word's first syllable is never lost,
 *       then live frames; ~20s of silence closes the session — quiet
 *       rooms cost nothing)
 *     → relay tokens → utterance on ~800ms token-silence → behavior.
 */

import { api } from "@/api/client";

// ---- the behavior (pure, tested) -------------------------------------------

/*
 * `(?![\p{L}'’])`: the name must not run into a letter OR an apostrophe.
 * The apostrophe matters because of a live incident (2026-08-26): the
 * assistant's own spoken greeting — "I am Echo's assistant" — matched the
 * wake word ("Echo" + apostrophe passed the old letter-only guard), and the
 * while-speaking barge-in treated the rest of its own sentence as a
 * command. It asked itself questions in a loop.
 */
const WAKE_RE = /(?:^|\s)(?:echo|ecco|eko|اکو|ایکو)(?![\p{L}'’])[\s.,،!?]*/iu;
/**
 * The same vocabulary as a LOOKUP, for the same-breath rules (a wake word
 * is an address, not content, so it is stripped before two breaths are
 * compared). Written out rather than built from the regex — a regex
 * assembled from an array through a template literal ate its own
 * backslashes (`\s` in a template is just "s"), which is a silent
 * miscompile of the wake word itself. `voiceBehavior.test.ts` asserts the
 * two spellings agree, so drift is caught by a check instead of by luck.
 */
export const WAKE_WORDS = new Set(["echo", "ecco", "eko", "اکو", "ایکو"]);
const STOP_RE = /(?:^|\s)(?:stop|بس|بسه|ساکت|کافیه)(?!\p{L})/iu;

/**
 * The loop's own language wall (2026-08-29, the Korean incident). This
 * loop is bilingual BY CONSTRUCTION — rule 5 — so an utterance whose
 * letters are mostly neither Persian-Arabic nor Latin is, by that same
 * construction, a provider misread, and it must die HERE: forwarded, it
 * becomes a message in the thread and the assistant faithfully answers
 * in the misread language. The provider-side restriction
 * (language_hints_strict on the relay) is the first wall; this is the
 * loop's, so a provider regression can never reach the thread again.
 *
 * Mostly, not entirely: numbers, punctuation and the odd loanword
 * letter are fine — the test is about where the LETTERS live.
 */
export function utteranceScriptOk(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const ours = text.match(/[\p{Script=Arabic}\p{Script=Latin}]/gu) ?? [];
  return ours.length / letters.length >= 0.5;
}

export function matchWake(text: string): { woke: boolean; command: string } {
  const m = WAKE_RE.exec(text);
  if (!m) return { woke: false, command: "" };
  return { woke: true, command: text.slice(m.index + m[0].length).trim() };
}

/**
 * A heard word, kept as BOTH what was said and what compares.
 *
 * Paired on purpose: the same-breath rules match on the compared form and
 * then hand back the RAW words they did not cover, so a matched prefix has
 * to map to exact raw words. Canonicalising a whole sentence and slicing by
 * word index cannot do that — "don't" loses its apostrophe and becomes two
 * words, «می‌خواهم» splits at the joiner, and the arithmetic drifts by one
 * word per contraction. Per-word canonicalisation cannot drift: one word
 * in, one word out, punctuation stripped INSIDE the word.
 */
export interface HeardWord {
  raw: string;
  canon: string;
}

export function heardWords(text: string): HeardWord[] {
  return text
    .split(/\s+/)
    .map((raw) => ({
      raw,
      /* the ZWNJ stays: it is Cf, not \p{L}, and in Persian the joiner is
         part of the word — dropping it makes a different token than the
         next breath produces */
      canon: raw.toLowerCase().replace(/[^\p{L}\p{N}‌]/gu, ""),
    }))
    .filter((word) => word.canon !== "");
}

/** the words that COMPARE: the wake word is an address, not content */
function comparable(words: readonly HeardWord[]): string[] {
  const canon = words.map((word) => word.canon);
  return WAKE_WORDS.has(canon[0] ?? "") ? canon.slice(1) : canon;
}

/** is `needle` a contiguous run of words inside `haystack`? */
function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let from = 0; from + needle.length <= haystack.length; from += 1) {
    let all = true;
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[from + i] !== needle[i]) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

export type BreathVerdict =
  /** the same content said again */
  | { kind: "same" }
  /** a piece of the previous breath, re-finalised by the provider */
  | { kind: "fragment" }
  /** the previous breath plus words it had not spent yet */
  | { kind: "extends"; fresh: HeardWord[] }
  /** something else entirely */
  | { kind: "new" };

/**
 * How this utterance relates to the previous one — the WHOLE same-breath
 * decision, in one pure function (rebuilt 2026-08-29 after the live
 * double-hear survived a first fix).
 *
 * The comparison runs on the WAKE-STRIPPED words, and that is what the
 * first attempt missed: the relay re-finalises a breath without its wake
 * word, so «echo, go to the users» and «go to the users, okay go to
 * settings» looked unrelated to a whole-sentence prefix test — and one
 * sentence got two answers, exactly as the screenshot showed.
 *
 * The caller owns the CLOCK: this says what the utterance IS; the windows
 * in `consume` say how long each kind stays believable.
 */
export function compareBreath(
  previous: readonly string[],
  current: readonly HeardWord[],
): BreathVerdict {
  const core = comparable(current);
  if (previous.length === 0 || core.length === 0) return { kind: "new" };
  if (core.length === previous.length && core.every((w, i) => w === previous[i])) {
    return { kind: "same" };
  }
  if (containsRun(previous, core)) return { kind: "fragment" };
  if (core.length > previous.length && previous.every((w, i) => w === core[i])) {
    /* map the uncovered tail back to raw words by counting from the END,
       which both forms share whether or not a wake word led this one */
    return { kind: "extends", fresh: current.slice(current.length - (core.length - previous.length)) };
  }
  return { kind: "new" };
}

export interface VoiceHandlers {
  /** the name alone — ack and open */
  onWake: () => void;
  /** an utterance to answer */
  onCommand: (command: string) => void;
  /** rule 3 — stop talking (and end the exchange) */
  onStop: () => void;
  onState?: (state: "idle" | "session") => void;
}

/**
 * The whole behavior. `consume(text)` is called once per finished
 * utterance; `speaking` tells it the assistant's own voice is playing.
 *
 *  - idle: only the NAME does anything. Name alone → wake; name+words →
 *    that's the command.
 *  - session (45s, renewed by use): everything is a command; a short
 *    utterance containing a stop word ends it.
 *  - while SPEAKING: only "stop" (short) or the name act — anything else
 *    is ignored, which is the entire self-echo defense: with AEC on, the
 *    residue of the assistant's own voice is never short-and-stop and
 *    never contains its name followed by nothing it said.
 */
export function createVoiceBehavior(
  handlers: VoiceHandlers,
  options: { sessionMs?: number } = {},
) {
  const sessionMs = options.sessionMs ?? 45_000;
  let inSession = false;
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;
  let speaking = false;
  /** the previous breath's comparable words, and when it landed */
  let lastBreath: string[] = [];
  let lastBreathAt = 0;

  const endSession = () => {
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = null;
    if (inSession) {
      inSession = false;
      handlers.onState?.("idle");
    }
  };
  const renew = () => {
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(endSession, sessionMs);
    if (!inSession) {
      inSession = true;
      handlers.onState?.("session");
    }
  };

  return {
    setSpeaking(next: boolean) { speaking = next; },
    endSession,
    /* the same `renew` the wake word calls — exposed so a held key can be the
       wake, rather than a second, hidden path into the session state */
    openSession: renew,
    get inSession() { return inSession; },

    consume(text: string, now = Date.now()) {
      const heard = heardWords(text);
      if (heard.length === 0) return;

      /*
       * TWO WINDOWS, because the kinds mean different things:
       *  · the SAME words within 6s are the provider re-finalising — ten
       *    seconds later they are a person repeating a command that got no
       *    visible result, and that must act again;
       *  · a FRAGMENT or an EXTENSION of the last breath stays believable
       *    for 15s, because the assistant's own multi-second reply sits in
       *    the middle of exactly those artifacts, and nobody re-asks with a
       *    torn-off piece of their own sentence.
       * The anchor stays on the last REAL breath: a dropped artifact does
       * not renew the window, or a re-finalisation storm would hold it
       * open forever.
       */
      const elapsed = now - lastBreathAt;
      const verdict = compareBreath(lastBreath, heard);
      if (verdict.kind === "same" && elapsed < 6_000) return;
      if (verdict.kind === "fragment" && elapsed < 15_000) return;
      if (verdict.kind === "extends" && elapsed < 15_000) {
        /* only the words this breath has not already spent go forward */
        text = verdict.fresh.map((word) => word.raw).join(" ");
      }
      lastBreath = comparable(heard);
      lastBreathAt = now;

      const words = heardWords(text).length;
      const wake = matchWake(text);
      const stops = STOP_RE.test(text);

      if (speaking) {
        /*
         * Rule 3, while the voice plays: a SHORT stop cuts it. Nothing
         * else — the wake+command barge-in that used to live here was the
         * self-echo hole: the assistant says its own name ("I am Echo's
         * assistant"), the mic hears it, and the barge-in ran its own
         * words as a command. Real barge-in is impossible anyway now that
         * the mic is muted during playback; this branch only sees the
         * decode tail, and a tail must never act.
         */
        if (stops && words <= 4) { handlers.onStop(); endSession(); return; }
        return;
      }

      if (!inSession) {
        if (!wake.woke) return; // rule 1: nothing happens without the name
        renew();
        if (wake.command) handlers.onCommand(wake.command);
        else handlers.onWake();
        return;
      }

      // in session
      if (stops && words <= 4) { handlers.onStop(); endSession(); return; }
      if (wake.woke && !wake.command) { renew(); handlers.onWake(); return; }
      renew();
      handlers.onCommand(wake.woke ? wake.command : text.trim());
    },
  };
}

// ---- the listening loop (browser plumbing) ---------------------------------

const TARGET_RATE = 16_000;
const PREROLL_MS = 1_200;
const SPEECH_RMS = 0.012;
const HANGOVER_MS = 1_800;
const SESSION_LINGER_MS = 20_000;
/* 1200, was 800 (2026-08-29): Persian sentences carry mid-breath pauses
   («…می‌خواهم در موردِ …») and an early fire costs a whole wasted model
   round trip plus a double answer — far more time than the 400ms this
   adds to every turn's end. The suffix rule above catches what still
   slips through. */
const UTTERANCE_SILENCE_MS = 1_200;

export interface VoiceLoopHandle {
  stop: () => void;
  setSpeaking: (speaking: boolean) => void;
  /**
   * Half-duplex (2026-08-26): while the assistant's own voice plays, the
   * mic is DEAF — no frames buffered, none posted, and any text already in
   * flight is dropped. Echo cancellation was the old defense and it lost
   * on real speakers; not listening cannot lose.
   */
  setMuted: (muted: boolean) => void;
  endSession: () => void;
  /**
   * OPEN A SESSION WITHOUT THE WAKE WORD (push-to-talk, 2026-09-04).
   *
   * Idle means only the NAME acts — which is the right default for a mic that
   * is always on, and exactly wrong for a key somebody is HOLDING DOWN. The
   * hold IS the wake: a person pressing a key and speaking has already said
   * who they are talking to, and making them say "Echo" as well is asking for
   * the password twice.
   */
  openSession: () => void;
}

export function voiceLoopSupported(): boolean {
  return typeof window !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof AudioContext !== "undefined";
}

export async function startVoiceLoop(handlers: VoiceHandlers): Promise<VoiceLoopHandle | null> {
  if (!voiceLoopSupported()) return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    return null;
  }

  const behavior = createVoiceBehavior(handlers);
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor: deprecated but universal, and 85ms frames are plenty —
  // an AudioWorklet would need its own served module for ~nothing here
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  source.connect(proc);
  proc.connect(ctx.destination); // required for onaudioprocess in some engines

  let stopped = false;
  let muted = false;
  // the pre-roll ring: the last ~1.2s of PCM, so opening the relay on
  // speech onset still delivers the wake word's first syllable
  const ring: Int16Array[] = [];
  let ringMs = 0;
  // relay session state
  let session: { id: string; base: string; ticket: string; es: EventSource } | null = null;
  let opening = false;
  let lastVoiceAt = 0;
  let lastTokenAt = 0;
  let finalsBuf = "";
  let interimBuf = "";
  let pending: Int16Array[] = [];

  const downsample = (input: Float32Array): Int16Array => {
    const ratio = ctx.sampleRate / TARGET_RATE;
    const out = new Int16Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i += 1) {
      // average the span — cheap anti-aliasing that is fine for speech
      const from = Math.floor(i * ratio);
      const to = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to; j += 1) sum += input[j]!;
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
      out[i] = Math.round(v * 32767);
    }
    return out;
  };

  const frameMs = (frame: Int16Array) => (frame.length / TARGET_RATE) * 1000;

  const post = (frames: Int16Array[]) => {
    if (!session || frames.length === 0) return;
    const total = frames.reduce((n, f) => n + f.length, 0);
    const joined = new Int16Array(total);
    let at = 0;
    for (const f of frames) { joined.set(f, at); at += f.length; }
    void fetch(
      `${session.base}/v1/live-stt/${encodeURIComponent(session.id)}/audio?ticket=${encodeURIComponent(session.ticket)}`,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: joined.buffer as ArrayBuffer },
    ).catch(() => undefined);
  };

  const closeSession = () => {
    const s = session;
    session = null;
    finalsBuf = "";
    interimBuf = "";
    if (!s) return;
    void api.liveSttStop(s.id).catch(() => undefined);
    setTimeout(() => s.es.close(), 3_000);
  };

  const openSession = async () => {
    if (session || opening || stopped) return;
    opening = true;
    try {
      const started = await api.liveSttStart("pcm16k");
      if (stopped || !started.ticket) return;
      const base = started.direct_url || "";
      const es = new EventSource(
        base
          ? `${base}/v1/live-stt/${encodeURIComponent(started.session_id)}/events?ticket=${encodeURIComponent(started.ticket)}`
          : `/api/live-stt/${encodeURIComponent(started.session_id)}/events`,
      );
      es.onmessage = (event) => {
        try {
          const body = JSON.parse(event.data as string) as {
            type: string;
            tokens?: { text: string; is_final: boolean }[];
          };
          if (body.type === "closed" || body.type === "error") {
            es.close();
            if (session?.es === es) closeSession();
            return;
          }
          if (body.type === "tokens" && body.tokens) {
            if (muted) return;
            const finals = body.tokens.filter((t) => t.is_final).map((t) => t.text).join("");
            const interim = body.tokens.filter((t) => !t.is_final).map((t) => t.text).join("");
            if (finals) finalsBuf += finals;
            interimBuf = interim;
            if (finals || interim) lastTokenAt = Date.now();
          }
        } catch { /* not a token frame */ }
      };
      session = { id: started.session_id, base, ticket: started.ticket, es };
      // pre-roll first: the syllables that opened the gate
      const preroll = [...ring];
      post(preroll);
      if (pending.length > 0) { post(pending); pending = []; }
    } catch {
      // relay unavailable — the loop keeps gating locally and retries on
      // the next speech onset; nothing to say every few seconds
    } finally {
      opening = false;
    }
  };

  proc.onaudioprocess = (event) => {
    if (stopped) return;
    if (muted) {
      // deaf: nothing buffers while our own voice plays, and the pre-roll
      // is emptied so unmuting cannot replay the tail of that voice
      ring.length = 0;
      ringMs = 0;
      pending = [];
      return;
    }
    const input = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i += 1) sum += input[i]! * input[i]!;
    const rms = Math.sqrt(sum / input.length);
    const frame = downsample(input);
    const now = Date.now();

    ring.push(frame);
    ringMs += frameMs(frame);
    while (ringMs > PREROLL_MS && ring.length > 1) {
      ringMs -= frameMs(ring[0]!);
      ring.shift();
    }

    if (rms >= SPEECH_RMS) lastVoiceAt = now;
    const voiced = now - lastVoiceAt <= HANGOVER_MS;

    if (voiced) {
      if (session) post([frame]);
      else {
        pending.push(frame);
        if (pending.length > 40) pending.shift();
        void openSession();
      }
    } else if (session && now - lastVoiceAt > SESSION_LINGER_MS) {
      closeSession();
    }
  };

  // the utterance gate: token silence, checked on a coarse clock
  const gate = setInterval(() => {
    if (stopped) return;
    const text = (finalsBuf + interimBuf).trim();
    if (!text) return;
    if (Date.now() - lastTokenAt < UTTERANCE_SILENCE_MS) return;
    finalsBuf = "";
    interimBuf = "";
    if (!utteranceScriptOk(text)) return; // a misread, not a sentence
    behavior.consume(text);
  }, 200);

  return {
    stop: () => {
      stopped = true;
      clearInterval(gate);
      behavior.endSession();
      closeSession();
      try { proc.disconnect(); source.disconnect(); } catch { /* fine */ }
      void ctx.close();
      stream.getTracks().forEach((track) => track.stop());
    },
    setSpeaking: (speaking) => behavior.setSpeaking(speaking),
    setMuted: (next) => {
      muted = next;
      if (next) {
        // whatever was mid-decode is our own opening words — drop it
        finalsBuf = "";
        interimBuf = "";
      }
    },
    endSession: () => behavior.endSession(),
    openSession: () => behavior.openSession(),
  };
}
