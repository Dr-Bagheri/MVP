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

export interface SttInput {
  /** A mono 16 kHz PCM WAV in the job workspace. */
  file: string;
  languageHints: string[];
  diarize: boolean;
  /** Duration of `file`, for lanes that must synthesize a span. */
  durationMs: number;
}

export interface SttLane {
  readonly name: string;
  /** Does this lane have its key? Never reveals the key or its validity. */
  configured(): boolean;
  transcribe(input: SttInput): Promise<SttResult>;
}
