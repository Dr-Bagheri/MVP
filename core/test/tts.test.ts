import { describe, expect, it, vi } from "vitest";

import { createTts } from "../src/api/tts.ts";

/**
 * M37's unit layer. The live half of rule 7 — a REAL Persian sentence
 * through the on-box piper producing audible WAV — runs at deploy on the
 * server (recorded in the runbook); these pin the wiring and the failure
 * shapes, including the one that matters most: a synthesizer that answers
 * 200 with near-nothing must FAIL, not play as silence.
 */

function wavOf(bytes: number): Response {
  return new Response(new Uint8Array(bytes).fill(1), { status: 200 });
}

describe("createTts (M37)", () => {
  it("is unavailable without TTS_URL — a nameable nothing, never a guess", () => {
    expect(createTts({ url: undefined }).available()).toBe(false);
  });

  it("speaks the provider's contract: JSON at /synthesize (proven live)", async () => {
    // fixture from the provider (rule 10): piper answers 405 to a raw-text
    // POST at "/" — the shape below is the one the live box accepted
    const fetchImpl = vi.fn(async () => wavOf(4096));
    const tts = createTts({ url: "http://127.0.0.1:5001", fetchImpl: fetchImpl as unknown as typeof fetch });
    const audio = await tts.synthesize("سلام، این یک آزمایش است.");
    expect(audio.length).toBe(4096);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:5001/synthesize");
    expect(JSON.parse(init.body as string)).toEqual({ text: "سلام، این یک آزمایش است." });
  });

  it("a header-only 200 FAILS — positive detection, not status trust", async () => {
    const tts = createTts({
      url: "http://127.0.0.1:5001",
      fetchImpl: (async () => wavOf(44)) as unknown as typeof fetch, // a bare WAV header
    });
    await expect(tts.synthesize("سلام")).rejects.toThrow(/not speech/);
  });

  it("an upstream refusal names its status", async () => {
    const tts = createTts({
      url: "http://127.0.0.1:5001",
      fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(tts.synthesize("سلام")).rejects.toThrow(/500/);
  });
});

describe("the voice registry (0128)", () => {
  const wav = new Uint8Array(2048);

  it("routes each voice to ITS url, and reports availability per voice", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      asked.push(String(url));
      return new Response(wav, { status: 200 });
    }) as unknown as typeof fetch;
    const tts = createTts({
      urls: { fa_male: "http://127.0.0.1:5001", fa_female: "http://127.0.0.1:5002" },
      fetchImpl,
    });
    expect(tts.voices()).toMatchObject({
      fa_male: true, fa_female: true, en_female: false, en_male: false,
    });
    await tts.synthesize("سلام بر شما", "fa_female");
    expect(asked[0]).toContain("5002");
  });

  it("refuses an EXPLICIT voice it cannot speak — never a silent gender swap", async () => {
    /* M21: degrade what was inferred, fail on what was told. A person who
       chose the female English voice must not hear a male one with no
       word said — the route layer decides fallbacks, this layer refuses. */
    const tts = createTts({ urls: { fa_male: "http://127.0.0.1:5001" },
      fetchImpl: (async () => new Response(wav)) as unknown as typeof fetch });
    await expect(tts.synthesize("hello there, this is a test", "en_female"))
      .rejects.toThrow(/en_female/);
  });
});
