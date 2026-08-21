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

export interface TtsService {
  available: () => boolean;
  /** WAV bytes for the given text. Throws on any rung failing — the caller
      maps that to a legible refusal, never to silence. */
  synthesize: (text: string) => Promise<Uint8Array>;
}

export function createTts(options: {
  url?: string | undefined;
  fetchImpl?: typeof fetch;
} = {}): TtsService {
  const url = options.url ?? process.env.TTS_URL;
  const doFetch = options.fetchImpl ?? fetch;
  return {
    available: () => Boolean(url),
    async synthesize(text: string): Promise<Uint8Array> {
      if (!url) throw new Error("tts unavailable — TTS_URL not configured");
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
