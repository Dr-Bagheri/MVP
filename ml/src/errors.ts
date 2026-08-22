// The error taxonomy core/worker's DAG branches on (CONTRACT.md §4).
// Every failure carries a stable type and an explicit retryable flag, so the
// pipeline knows retry-with-backoff from dead-letter without parsing prose.

export type ErrorType =
  | "bad_request"
  | "audio_source_forbidden"
  | "download_failed"
  | "unsupported_media"
  | "media_too_long"
  | "transcode_failed"
  | "stt_unavailable"
  | "stt_failed"
  | "stt_no_word_timestamps"
  | "diarization_failed"
  | "embedding_unavailable"
  | "embedding_failed"
  | "internal";

const TABLE: Record<ErrorType, { http: number; retryable: boolean }> = {
  bad_request: { http: 400, retryable: false },
  audio_source_forbidden: { http: 403, retryable: false },
  download_failed: { http: 502, retryable: true },
  unsupported_media: { http: 415, retryable: false },
  media_too_long: { http: 413, retryable: false },
  transcode_failed: { http: 500, retryable: true },
  stt_unavailable: { http: 503, retryable: true },
  stt_failed: { http: 502, retryable: true },
  stt_no_word_timestamps: { http: 422, retryable: false },
  diarization_failed: { http: 500, retryable: true },
  // the embedding model is a deployment artifact — absence can end with the
  // next deploy, so a caller may retry; a compute failure is a real fault
  embedding_unavailable: { http: 503, retryable: true },
  embedding_failed: { http: 500, retryable: true },
  internal: { http: 500, retryable: true },
};

export class MlError extends Error {
  readonly type: ErrorType;
  readonly detail: Record<string, unknown> | undefined;

  constructor(type: ErrorType, message: string, opts?: { cause?: unknown; detail?: Record<string, unknown> }) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "MlError";
    this.type = type;
    this.detail = opts?.detail;
  }

  get http(): number {
    return TABLE[this.type].http;
  }

  get retryable(): boolean {
    return TABLE[this.type].retryable;
  }

  /** The wire body. Never includes content, paths, URLs, or key material. */
  body(jobRef?: string): Record<string, unknown> {
    return {
      error_type: this.type,
      message: this.message,
      retryable: this.retryable,
      job_ref: jobRef ?? null,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

/** Anything unclassified becomes `internal` — never leaks a stack to the caller. */
export function asMlError(e: unknown): MlError {
  if (e instanceof MlError) return e;
  return new MlError("internal", "unexpected failure", { cause: e });
}
