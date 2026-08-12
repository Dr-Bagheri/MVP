// OpenRouter ASR — the fallback lane. It exists so a Soniox outage degrades
// the product instead of stopping it.
//
// Two quirks are load-bearing and were paid for once already in Echo Mobile
// (backend/worker/echo_worker/providers.py, verified live 2026-08-09):
//
//   1. NO `language` field. The provider 400s on language=fa; auto-detection
//      transcribes Persian correctly.
//   2. `response_format: "json"` only — this ASR model rejects verbose_json,
//      so there are no segment timings either, let alone word timings.
//
// Consequence: this lane cannot satisfy M6's word-timestamp requirement. It
// reports timestamps:"none" and the pipeline decides what that means
// (CONTRACT.md §3) — the lane never pretends.

import { openAsBlob } from "node:fs";
import { config } from "../config.js";
import { MlError } from "../errors.js";
import type { SttInput, SttLane, SttResult, SttWord } from "./types.js";

const BASE = "https://openrouter.ai/api/v1";
const MODEL = "qwen/qwen3-asr-flash-2026-02-10";

export class OpenRouterLane implements SttLane {
  readonly name = "openrouter";

  configured(): boolean {
    return Boolean(config().OPENROUTER_API_KEY);
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    const key = config().OPENROUTER_API_KEY;
    if (!key) throw new MlError("stt_unavailable", "openrouter lane has no key");

    const form = new FormData();
    form.append("file", await openAsBlob(input.file), "audio.wav");
    form.append("model", MODEL);
    form.append("response_format", "json"); // NOT verbose_json — unsupported here

    const res = await fetch(`${BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });

    const text = await res.text();
    if (!res.ok) throw new MlError("stt_failed", `openrouter asr returned HTTP ${res.status}`);

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new MlError("stt_failed", "openrouter asr returned a non-JSON body", { cause: e });
    }
    if (data?.error) throw new MlError("stt_failed", "openrouter asr returned an error body");

    const transcript = String(data?.text ?? "").trim();
    return {
      words: splitWords(transcript, input.durationMs),
      timestamps: "none",
      model: MODEL,
      language: null,
      diarized: false,
    };
  }
}

/**
 * Plain text → words. Every word carries the span of the audio it came from,
 * NOT an invented per-word time: proportional estimates were a visible quality
 * gap in Echo Mobile, and inventing timings here would put fiction into the
 * record. `timestamps:"none"` is what tells the caller these are not seekable.
 */
export function splitWords(transcript: string, durationMs: number): SttWord[] {
  if (!transcript) return [];
  return transcript
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({
      text: w,
      start_ms: 0,
      end_ms: Math.max(0, Math.round(durationMs)),
      confidence: null,
      speaker: null,
      language: null,
    }));
}
