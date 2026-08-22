// zod at the boundary in both directions (M9). The request schema rejects
// malformed callers; the response schema is parsed before sending so the
// contract cannot drift silently under us — the tests assert against these
// same objects.

import { z } from "zod";

// ---------------------------------------------------------------- request

export const OptionsSchema = z
  .object({
    language_hints: z.array(z.string().min(2).max(8)).max(8).default(["fa", "en"]),
    diarize: z.enum(["auto", "off", "force"]).default("auto"),
    max_speakers: z.number().int().min(1).max(15).default(8),
    vad: z.boolean().default(true),
    lane: z.string().min(1).nullable().default(null),
  })
  .strict()
  // prefault, not default: every field has its own default, so an absent
  // `options` object means "all defaults", not "invalid".
  .prefault({});

export type Options = z.infer<typeof OptionsSchema>;

/** POST /embed — one voice vector from audio (voice enrollment, 2026-08-22).
 *  `ranges` (ms) picks one voice's speech out of a longer take; absent =
 *  the whole file. Same source rules as /process: url or path, never both. */
export const EmbedRequestSchema = z
  .object({
    audio_url: z.string().url().optional(),
    audio_path: z.string().min(1).optional(),
    ranges: z
      .array(z.object({ start_ms: z.number().int().min(0), end_ms: z.number().int().min(1) }))
      .max(200)
      .optional(),
    job_ref: z.string().max(200).optional(),
  })
  .refine((b) => Boolean(b.audio_url) !== Boolean(b.audio_path), {
    message: "provide exactly one of audio_url or audio_path",
  });

export const EmbedResponseSchema = z.object({
  embedding: z.array(z.number()).min(1),
  dim: z.number().int().min(1),
  model: z.string().min(1),
  /** how much audio actually fed the vector — a caller deciding whether to
      trust a match needs to know it came from 2s, not 60s */
  speech_ms: z.number().int().min(0),
});

export const ProcessRequestSchema = z
  .object({
    audio_url: z.string().url().optional(),
    audio_path: z.string().min(1).optional(),
    job_ref: z.string().min(1).max(200).optional(),
    options: OptionsSchema,
  })
  .strict()
  .refine((b) => Boolean(b.audio_url) !== Boolean(b.audio_path), {
    message: "provide exactly one of audio_url or audio_path",
  });

export type ProcessRequest = z.infer<typeof ProcessRequestSchema>;

// ---------------------------------------------------------------- response

export const WordSchema = z
  .object({
    text: z.string(),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1).nullable(),
    speaker: z.string().nullable(),
    channel: z.number().int().nonnegative().nullable(),
    language: z.string().nullable(),
  })
  .strict();

export const SpeakerSchema = z
  .object({
    label: z.string(),
    channel: z.number().int().nonnegative().nullable(),
    total_ms: z.number().int().nonnegative(),
    word_count: z.number().int().nonnegative(),
  })
  .strict();

export const SegmentSchema = z
  .object({
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
  })
  .strict();

export const ProvenanceSchema = z
  .object({
    ml_version: z.string(),
    transcode: z.object({ tool: z.literal("ffmpeg"), version: z.string() }).strict(),
    vad: z
      .object({ engine: z.string(), threshold: z.number() })
      .strict()
      .nullable(),
    stt: z
      .object({
        lane: z.string(),
        model: z.string(),
        timestamps: z.enum(["word", "segment", "none"]),
        attempts: z.array(
          z
            .object({
              lane: z.string(),
              ok: z.boolean(),
              ms: z.number().int().nonnegative(),
              error_type: z.string().nullable().default(null),
            })
            .strict(),
        ),
      })
      .strict(),
    diarization: z
      .object({
        source: z.enum(["channels", "clustering", "stt", "none"]),
        engine: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const ProcessResponseSchema = z
  .object({
    job_ref: z.string().nullable(),
    media: z
      .object({
        container: z.string(),
        codec: z.string(),
        duration_ms: z.number().int().nonnegative(),
        channels: z.number().int().positive(),
        sample_rate_in: z.number().int().positive(),
      })
      .strict(),
    speech: z
      .object({
        speech_ms: z.number().int().nonnegative(),
        silence_trimmed_ms: z.number().int().nonnegative(),
        segments: z.array(SegmentSchema),
      })
      .strict(),
    language: z
      .object({
        primary: z.string().nullable(),
        detected: z.array(z.object({ code: z.string(), share: z.number() }).strict()),
      })
      .strict(),
    words: z.array(WordSchema),
    speakers: z.array(SpeakerSchema),
    provenance: ProvenanceSchema,
    degraded: z.boolean(),
    warnings: z.array(z.string()),
  })
  .strict();

export type Word = z.infer<typeof WordSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ProcessResponse = z.infer<typeof ProcessResponseSchema>;

export const HealthSchema = z
  .object({
    ok: z.boolean(),
    version: z.string(),
    ffmpeg: z.boolean(),
    lanes: z.record(z.string(), z.enum(["configured", "unconfigured"])),
    diarizer: z.string(),
    /** The ENGINE, not a boolean — see the /health handler for why. */
    vad: z.string(),
    /** True when the energy fallback is running instead of Silero. */
    vad_degraded: z.boolean(),
    /** Can /embed answer here — the model is per-deployment (0081 lane). */
    embedder: z.boolean(),
  })
  .strict();

export type Health = z.infer<typeof HealthSchema>;
