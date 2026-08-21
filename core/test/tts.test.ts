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
