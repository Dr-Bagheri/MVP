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

function canonical(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
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
  let lastCanon = "";
  let lastCanonAt = 0;

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
    get inSession() { return inSession; },

    consume(text: string, now = Date.now()) {
      const canon = canonical(text);
      if (!canon) return;
      // the one dedupe rule: the provider re-finalizes words the silence
      // gate already consumed — an identical (or contained) utterance
      // within 6s is the same breath, not a new one
      if (now - lastCanonAt < 6_000 && (canon === lastCanon || lastCanon.includes(canon))) return;
      lastCanon = canon;
      lastCanonAt = now;

      const words = canon.split(" ").length;
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
const UTTERANCE_SILENCE_MS = 800;

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
  };
}
