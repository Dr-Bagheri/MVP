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

export type MlTimestamps = "word" | "segment" | "none";

export interface MlProcessOptions {
  languageHints?: string[];
  diarize?: "auto" | "off" | "force";
  maxSpeakers?: number;
  vad?: boolean;
  lane?: string | null;
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
  constructor(
    readonly errorType: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MlRequestError";
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

  return {
    process: post,

    async health() {
      const response = await fetchImpl(`${root}/health`);
      if (!response.ok) throw new MlRequestError("ml_unhealthy", `health returned ${response.status}`, true);
      return (await response.json()) as { ok: boolean; lanes: Record<string, string> };
    },
  };
}
