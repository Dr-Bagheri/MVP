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

  ML_REQUIRE_WORD_TIMESTAMPS: bool(true),
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
