// Soniox async lane — the primary (M6): word-level timestamps, Persian, and
// speaker diarization with full-file context.
//
// Flow: POST /v1/files → POST /v1/transcriptions → poll → GET …/transcript,
// then DELETE both. The delete is not politeness: audio and transcript are the
// customer's record, and ml/ leaves no copy anywhere it does not control.

import { openAsBlob } from "node:fs";
import { config } from "../config.js";
import { MlError } from "../errors.js";
import { logger } from "../log.js";
import type { SttInput, SttLane, SttResult, SttWord } from "./types.js";

const BASE = "https://api.soniox.com/v1";
const MODEL = "stt-async-v5";

interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
  speaker?: number | string;
  language?: string;
}

export class SonioxLane implements SttLane {
  readonly name = "soniox";

  configured(): boolean {
    return Boolean(config().SONIOX_API_KEY);
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    const key = config().SONIOX_API_KEY;
    if (!key) throw new MlError("stt_unavailable", "soniox lane has no key");

    let fileId: string | undefined;
    let transcriptionId: string | undefined;
    try {
      fileId = await this.upload(input.file, key);
      transcriptionId = await this.create(fileId, input, key);
      await this.poll(transcriptionId, key);
      const tokens = await this.transcript(transcriptionId, key);
      return toResult(tokens, input.diarize);
    } finally {
      // Best effort, and never allowed to mask a real failure.
      if (transcriptionId) await this.del(`/transcriptions/${transcriptionId}`, key);
      if (fileId) await this.del(`/files/${fileId}`, key);
    }
  }

  private headers(key: string): Record<string, string> {
    return { authorization: `Bearer ${key}` };
  }

  private async upload(file: string, key: string): Promise<string> {
    const form = new FormData();
    form.append("file", await openAsBlob(file), "audio.wav");

    const res = await fetch(`${BASE}/files`, { method: "POST", headers: this.headers(key), body: form });
    const body = await readJson(res, "soniox file upload");
    const id = body?.id;
    if (!id) throw new MlError("stt_failed", "soniox upload returned no file id");
    return String(id);
  }

  private async create(fileId: string, input: SttInput, key: string): Promise<string> {
    const res = await fetch(`${BASE}/transcriptions`, {
      method: "POST",
      headers: { ...this.headers(key), "content-type": "application/json" },
      body: JSON.stringify({
        file_id: fileId,
        model: MODEL,
        language_hints: input.languageHints,
        enable_language_identification: true,
        enable_speaker_diarization: input.diarize,
      }),
    });
    const body = await readJson(res, "soniox create transcription");
    const id = body?.id;
    if (!id) throw new MlError("stt_failed", "soniox create returned no transcription id");
    return String(id);
  }

  private async poll(id: string, key: string): Promise<void> {
    const cfg = config();
    const deadline = Date.now() + cfg.ML_STT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const res = await fetch(`${BASE}/transcriptions/${id}`, { headers: this.headers(key) });
      const body = await readJson(res, "soniox poll");
      const status = String(body?.status ?? "");

      if (status === "completed") return;
      if (status === "error") {
        throw new MlError("stt_failed", `soniox transcription failed: ${String(body?.error_message ?? "unknown")}`);
      }
      await sleep(cfg.ML_STT_POLL_MS);
    }
    throw new MlError("stt_failed", "soniox transcription timed out");
  }

  private async transcript(id: string, key: string): Promise<SonioxToken[]> {
    const res = await fetch(`${BASE}/transcriptions/${id}/transcript`, { headers: this.headers(key) });
    const body = await readJson(res, "soniox transcript");
    const tokens = body?.tokens;
    if (!Array.isArray(tokens)) throw new MlError("stt_failed", "soniox transcript had no tokens array");
    return tokens as SonioxToken[];
  }

  private async del(path: string, key: string): Promise<void> {
    try {
      await fetch(`${BASE}${path}`, { method: "DELETE", headers: this.headers(key) });
    } catch (e) {
      // Nothing the caller can do about it; do not fail a good transcript.
      logger.warn({ step: "soniox_cleanup", err: (e as Error).message }, "soniox cleanup failed");
    }
  }
}

async function readJson(res: Response, what: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    // The body may echo request content, so it never reaches the message.
    throw new MlError("stt_failed", `${what} returned HTTP ${res.status}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new MlError("stt_failed", `${what} returned a non-JSON body`, { cause: e });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Soniox emits tokens, which are words OR sub-words, with leading whitespace
 * marking a word boundary. We rebuild whole words: the transcript is the
 * product's record and "کتاب" must not arrive as "کت" + "اب".
 *
 * A word also breaks on a speaker change, because one word cannot belong to
 * two voices.
 */
export function toResult(tokens: readonly SonioxToken[], diarize: boolean): SttResult {
  const words: SttWord[] = [];
  const speakerMap = new Map<string, string>();
  const langCount = new Map<string, number>();

  const labelFor = (raw: number | string | undefined): string | null => {
    if (raw === undefined || raw === null || raw === "") return null;
    const k = String(raw);
    let label = speakerMap.get(k);
    if (!label) {
      // Number by first appearance, so labels are stable and 1-based.
      label = `S${speakerMap.size + 1}`;
      speakerMap.set(k, label);
    }
    return label;
  };

  let current: SttWord | null = null;
  // A whitespace-only token IS the word boundary — dropping it silently glued
  // "figures" and "right" into "figuresright" on the first live run. Remember
  // the boundary instead of discarding it.
  let boundary = true;

  for (const t of tokens) {
    const text = t.text ?? "";
    if (text === "") continue;

    const trimmed = text.trim();
    if (trimmed === "") {
      boundary = true;
      continue;
    }

    const speaker = diarize ? labelFor(t.speaker) : null;
    const startsWord =
      boundary || /^\s/.test(text) || current === null || (current.speaker ?? null) !== speaker;
    boundary = false;

    if (t.language) langCount.set(t.language, (langCount.get(t.language) ?? 0) + 1);

    if (startsWord) {
      current = {
        text: trimmed,
        start_ms: Math.round(t.start_ms ?? 0),
        end_ms: Math.round(t.end_ms ?? t.start_ms ?? 0),
        confidence: t.confidence ?? null,
        speaker,
        language: t.language ?? null,
      };
      words.push(current);
    } else if (current) {
      current.text += trimmed;
      current.end_ms = Math.round(t.end_ms ?? current.end_ms);
      if (t.confidence !== undefined && current.confidence !== null) {
        current.confidence = Math.min(current.confidence, t.confidence);
      }
    }
  }

  const language =
    [...langCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    words,
    timestamps: "word",
    model: MODEL,
    language,
    diarized: diarize && speakerMap.size > 0,
  };
}
