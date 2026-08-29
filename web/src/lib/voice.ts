/**
 * The assistant's MOUTH — rebuilt whole, 2026-08-29 (user directive:
 * "change the TTS to gemini … in fa it starts talking in Persian, in en
 * in English … when it starts recording it gets silence until after it
 * finished … good speed"; and the grand rule — a rework replaces the
 * unit, it does not decorate it).
 *
 * What was deleted with intent: the whole browser-speechSynthesis rung
 * (voice pickers, gender heuristics, Dilara/Farid name lists, the
 * client-side gender cache). The platform now speaks with ONE voice per
 * language-and-gender — the server's Gemini registry — so every listener
 * hears the same assistant, and the gender choice lives in exactly one
 * place (the person's stored preference, applied server-side at
 * synthesis). A browser voice was a second voice wearing the same name.
 *
 * What this file is now:
 *  · one playback path (an <audio> element over the server's WAV),
 *  · the sentence queue with ENQUEUE-TIME synthesis — every sentence is
 *    at the synthesizer the moment it is queued, so the model's latency
 *    overlaps playback and the reply's own streaming instead of standing
 *    between sentences as an audible gap,
 *  · the recording gate — while a recording is live the mouth is SILENT:
 *    whatever was playing stops, whatever arrives is dropped, and speech
 *    resumes only for what is said after the take ends,
 *  · the playback state the ears subscribe to, and the watchdogs that
 *    keep a jammed pipeline from muting them forever.
 *
 * LISTENING LIVES ELSEWHERE (lib/voiceLoop.ts — the M38 relay + local VAD
 * + the five-rule behavior). This file never touches a microphone.
 */

import { subscribeRecordingLive } from "@/lib/assistantBus";

// ── playback state, published for the ears ─────────────────────────────

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

/** the server-voice element currently playing, if any — the one audio
    source the level meter can actually tap */
let serverAudio: HTMLAudioElement | null = null;

export function currentSpeechAudio(): HTMLAudioElement | null {
  return serverAudio;
}

/*
 * `spokenHistory` and its `recentSpokenText()` getter stood here until
 * 2026-08-29. They were the echo filter's reference text — what the assistant
 * had said out loud, so the loop could recognise its own voice arriving back
 * through the microphone. The rewritten loop compares BREATHS instead
 * (voiceLoop.ts's `compareBreath`), so nothing read the string any more while
 * `speakQueued` kept appending to it on every utterance: a write with no
 * reader, which is a producer with no consumer wearing a smaller hat, and it
 * cost a string concatenation on every reply forever.
 */

// ── the language of a sentence, with the locale as the tiebreaker ──────

const PERSIAN_RE = /[؀-ۿ]/;
const LATIN_RE = /[a-z]/i;

/**
 * Which voice speaks this text. Script decides when it can — Persian
 * letters mean the Persian voice, Latin letters the English one — and
 * when the text carries no letters of either (digits, punctuation, an
 * emoji), the UI LOCALE decides (user rule, 2026-08-29: fa starts in
 * Persian by default, en in English). The locale is read off the
 * document, where next-intl already stamped it.
 */
export function speechLangOf(text: string, docLang?: string): "fa" | "en" {
  if (PERSIAN_RE.test(text)) return "fa";
  if (LATIN_RE.test(text)) return "en";
  const locale = docLang
    ?? (typeof document !== "undefined" ? document.documentElement.lang : "fa");
  return locale.toLowerCase().startsWith("en") ? "en" : "fa";
}

// ── the recording gate: a live take silences the mouth ─────────────────

let recordingSilence = false;

/**
 * While a recording is live the assistant does not speak — its voice on
 * the speakers would land in the take (user rule, 2026-08-29: "when it
 * starts recording it gets silence until after it finished"). Activation
 * also CUTS whatever is mid-sentence; queued sentences are dropped, not
 * held — a burst of stale replies after pressing stop would be noise
 * wearing patience's costume.
 */
export function setRecordingSilence(active: boolean): void {
  recordingSilence = active;
  if (active) stopSpeaking();
}

// one producer: the recording engine announces phase changes on the bus,
// and the mouth subscribes exactly like the ears' suspension does
if (typeof window !== "undefined") {
  subscribeRecordingLive((live) => setRecordingSilence(live));
}

// ── stop: cut the voice NOW ────────────────────────────────────────────

/** exported for the dock's LOCAL stop: cut whatever voice is playing */
export function stopSpeaking(): void {
  speechQueue.length = 0; // whatever was waiting to be said is unsaid
  if (serverAudio) {
    serverAudio.pause();
    serverAudio = null;
  }
  playbackToken += 1; // orphan any in-flight done() callbacks and pumps
  publishPlayback(false);
}

// ── synthesis + playback ───────────────────────────────────────────────

/**
 * A watchdog around every awaited utterance (2026-08-22, the dead-orb
 * report): a pipeline that fires NEITHER ended NOR error would leave the
 * pump open, `publishPlayback(false)` never runs, and the wake machine
 * stays MUTED forever. The ceiling is generous; firing it also stops the
 * jammed element so the next utterance starts clean.
 */
function speechWatchdogMs(text: string): number {
  return Math.min(30_000, 3_000 + text.length * 120);
}

async function synthesize(text: string): Promise<Blob> {
  const { api } = await import("@/api/client");
  return api.tts(text.slice(0, 1200), speechLangOf(text));
}

/** play one WAV blob to its end (or its watchdog) */
function playBlob(blob: Blob, text: string): Promise<void> {
  const audio = new Audio(URL.createObjectURL(blob));
  serverAudio = audio;
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (jammed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (jammed) { try { audio.pause(); } catch { /* fine */ } }
      URL.revokeObjectURL(audio.src);
      if (serverAudio === audio) serverAudio = null;
      resolve();
    };
    const watchdog = setTimeout(() => finish(true), speechWatchdogMs(text) + 15_000);
    audio.onended = () => finish(false);
    audio.onerror = () => finish(false);
    audio.onpause = () => finish(false); // stopSpeaking() pauses mid-word
    void audio.play().catch(() => finish(false));
  });
}

let warnedNoVoice = false;
async function speakOne(text: string, ready?: Promise<Blob> | null): Promise<void> {
  try {
    const blob = await (ready ?? synthesize(text));
    if (recordingSilence) return; // a take started while synthesizing
    await playBlob(blob, text);
  } catch {
    if (!warnedNoVoice) {
      warnedNoVoice = true;
      const { notify } = await import("@/lib/notify");
      notify("صدای دستیار در دسترس نیست — سرویس گفتار پاسخ نداد.", "warn");
    }
  }
}

// ── the sentence queue: synthesis starts at ENQUEUE ────────────────────

/*
 * The reply is spoken sentence-by-sentence AS IT STREAMS, and every
 * sentence's synthesis starts the moment it is QUEUED — not when its turn
 * to play arrives. The first cut of this queue prefetched only "the next
 * item at pump time", which missed the common case entirely: sentences
 * stream in one at a time WHILE the previous one plays, so the queue was
 * empty at every pump step and each sentence paid the model's full
 * latency as an audible gap (the live complaint: "between its sentences
 * it waits"). Enqueue-time synthesis overlaps the model with playback
 * and with the reply still being written; order is kept by the queue.
 *
 * Short phrases are CACHED: the acks («بله؟», «متوجه شدم») repeat all
 * day, and the second «بله؟» should cost nothing. The cache empties when
 * the person changes their voice gender — a cached ack in the old voice
 * would outlive the choice.
 */
interface QueuedSpeech { text: string; blob: Promise<Blob> }
const speechQueue: QueuedSpeech[] = [];
let queuePumping = false;

const PHRASE_CACHE_MAX_LENGTH = 60;
const phraseCache = new Map<string, Blob>();

/** the settings screen saved a new voice — cached audio wears the old one */
export function clearSpeechCache(): void {
  phraseCache.clear();
}

function synthesizeCached(text: string): Promise<Blob> {
  const cacheable = text.length <= PHRASE_CACHE_MAX_LENGTH;
  if (cacheable) {
    const hit = phraseCache.get(text);
    if (hit) return Promise.resolve(hit);
  }
  const blob = synthesize(text);
  if (cacheable) {
    void blob.then((b) => {
      phraseCache.set(text, b);
      if (phraseCache.size > 24) {
        const oldest = phraseCache.keys().next().value;
        if (oldest !== undefined) phraseCache.delete(oldest);
      }
    }).catch(() => undefined);
  }
  return blob;
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced blocks are for eyes, not voice
    .replace(/[`*_#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function speakQueued(text: string): void {
  if (typeof window === "undefined") return;
  if (recordingSilence) return; // a live take: the mouth stays shut
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return;
  const blob = synthesizeCached(cleaned);
  blob.catch(() => undefined); // its failure is speakOne's to report
  speechQueue.push({ text: cleaned, blob });
  void pumpSpeechQueue();
}

/**
 * Speak a reply in its own language — Persian text through the Persian
 * voice, English through the English one, the locale deciding when the
 * text cannot. Cancels whatever was still being spoken: newest wins.
 */
export function speak(text: string): void {
  if (typeof window === "undefined") return;
  if (recordingSilence) return;
  stopSpeaking();
  speakQueued(text);
}

async function pumpSpeechQueue(): Promise<void> {
  if (queuePumping) return;
  queuePumping = true;
  const token = ++playbackToken;
  publishPlayback(true);
  try {
    while (speechQueue.length > 0 && token === playbackToken && !recordingSilence) {
      const next = speechQueue.shift()!;
      await speakOne(next.text, next.blob);
    }
  } finally {
    queuePumping = false;
    if (token === playbackToken) publishPlayback(false);
    // a sentence that arrived while we were closing down starts a new pump
    if (speechQueue.length > 0 && !recordingSilence) void pumpSpeechQueue();
  }
}
