// Soniox async lane — the primary (M6): word-level timestamps, Persian, and
// speaker diarization with full-file context.
//
// Flow: POST /v1/files → POST /v1/transcriptions → poll → GET …/transcript,
// then DELETE both — all through SonioxApi, which the translator shares.

import { config } from "../config.js";
import { MlError } from "../errors.js";
import { SonioxApi, pollDeadlineMs, sonioxContext, type SonioxToken } from "./soniox-api.js";
import type { SttInput, SttLane, SttResult, SttWord } from "./types.js";

const MODEL = "stt-async-v5";

export class SonioxLane implements SttLane {
  readonly name = "soniox";

  configured(): boolean {
    return Boolean(config().SONIOX_API_KEY);
  }

  /**
   * Five hours by default (ML_SONIOX_MAX_DURATION_MS) — the async model's own
   * documented ceiling. The pipeline's old single cap sat at 35 minutes for
   * every lane, which turned a 40-minute recorded part into `media_too_long`
   * on a provider that would have carried it (2026-09-06, C3).
   */
  maxDurationMs(): number {
    return config().ML_SONIOX_MAX_DURATION_MS;
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    const cfg = config();
    const key = cfg.SONIOX_API_KEY;
    if (!key) throw new MlError("stt_unavailable", "soniox lane has no key");
    if (input.durationMs > this.maxDurationMs()) {
      throw new MlError("media_too_long", "audio exceeds the soniox lane's ceiling");
    }

    const api = new SonioxApi(key);
    let fileId: string | undefined;
    let transcriptionId: string | undefined;
    try {
      fileId = await api.uploadFile(input.file);
      transcriptionId = await api.createTranscription(createBody(fileId, input));
      await api.waitUntilDone(transcriptionId, {
        deadlineMs: pollDeadlineMs(input.durationMs, cfg.ML_STT_TIMEOUT_MS),
        baseIntervalMs: cfg.ML_STT_POLL_MS,
      });
      const tokens = await api.transcript(transcriptionId);
      return toResult(tokens, input.diarize);
    } finally {
      if (transcriptionId) await api.delete(`/transcriptions/${transcriptionId}`);
      if (fileId) await api.delete(`/files/${fileId}`);
    }
  }
}

/**
 * The transcription request — exported so the test asserts the BODY the
 * provider receives rather than a paraphrase of it (rule 10). Language
 * identification is always on: a mixed Persian/English recording comes back
 * with every token's own language, which is what lets the product set each
 * line's direction (C2).
 */
export function createBody(fileId: string, input: SttInput): Record<string, unknown> {
  const context = sonioxContext(input.context);
  return {
    file_id: fileId,
    model: MODEL,
    language_hints: input.languageHints,
    enable_language_identification: true,
    enable_speaker_diarization: input.diarize,
    ...(context ? { context } : {}),
  };
}

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
