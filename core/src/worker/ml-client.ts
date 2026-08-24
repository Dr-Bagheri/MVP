/**
 * The client for ml/'s `/process` (ml/CONTRACT.md).
 *
 * ml/ is productless: it has no database, no identity, and no product
 * credentials. So the audio reaches it as a **pre-signed URL** that carries its
 * own authority — the worker never hands ml/ a product credential, and ml/
 * never needs one. The URL is a credential itself, which is why it never
 * reaches a log line here.
 *
 * The contract gives every failure a stable `error_type` and an explicit
 * `retryable`. The DAG branches on those two fields and never parses prose:
 * "the provider is down" and "this audio is not audio" want opposite
 * treatments, and a message string is the wrong place to learn which is which.
 */

/**
 * The closed string sets this worker CONSUMES from ml/ (ml/CONTRACT.md §2).
 *
 * Published as values, not just types, because a vocabulary that is not
 * published gets invented — and this boundary has no catalogue to disagree
 * with us the way `pg_enum` does. If ml/ renamed `"word"`, every part would
 * silently become degraded: seek disabled everywhere, `has_word_timestamps`
 * false, and nothing on either side rejecting anything. The failure is in the
 * safe direction and completely invisible, which is the worst combination.
 *
 * So an unrecognised value is treated conservatively AND said out loud
 * (`ml_vocabulary_drift`), and `test/e2e/pipeline-live.ts` asserts against a
 * real ml/ response, where the producer is the contract rather than a schema.
 */
export const ML_TIMESTAMP_GRANULARITIES = ["word", "segment", "none"] as const;
export const ML_DIARIZATION_SOURCES = ["channels", "clustering", "stt", "none"] as const;

export type MlTimestamps = (typeof ML_TIMESTAMP_GRANULARITIES)[number];

/** Values ml/ returned that this worker does not know about. Empty is the norm. */
export function unknownVocabulary(result: {
  provenance: { stt: { timestamps: string }; diarization: { source: string } };
}): string[] {
  const drift: string[] = [];
  if (!(ML_TIMESTAMP_GRANULARITIES as readonly string[]).includes(result.provenance.stt.timestamps)) {
    drift.push(`stt.timestamps=${result.provenance.stt.timestamps}`);
  }
  if (!(ML_DIARIZATION_SOURCES as readonly string[]).includes(result.provenance.diarization.source)) {
    drift.push(`diarization.source=${result.provenance.diarization.source}`);
  }
  return drift;
}

export interface MlProcessOptions {
  languageHints?: string[];
  diarize?: "auto" | "off" | "force";
  maxSpeakers?: number;
  vad?: boolean;
  lane?: string | null;
  /** Org glossary terms for recognition biasing (2026-08-23). Advisory. */
  context?: string[];
}

export interface MlProcessRequest {
  /** Pre-signed, self-authorizing. The production path. */
  audioUrl?: string;
  /** Local dev only (ml/ gates it behind ML_ALLOW_LOCAL_PATHS). */
  audioPath?: string;
  /** Opaque correlation string. Carries no authority; ml/ attaches no meaning. */
  jobRef?: string;
  options?: MlProcessOptions;
}

export interface MlProcessResult {
  job_ref: string | null;
  media: {
    container: string;
    codec: string;
    duration_ms: number;
    channels: number;
    sample_rate_in: number;
  };
  speech: {
    speech_ms: number;
    silence_trimmed_ms: number;
    segments: { start_ms: number; end_ms: number }[];
  };
  language: { primary: string | null; detected: { code: string; share: number }[] };
  words: {
    text: string;
    start_ms: number;
    end_ms: number;
    confidence: number | null;
    speaker: string | null;
    channel: number | null;
    language: string | null;
  }[];
  speakers: { label: string; channel: number | null; total_ms: number; word_count: number }[];
  provenance: {
    ml_version: string;
    transcode: { tool: string; version: string };
    vad: { engine: string; threshold: number } | null;
    stt: {
      lane: string;
      model: string;
      timestamps: MlTimestamps;
      attempts: { lane: string; ok: boolean; ms: number; error_type: string | null }[];
    };
    diarization: { source: "channels" | "clustering" | "stt" | "none"; engine: string | null };
  };
  degraded: boolean;
  warnings: string[];
}

/**
 * A failure from ml/, carrying the two fields the DAG actually decides on.
 * `retryable` comes from ml/ when it answered, and is assumed true when it
 * did not — an unreachable service is the definition of a transient fault.
 */
export class MlRequestError extends Error {
  // Fields are declared and assigned explicitly rather than as constructor
  // parameter properties: core/ runs under `node --experimental-strip-types`,
  // which removes type annotations without transforming anything, and a
  // parameter property is a TRANSFORM. Vitest transpiles fully, so a test
  // suite never notices — the process simply refuses to start.
  readonly errorType: string;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(errorType: string, message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "MlRequestError";
    this.errorType = errorType;
    this.retryable = retryable;
    this.status = status;
  }
}

export interface MlClientOptions {
  baseUrl: string;
  /** Generous by default: a 30-minute part legitimately takes minutes. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface MlClient {
  process(request: MlProcessRequest): Promise<MlProcessResult>;
  health(): Promise<{ ok: boolean; lanes: Record<string, string> }>;
  /** One voice vector (0081): whole file, or `ranges` (ms, file-relative)
   *  picking one voice's speech out of a longer take. Bytes mode carries an
   *  enrollment clip; url mode is the worker matching a call speaker. */
  embed(request: MlEmbedRequest): Promise<MlEmbedResult>;
}

export interface MlEmbedRequest {
  audioUrl?: string;
  audioBytes?: Buffer;
  contentType?: string;
  ranges?: { start_ms: number; end_ms: number }[];
  jobRef?: string;
}

export interface MlEmbedResult {
  embedding: number[];
  dim: number;
  /** the extractor's name — vectors compare only within one model's space */
  model: string;
  speech_ms: number;
}

export function createMlClient({
  baseUrl,
  timeoutMs = 20 * 60 * 1000,
  fetchImpl = fetch,
}: MlClientOptions): MlClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function post(request: MlProcessRequest): Promise<MlProcessResult> {
    const body = {
      ...(request.audioUrl ? { audio_url: request.audioUrl } : {}),
      ...(request.audioPath ? { audio_path: request.audioPath } : {}),
      ...(request.jobRef ? { job_ref: request.jobRef } : {}),
      options: {
        // Persian primary, incidental English inside the same call (M6).
        language_hints: request.options?.languageHints ?? ["fa", "en"],
        diarize: request.options?.diarize ?? "auto",
        max_speakers: request.options?.maxSpeakers ?? 8,
        vad: request.options?.vad ?? true,
        lane: request.options?.lane ?? null,
        ...(request.options?.context?.length ? { context: request.options.context } : {}),
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(`${root}/process`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      // Unreachable, DNS, connection reset, or our own timeout. All transient
      // by nature: the audio is fine, the service is not.
      const aborted = controller.signal.aborted;
      throw new MlRequestError(
        aborted ? "ml_timeout" : "ml_unreachable",
        aborted ? `ml/ did not answer within ${timeoutMs}ms` : "ml/ is unreachable",
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      let errorType = "ml_http_error";
      let retryable = response.status >= 500;
      let message = `ml/ returned HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { error_type?: string; retryable?: boolean; message?: string };
        // ml/ told us what happened and whether repeating helps. Believe it —
        // it knows things this side cannot, like whether a lane is exhausted
        // or the file simply is not audio.
        if (parsed.error_type) errorType = parsed.error_type;
        if (typeof parsed.retryable === "boolean") retryable = parsed.retryable;
        if (parsed.message) message = parsed.message;
      } catch {
        // A non-JSON body means a proxy or a crash, not ml/ speaking.
      }
      throw new MlRequestError(errorType, message, retryable, response.status);
    }

    try {
      return JSON.parse(text) as MlProcessResult;
    } catch (cause) {
      throw new MlRequestError("ml_bad_response", "ml/ returned a non-JSON success body", true, response.status);
    }
  }

  async function embed(request: MlEmbedRequest): Promise<MlEmbedResult> {
    const controller = new AbortController();
    // embedding a minute of audio is seconds of work — a tighter clock than
    // /process's, so a wedged extractor surfaces fast
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 120_000));
    let response: Response;
    try {
      if (request.audioBytes) {
        const form = new FormData();
        form.append(
          "audio",
          new Blob([new Uint8Array(request.audioBytes)], {
            type: request.contentType ?? "application/octet-stream",
          }),
          "clip.bin",
        );
        if (request.jobRef) form.append("job_ref", request.jobRef);
        response = await fetchImpl(`${root}/embed`, {
          method: "POST", body: form, signal: controller.signal,
        });
      } else {
        response = await fetchImpl(`${root}/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            audio_url: request.audioUrl,
            ...(request.ranges?.length ? { ranges: request.ranges } : {}),
            ...(request.jobRef ? { job_ref: request.jobRef } : {}),
          }),
          signal: controller.signal,
        });
      }
    } catch {
      const aborted = controller.signal.aborted;
      throw new MlRequestError(
        aborted ? "ml_timeout" : "ml_unreachable",
        aborted ? "ml/ did not answer the embed in time" : "ml/ is unreachable",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      let errorType = "ml_http_error";
      let retryable = response.status >= 500;
      let message = `ml/ returned HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { error_type?: string; retryable?: boolean; message?: string };
        if (parsed.error_type) errorType = parsed.error_type;
        if (typeof parsed.retryable === "boolean") retryable = parsed.retryable;
        if (parsed.message) message = parsed.message;
      } catch { /* a proxy or a crash, not ml/ speaking */ }
      throw new MlRequestError(errorType, message, retryable, response.status);
    }
    try {
      return JSON.parse(text) as MlEmbedResult;
    } catch {
      throw new MlRequestError("ml_bad_response", "ml/ returned a non-JSON embed body", true, response.status);
    }
  }

  return {
    process: post,
    embed,

    async health() {
      const response = await fetchImpl(`${root}/health`);
      if (!response.ok) throw new MlRequestError("ml_unhealthy", `health returned ${response.status}`, true);
      return (await response.json()) as { ok: boolean; lanes: Record<string, string> };
    },
  };
}
