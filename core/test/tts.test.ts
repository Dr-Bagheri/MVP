/**
 * M37 rebuilt (2026-08-29): Gemini-through-OpenRouter primary, on-box
 * piper fallback. The tests pin the ladder's honesty — who spoke, what
 * fell, and that a status-200 nothing is still a nothing.
 */
import { describe, expect, it } from "vitest";
import { createTts, wrapPcmAsWav } from "../src/api/tts.ts";

const KEY = "sk-or-test-not-a-real-key";
const pcm = (bytes: number) => new Uint8Array(bytes).fill(1);
const wav = (bytes: number) => wrapPcmAsWav(pcm(bytes), 24_000);

function fetchScript(script: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const asked: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    asked.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return script(String(url), init);
  }) as unknown as typeof fetch;
  return { impl, asked };
}

describe("wrapPcmAsWav", () => {
  it("writes a playable RIFF header around the exact samples", () => {
    const wrapped = wrapPcmAsWav(pcm(48_000), 24_000);
    expect(wrapped.length).toBe(44 + 48_000);
    expect(String.fromCharCode(...wrapped.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wrapped.slice(8, 12))).toBe("WAVE");
    const view = new DataView(wrapped.buffer);
    expect(view.getUint32(24, true)).toBe(24_000); // sample rate survives
    expect(view.getUint32(40, true)).toBe(48_000); // data length is the pcm's
  });
});

describe("the Gemini rung", () => {
  it("asks OpenRouter for PCM with the gender's voice, and serves WAV", async () => {
    const { impl, asked } = fetchScript(() => new Response(pcm(50_000), { status: 200 }));
    const tts = createTts({ openrouterKey: KEY, urls: {}, fetchImpl: impl });

    const spoken = await tts.synthesize("سلام بر شما، جلسهٔ امروز آماده است.", "fa_female");

    expect(spoken.rung).toBe("gemini");
    expect(spoken.mime).toBe("audio/wav");
    expect(String.fromCharCode(...spoken.audio.slice(0, 4))).toBe("RIFF");
    expect(asked[0]!.url).toContain("openrouter.ai/api/v1/audio/speech");
    expect(asked[0]!.body).toMatchObject({
      model: "google/gemini-3.1-flash-tts-preview",
      voice: "Kore",
      response_format: "pcm", // the provider's own 400 named this rule
    });
  });

  it("maps the male choice to Charon", async () => {
    const { impl, asked } = fetchScript(() => new Response(pcm(50_000), { status: 200 }));
    const tts = createTts({ openrouterKey: KEY, urls: {}, fetchImpl: impl });
    await tts.synthesize("hello there, a longer test sentence", "en_male");
    expect(asked[0]!.body.voice).toBe("Charon");
  });
});

describe("the fall to piper — loud, never silent", () => {
  it("a provider 502 falls to the voice's own piper unit, and SAYS so via rung", async () => {
    const { impl, asked } = fetchScript((url) =>
      url.includes("openrouter")
        ? new Response("upstream sad", { status: 502 })
        : new Response(wav(20_000), { status: 200 }));
    const tts = createTts({
      openrouterKey: KEY,
      urls: { fa_female: "http://127.0.0.1:5002" },
      fetchImpl: impl,
    });

    const spoken = await tts.synthesize("سلام دوباره بر شما", "fa_female");

    expect(spoken.rung).toBe("piper");
    expect(asked.map((a) => a.url)).toEqual([
      expect.stringContaining("openrouter"),
      expect.stringContaining("5002"),
    ]);
  });

  it("a 200 carrying next to nothing is a failure, not speech — positive detection", async () => {
    /* observed live (2026-08-29): the provider itself wraps this as
       "empty audio stream after HTTP 200" sometimes; and a header-only
       body was the original piper adapter's silent-failure mode too */
    const { impl } = fetchScript((url) =>
      url.includes("openrouter")
        ? new Response(pcm(100), { status: 200 })
        : new Response(wav(20_000), { status: 200 }));
    const tts = createTts({
      openrouterKey: KEY,
      urls: { en_female: "http://127.0.0.1:5003" },
      fetchImpl: impl,
    });
    const spoken = await tts.synthesize("a full sentence worth of words", "en_female");
    expect(spoken.rung).toBe("piper");
  });

  it("when EVERY rung is out, the refusal names the voice", async () => {
    const tts = createTts({ openrouterKey: undefined, urls: {}, url: undefined, fetchImpl: fetchScript(() => new Response("", { status: 500 })).impl });
    await expect(tts.synthesize("سلام", "en_female")).rejects.toThrow(/en_female/);
  });
});

describe("availability is the env, per voice", () => {
  it("a key arms every voice; piper urls arm their own", () => {
    const withKey = createTts({ openrouterKey: KEY, urls: {}, url: undefined });
    expect(withKey.voices()).toMatchObject({
      fa_female: true, fa_male: true, en_female: true, en_male: true,
    });

    const piperOnly = createTts({ openrouterKey: undefined, urls: { fa_male: "http://127.0.0.1:5001" }, url: undefined });
    expect(piperOnly.voices()).toMatchObject({
      fa_male: true, fa_female: false, en_female: false, en_male: false,
    });
    expect(piperOnly.available("en_male")).toBe(false);
  });
});

describe("the piper contract (the fallback's own rules, unchanged)", () => {
  it("speaks the provider's spelling: JSON at /synthesize", async () => {
    const { impl, asked } = fetchScript(() => new Response(wav(20_000), { status: 200 }));
    const tts = createTts({ openrouterKey: undefined, urls: { fa_male: "http://127.0.0.1:5001" }, url: undefined, fetchImpl: impl });
    const spoken = await tts.synthesize("سلام بر شما", "fa_male");
    expect(spoken.rung).toBe("piper");
    expect(asked[0]!.url).toBe("http://127.0.0.1:5001/synthesize");
    expect(asked[0]!.body).toMatchObject({ text: "سلام بر شما" });
  });

  it("a header-only 200 FAILS — status is not speech", async () => {
    const { impl } = fetchScript(() => new Response(new Uint8Array(44), { status: 200 }));
    const tts = createTts({ openrouterKey: undefined, urls: { fa_male: "http://127.0.0.1:5001" }, url: undefined, fetchImpl: impl });
    await expect(tts.synthesize("سلام", "fa_male")).rejects.toThrow(/44 bytes/);
  });
});
