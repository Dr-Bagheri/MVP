// Structured logging with NO CONTENT, ever (Invariant 7, CONTRACT.md §6).
//
// A job may log: job_ref, step, durations, byte counts, channel counts, lane
// names, outcomes, error types. It may NOT log a transcript word, a caller's
// filename, an audio path, or a URL — signed URLs are credentials, and paths
// are the caller's business.

import pino from "pino";

/** Redaction is a backstop, not the strategy: we don't pass these in at all. */
const REDACT = [
  "audio_url",
  "audio_path",
  "url",
  "path",
  "text",
  "words",
  "tokens",
  "transcript",
  "authorization",
  "headers.authorization",
  "api_key",
  "key",
  "*.audio_url",
  "*.audio_path",
  "*.text",
];

// Read straight from the environment rather than through config(): the logger
// is built at import time, and memoizing the config that early would freeze it
// before a test could vary it.
export const logger = pino({
  level: process.env.ML_LOG_LEVEL || "info",
  redact: { paths: REDACT, censor: "[redacted]" },
  base: { svc: "ml" },
});

export type JobLog = ReturnType<typeof jobLogger>;

export function jobLogger(jobRef: string | undefined) {
  return logger.child({ job_ref: jobRef ?? null });
}

/**
 * A URL is a credential when it is pre-signed. When we must say *something*
 * about one, say only its host — never the path or query.
 */
export function hostOnly(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
}
