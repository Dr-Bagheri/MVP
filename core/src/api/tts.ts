/**
 * M37 — the platform's voice, REBUILT 2026-08-29 (user directive: "change
 * the TTS to gemini … fix all of it … good speed"; and the grand rule —
 * a rework replaces the unit, it does not decorate it).
 *
 * The shape: ONE registry of four voices (gender × language), and for each
 * synthesis a two-rung ladder —
 *
 *   1. Gemini 3.1 Flash TTS through OpenRouter (`/api/v1/audio/speech`,
 *      model google/gemini-3.1-flash-tts-preview) — the PRIMARY voice.
 *      One multilingual model speaks both Persian and English; gender maps
 *      to its prebuilt voices (Kore female / Charon male). The provider
 *      answers ONLY raw PCM (24 kHz s16le mono — its 400 says so by name,
 *      proven live 2026-08-29), so the adapter wraps a 44-byte WAV header
 *      and every caller keeps playing plain WAV.
 *
 *   2. The on-box piper units (loopback, one model per port) — the
 *      FALLBACK, kept because the primary is a network dependency and the
 *      probe run that accepted Gemini also caught it answering 502 twice
 *      in four calls. A cloud hiccup costs nothing but a rung; it must
 *      never cost the voice. The fall is reported on the result (`rung`)
 *      so the route can log the forfeit out loud (M21) — codes only.
 *
 * Acceptance (M19, run live on the server 2026-08-29): fa Kore 334 KB /
 * fa Charon 213 KB / en Kore 313 KB / en Puck 111 KB of real PCM —
 * positive detection per voice and per language, not status trust.
 *
 * Env is the availability fact: OPENROUTER_API_KEY arms the primary,
 * TTS_URL / TTS_URL_FA_FEMALE / TTS_URL_EN_FEMALE / TTS_URL_EN_MALE arm
 * the fallback per voice. No env, no rung, said out loud. The text is
 * spoken CONTENT: it is never logged here (invariant 3).
 */

export const TTS_VOICES = ["fa_female", "fa_male", "en_female", "en_male"] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

/** Gemini's prebuilt voices, by gender — the model itself is multilingual,
    so the LANGUAGE comes from the text and only the gender needs mapping. */
const GEMINI_VOICE: Record<TtsVoice, string> = {
  fa_female: "Kore", en_female: "Kore",
  fa_male: "Charon", en_male: "Charon",
};

const GEMINI_MODEL = "google/gemini-3.1-flash-tts-preview";
const GEMINI_SAMPLE_RATE = 24_000;

/** A WAV under this is not an utterance; PCM at 24 kHz runs ~48 KB/s, so
    even a clipped word clears it. The same rule that caught the header-only
    200 in the first piper adapter (positive detection, not status trust). */
const MIN_SPEECH_BYTES = 4_096;

export interface TtsResult {
  audio: Uint8Array;
  mime: string;
  /** which rung actually spoke — the route logs a fall as a forfeit */
  rung: "gemini" | "piper";
}

export interface TtsService {
  available: (voice?: TtsVoice) => boolean;
  /** which voices this deployment can speak, by any rung */
  voices: () => Record<TtsVoice, boolean>;
  /** Audio for the text. Throws (named) only when EVERY rung is out. */
  synthesize: (text: string, voice?: TtsVoice) => Promise<TtsResult>;
}

/** raw s16le PCM → a playable WAV: the 44-byte RIFF header, nothing more */
export function wrapPcmAsWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // PCM format
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  view.setUint16(32, 2, true);         // block align
  view.setUint16(34, 16, true);        // bits per sample
  write(36, "data");
  view.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}

export function createTts(options: {
  /** legacy single-URL spelling — still the fa_male piper */
  url?: string | undefined;
  urls?: Partial<Record<TtsVoice, string | undefined>>;
  openrouterKey?: string | undefined;
  fetchImpl?: typeof fetch;
} = {}): TtsService {
  const piperUrls: Record<TtsVoice, string | undefined> = {
    fa_male: options.urls?.fa_male ?? options.url ?? process.env.TTS_URL,
    fa_female: options.urls?.fa_female ?? process.env.TTS_URL_FA_FEMALE,
    en_female: options.urls?.en_female ?? process.env.TTS_URL_EN_FEMALE,
    en_male: options.urls?.en_male ?? process.env.TTS_URL_EN_MALE,
  };
  const openrouterKey = options.openrouterKey ?? process.env.OPENROUTER_API_KEY;
  const doFetch = options.fetchImpl ?? fetch;

  async function speakGemini(text: string, voice: TtsVoice): Promise<Uint8Array | null> {
    if (!openrouterKey) return null;
    try {
      const response = await doFetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: {
          authorization: `Bearer ${openrouterKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          input: text,
          voice: GEMINI_VOICE[voice],
          response_format: "pcm",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const pcm = new Uint8Array(await response.arrayBuffer());
      // a 200 with an empty stream is one of the observed failures — the
      // provider itself 502s that sentence sometimes; treat tiny as absent
      if (pcm.length < MIN_SPEECH_BYTES) return null;
      return wrapPcmAsWav(pcm, GEMINI_SAMPLE_RATE);
    } catch {
      return null; // timeout / network — the fall is the report, below
    }
  }

  async function speakPiper(text: string, voice: TtsVoice): Promise<Uint8Array> {
    const url = piperUrls[voice];
    if (!url) throw new Error(`tts unavailable — no rung can speak voice ${voice}`);
    /*
     * The provider's spelling, proven live on the box (2026-08-21):
     * piper 1.7's http_server takes POST /synthesize with JSON
     * {"text": ...} → WAV. A raw text/plain POST to "/" answers 405.
     */
    const response = await doFetch(`${url.replace(/\/$/, "")}/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`tts upstream refused: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 1024) {
      throw new Error(`tts produced ${bytes.length} bytes — not speech`);
    }
    return bytes;
  }

  return {
    available: (voice: TtsVoice = "fa_male") =>
      Boolean(openrouterKey) || Boolean(piperUrls[voice]),
    voices: () => ({
      fa_female: Boolean(openrouterKey) || Boolean(piperUrls.fa_female),
      fa_male: Boolean(openrouterKey) || Boolean(piperUrls.fa_male),
      en_female: Boolean(openrouterKey) || Boolean(piperUrls.en_female),
      en_male: Boolean(openrouterKey) || Boolean(piperUrls.en_male),
    }),
    async synthesize(text: string, voice: TtsVoice = "fa_male"): Promise<TtsResult> {
      const gemini = await speakGemini(text, voice);
      if (gemini) return { audio: gemini, mime: "audio/wav", rung: "gemini" };
      const piper = await speakPiper(text, voice);
      return { audio: piper, mime: "audio/wav", rung: "piper" };
    },
  };
}
