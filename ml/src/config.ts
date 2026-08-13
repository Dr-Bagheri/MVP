// Configuration is env-only (CONTRACT.md §5, M10). ml/ reads these and
// nothing else: no database URL, no Supabase key, no product JWT. If one of
// those appears in this process's environment, the caller has a bug.

import { z } from "zod";
import os from "node:os";

const bool = (dflt: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : v === "1" || v.toLowerCase() === "true"));

const int = (dflt: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : Number(v)))
    .pipe(z.number().int().positive());

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const Schema = z.object({
  ML_PORT: int(7801),
  ML_HOST: z.string().optional().transform((v) => v || "127.0.0.1"),

  // Upstream keys — ml/'s own, the only credentials it may ever hold.
  SONIOX_API_KEY: z.string().optional().transform((v) => v || undefined),
  OPENROUTER_API_KEY: z.string().optional().transform((v) => v || undefined),

  ML_LANE_ORDER: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v : "soniox,openrouter"))
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  // Steward ruling (M6, locked): degrade-and-flag, never fail. A call is never
  // lost because the only available lane cannot carry timings — the result
  // comes back with timestamps:"none" in provenance and the product degrades
  // visibly (UI disables seek, the part queues for re-transcription). Silent
  // degradation stays forbidden; that is what the provenance block is for.
  ML_REQUIRE_WORD_TIMESTAMPS: bool(false),
  ML_ALLOW_LOCAL_PATHS: bool(false),
  ML_URL_ALLOWLIST: csv,

  ML_MAX_DURATION_MS: int(35 * 60 * 1000),
  ML_MAX_BYTES: int(500 * 1024 * 1024),
  ML_WORK_DIR: z.string().optional().transform((v) => v || os.tmpdir()),

  // Tool + model locations. ffmpeg is resolved from these or from PATH;
  // containers (M12.2/3) install it, dev machines already have it.
  ML_FFMPEG_PATH: z.string().optional().transform((v) => v || undefined),
  ML_FFPROBE_PATH: z.string().optional().transform((v) => v || undefined),
  ML_SILERO_MODEL: z.string().optional().transform((v) => v || undefined),
  ML_DIARIZER: z
    .string()
    .optional()
    .transform((v) => (v || "auto") as "auto" | "sherpa" | "off"),
  ML_SEGMENTATION_MODEL: z.string().optional().transform((v) => v || undefined),
  ML_EMBEDDING_MODEL: z.string().optional().transform((v) => v || undefined),

  // Measured in the Phase-0 spike, not guessed: 4 threads beat 8 (0.332 vs
  // 0.453 RTF — oversubscription), so this is NOT auto-set from core count.
  // Re-measure on the deployment box; the same file swung 6x under CPU
  // contention, so these numbers size nothing on their own.
  ML_DIARIZER_THREADS: int(4),
  // M6 requires the clustering threshold to be tunable.
  //
  // Was 0.5 — what the Phase-0 spike validated on clean synthetic TTS: two
  // maximally distinct voices, strict alternation, no overlap. On the first
  // REAL conversational recording it produced **22 clusters for a 4-person
  // conversation**, which is where the "sherpa over-splits" caveat came from.
  //
  // Measured (test/smoke/diarizer-threshold.ts, both real Persian clips):
  //
  //   threshold   4-speaker clip   1-speaker clip
  //   0.50               22               1
  //   0.90                9               1
  //   1.00                5               1
  //   1.05                4               1
  //   1.15                2               1
  //
  // The single-speaker column is the control: raising this merges nothing and
  // invents nothing on one-voice audio, so the old value bought no safety
  // there and cost a factor of five on the other side.
  //
  // 1.0 rather than the 1.05 that fits our sample exactly — deliberately not
  // the best-fitting value on n=2 recordings, and on the safer side of the
  // error: splitting one person into two mislabels, while merging two people
  // attributes one person's words to another. Over-split is recoverable by a
  // human at the speaker-linking step; misattribution reads as fact.
  ML_DIARIZER_THRESHOLD: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? 1.0 : Number(v)))
    .pipe(z.number().positive()),

  ML_LOG_LEVEL: z.string().optional().transform((v) => v || "info"),

  // Upstream timeouts. Long audio on batch endpoints; be generous.
  ML_STT_TIMEOUT_MS: int(15 * 60 * 1000),
  ML_STT_POLL_MS: int(3000),
});

export type Config = z.infer<typeof Schema>;

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    // Print the failing VARIABLE NAMES only — never a value, since values here
    // are keys.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`ml/: invalid configuration for: ${names}`);
  }
  return parsed.data;
}

export function config(): Config {
  cached ??= loadConfig();
  return cached;
}

/** Test seam: drop the memoized config so a test can vary the environment. */
export function resetConfig(): void {
  cached = undefined;
}
