/**
 * M37 — the platform's own voice: text → speech through an on-box piper
 * server (systemd unit `neurai-tts`, loopback only, never exposed).
 *
 * Exists because the browser cannot be trusted to speak Persian: Windows
 * ships no fa voice, so a Persian-first product whose assistant "answers
 * in its own voice" needs a voice it OWNS. The browser's local voice stays
 * the first rung where one exists (Edge); this is the rung underneath.
 *
 * Env-gated like a capability: no TTS_URL → `available()` is false and the
 * route answers 503 `tts_unavailable`, loudly — never a silent empty file.
 * The text is spoken CONTENT: it is never logged here (invariant 3's
 * no-content-in-logs, outbound-audio flavor).
 */

/**
 * The voice registry (0128, user directive 2026-08-28: gender choice for
 * Persian AND English). One piper process per model, each on its own
 * loopback port; the env var IS the availability fact — no URL, no voice,
 * said out loud. `fa_male` reuses TTS_URL so the original deployment's
 * meaning is unchanged.
 */
export const TTS_VOICES = ["fa_female", "fa_male", "en_female", "en_male"] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export interface TtsService {
  available: (voice?: TtsVoice) => boolean;
  /** which voices this deployment can actually speak */
  voices: () => Record<TtsVoice, boolean>;
  /** WAV bytes for the given text. Throws on any rung failing — the caller
      maps that to a legible refusal, never to silence. */
  synthesize: (text: string, voice?: TtsVoice) => Promise<Uint8Array>;
}

export function createTts(options: {
  url?: string | undefined;
  urls?: Partial<Record<TtsVoice, string | undefined>>;
  fetchImpl?: typeof fetch;
} = {}): TtsService {
  const urls: Record<TtsVoice, string | undefined> = {
    fa_male: options.urls?.fa_male ?? options.url ?? process.env.TTS_URL,
    fa_female: options.urls?.fa_female ?? process.env.TTS_URL_FA_FEMALE,
    en_female: options.urls?.en_female ?? process.env.TTS_URL_EN_FEMALE,
    en_male: options.urls?.en_male ?? process.env.TTS_URL_EN_MALE,
  };
  const doFetch = options.fetchImpl ?? fetch;
  return {
    available: (voice: TtsVoice = "fa_male") => Boolean(urls[voice]),
    voices: () => ({
      fa_female: Boolean(urls.fa_female), fa_male: Boolean(urls.fa_male),
      en_female: Boolean(urls.en_female), en_male: Boolean(urls.en_male),
    }),
    async synthesize(text: string, voice: TtsVoice = "fa_male"): Promise<Uint8Array> {
      const url = urls[voice];
      /* an EXPLICIT voice that cannot be honored is refused by name, never
         silently swapped for another gender (M21: degrade what was
         inferred, fail on what was told) */
      if (!url) throw new Error(`tts unavailable — no URL configured for voice ${voice}`);
      /*
       * The provider's spelling, proven live on the box (2026-08-21):
       * piper 1.7's http_server takes POST /synthesize with JSON
       * {"text": ...} → WAV. A raw text/plain POST to "/" answers 405 —
       * the first draft of this adapter did exactly that and only the
       * live run said so. The adapter owns this knowledge (rule 12:
       * absence — and spelling — is decided by the adapter).
       */
      const response = await doFetch(`${url.replace(/\/$/, "")}/synthesize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`tts upstream refused: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      /*
       * Positive detection (rule 7): a synthesizer wired wrong fails
       * SILENTLY — a 200 with an empty or header-only body is "speech" that
       * plays as nothing. A WAV under a kilobyte cannot hold an utterance.
       */
      if (bytes.length < 1024) {
        throw new Error(`tts produced ${bytes.length} bytes — not speech`);
      }
      return bytes;
    },
  };
}
