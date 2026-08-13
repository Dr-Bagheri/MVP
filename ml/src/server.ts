// The whole HTTP surface: POST /process and GET /health (CONTRACT.md §1).
// Nothing else is exposed, because nothing else is anyone's business.

import { createWriteStream } from "node:fs";
import { pipeline as streamPipeline } from "node:stream/promises";
import path from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { MlError, asMlError } from "./errors.js";
import { hostOnly, jobLogger, logger } from "./log.js";
import { ffmpegAvailable, ffmpegVersionString } from "./audio/ffmpeg.js";
import { assertLocalPathAllowed, fetchToFile, makeWorkspace } from "./audio/source.js";
import { diarizerName } from "./diarize/index.js";
import { ML_VERSION, runJob } from "./pipeline.js";
import { HealthSchema, OptionsSchema, ProcessRequestSchema, ProcessResponseSchema } from "./schema.js";
import { laneStatus } from "./stt/registry.js";
import { vadEngine } from "./vad/index.js";

export async function buildServer() {
  const cfg = config();
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 2 << 20, // JSON bodies are tiny; audio arrives as multipart or a URL
    requestTimeout: 0, // a 30-minute part legitimately takes minutes
  });

  await app.register(multipart, {
    limits: { fileSize: cfg.ML_MAX_BYTES, files: 1 },
  });

  app.get("/health", async () => {
    const ffmpeg = await ffmpegAvailable();

    // NAME the engine; never answer a boolean.
    //
    // `vad: true` used to mean "vadEngine() resolved", and vadEngine() always
    // resolves — the energy gate is an unconditional fallback, so the field
    // could not be false under any deployment. A box with no Silero model
    // reported a perfectly healthy VAD while every job silently ran the
    // degraded gate, and the one warning that said so scrolled past at
    // startup. A check that can only pass is not a check (rule 7: a health
    // check must resolve the specific callable it guards).
    let vad: string;
    try {
      vad = (await vadEngine()).name;
    } catch (error) {
      vad = "unavailable";
      logger.warn({ err: (error as Error).message }, "vad engine failed to load");
    }

    return HealthSchema.parse({
      ok: ffmpeg,
      version: ML_VERSION,
      ffmpeg,
      lanes: laneStatus(),
      diarizer: await diarizerName(),
      vad,
      // The fallback is a legitimate configuration, not a failure — so this is
      // reported rather than refused (M21: what is forfeited is said out loud).
      vad_degraded: vad === "energy-rms",
    });
  });

  app.post("/process", async (req, reply) => {
    const ws = await makeWorkspace();
    let jobRef: string | undefined;

    try {
      const isMultipart = req.isMultipart();
      const input = path.join(ws.dir, "input.bin");
      let options;

      if (isMultipart) {
        const parsed = await consumeMultipart(req, input);
        jobRef = parsed.jobRef;
        options = parsed.options;
      } else {
        const body = ProcessRequestSchema.parse(req.body);
        jobRef = body.job_ref;
        options = body.options;

        if (body.audio_url) {
          const bytes = await fetchToFile(body.audio_url, input);
          jobLogger(jobRef).info(
            { step: "fetch", host: hostOnly(body.audio_url), bytes },
            "audio downloaded",
          );
        } else {
          await assertLocalPathAllowed(body.audio_path!);
          // Read through the same door as every other source so the rest of the
          // pipeline never learns where the audio came from.
          const { createReadStream } = await import("node:fs");
          await streamPipeline(createReadStream(body.audio_path!), createWriteStream(input));
        }
      }

      const log = jobLogger(jobRef);
      const started = Date.now();
      const result = await runJob({ input, workDir: ws.dir, jobRef, options, log });
      log.info({ ms: Date.now() - started, word_count: result.words.length, degraded: result.degraded }, "job done");

      // Parse on the way out: the contract cannot drift under us unnoticed.
      return ProcessResponseSchema.parse(result);
    } catch (e) {
      const err = toMlError(e);
      jobLogger(jobRef).warn({ error_type: err.type, retryable: err.retryable }, "job failed");
      return reply.code(err.http).send(err.body(jobRef));
    } finally {
      await ws.cleanup();
    }
  });

  return app;
}

/** zod's own failures are the caller's fault, not ours — say so precisely. */
function toMlError(e: unknown): MlError {
  if (e instanceof MlError) return e;
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: Array<{ path: unknown[]; message: string }> }).issues ?? [];
    const where = issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return new MlError("bad_request", `invalid request: ${where}`);
  }
  const err = asMlError(e);
  if (err.type === "internal") logger.error({ err: (e as Error)?.message }, "unhandled failure");
  return err;
}

interface Multipart {
  jobRef: string | undefined;
  options: ReturnType<typeof OptionsSchema.parse>;
}

/**
 * multipart/form-data: one `audio` file plus an optional `options` JSON string
 * and `job_ref`. The file streams straight to disk — a 500 MB upload is never
 * held in memory.
 */
async function consumeMultipart(req: any, dest: string): Promise<Multipart> {
  let jobRef: string | undefined;
  let rawOptions: unknown;
  let sawFile = false;

  for await (const part of req.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "audio") {
        part.file.resume();
        continue;
      }
      sawFile = true;
      await streamPipeline(part.file, createWriteStream(dest));
      if (part.file.truncated) throw new MlError("media_too_long", "audio exceeds ML_MAX_BYTES");
    } else if (part.fieldname === "job_ref") {
      jobRef = String(part.value).slice(0, 200);
    } else if (part.fieldname === "options") {
      try {
        rawOptions = JSON.parse(String(part.value));
      } catch (e) {
        throw new MlError("bad_request", "options field is not valid JSON", { cause: e });
      }
    }
  }

  if (!sawFile) throw new MlError("bad_request", "multipart request has no 'audio' file part");
  return { jobRef, options: OptionsSchema.parse(rawOptions ?? undefined) };
}
