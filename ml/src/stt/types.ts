// One internal interface, every transcription provider behind it (M6). A
// self-hosted model arrives later as one more implementation and nothing above
// this line changes.

export interface SttWord {
  text: string;
  start_ms: number;
  end_ms: number;
  confidence: number | null;
  /** Provider-assigned speaker, when the lane diarizes. Normalized to S1, S2, … */
  speaker: string | null;
  language: string | null;
}

export type TimestampGranularity = "word" | "segment" | "none";

export interface SttResult {
  words: SttWord[];
  /** What the lane actually delivered — the contract's honesty valve (§3). */
  timestamps: TimestampGranularity;
  model: string;
  /** Dominant language the provider identified, when it identifies one. */
  language: string | null;
  /** True when the speaker labels came from the provider itself. */
  diarized: boolean;
}

/**
 * RECOGNITION CONTEXT (2026-09-06, user directive: "feed speaker names and
 * your project glossary as recognition context, which sharpens names and
 * jargon"). Structured, because the provider's own context IS structured
 * and a flat comma-joined string threw away the distinction it draws:
 *
 *  · `terms`   — names and jargon to recognise verbatim: the org's glossary,
 *                the people in the directory, the members, the projects;
 *  · `text`    — a sentence about THIS recording (its title), which biases
 *                the model's expectation of the topic without naming terms;
 *  · `general` — key/value facts (the organisation, the domain).
 *
 * Advisory in every lane: a lane that cannot use it ignores it, and it never
 * gates a transcription. The producer (core/worker) caps the sizes; the lane
 * caps them again before the provider does, because a context the provider
 * refuses is a transcription that never runs.
 */
export interface SttContext {
  terms: string[];
  text?: string;
  general?: { key: string; value: string }[];
}

export interface SttInput {
  /** A mono 16 kHz PCM WAV in the job workspace. */
  file: string;
  languageHints: string[];
  diarize: boolean;
  /** Duration of `file`, for lanes that must synthesize a span — and the
   *  number every lane's ceiling is judged against. */
  durationMs: number;
  context?: SttContext;
}

export interface SttLane {
  readonly name: string;
  /** Does this lane have its key? Never reveals the key or its validity. */
  configured(): boolean;
  /**
   * The longest recording this lane will carry, in milliseconds (2026-09-06,
   * the long-file lane). Over it the lane refuses with `media_too_long` and
   * the ladder tries the next lane — so the ceiling is a property of the
   * lane that has it, not one number every lane is held to. Soniox's async
   * model carries five hours; the fallback ASR carries a 30-minute part
   * plus slack.
   */
  maxDurationMs(): number;
  transcribe(input: SttInput): Promise<SttResult>;
}
