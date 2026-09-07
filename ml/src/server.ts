// The whole HTTP surface: POST /process, POST /embed and GET /health
// (CONTRACT.md §1). Nothing else is exposed, because nothing else is
// anyone's business.

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
import { embedSamples, embedderAvailable, sliceRanges } from "./embed/extractor.js";
import { toMono16k } from "./audio/ffmpeg.js";
import { readWav, wavDuration } from "./audio/wav.js";
import { ML_VERSION, runJob } from "./pipeline.js";
import { EmbedRequestSchema, EmbedResponseSchema, HealthSchema, OptionsSchema, ProcessRequestSchema, ProcessResponseSchema, TranslateRequestSchema, TranslateResponseSchema } from "./schema.js";
import { laneStatus } from "./stt/registry.js";
import { translationAvailable, translator } from "./stt/soniox-translate.js";
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
      // resolves the SPECIFIC callable /embed depends on (rule 7): the model
      // file AND the binding class, not "the module imported"
      embedder: await embedderAvailable(),
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

  /**
   * POST /translate — the transcript's TRANSLATION, from the audio, through
   * the transcriber (2026-09-06, C4; user directive: "run translate_record
   * through Soniox instead of a language model"). JSON only: audio_url or
   * audio_path, a target language tag, the language hints. One provider
   * job does the transcription and the one-way translation together and
   * answers UNITS — an original run with its span and its translation — on
   * the file's own timeline; placing them on the product's lines is core's
   * (it holds the lines and the part offsets). Nothing persists here.
   */
  app.post("/translate", async (req, reply) => {
    const ws = await makeWorkspace();
    let jobRef: string | undefined;
    try {
      const body = TranslateRequestSchema.parse(req.body);
      jobRef = body.job_ref;
      if (!translationAvailable()) {
        throw new MlError("stt_unavailable", "no translation lane is configured");
      }
      const input = path.join(ws.dir, "input.bin");
      if (body.audio_url) {
        const bytes = await fetchToFile(body.audio_url, input);
        jobLogger(jobRef).info({ step: "fetch", host: hostOnly(body.audio_url), bytes }, "audio downloaded");
      } else {
        await assertLocalPathAllowed(body.audio_path!);
        const { createReadStream } = await import("node:fs");
        await streamPipeline(createReadStream(body.audio_path!), createWriteStream(input));
      }
      const log = jobLogger(jobRef);
      const wav = path.join(ws.dir, "mono16k.wav");
      await toMono16k(input, wav);
      const durationMs = await wavDuration(wav);
      if (durationMs > cfg.ML_SONIOX_MAX_DURATION_MS) {
        throw new MlError("media_too_long", "audio exceeds the translation lane's ceiling");
      }
      const started = Date.now();
      const outcome = await translator()({
        file: wav, durationMs, targetLanguage: body.target_language, languageHints: body.language_hints,
      });
      log.info({ ms: Date.now() - started, units: outcome.units.length, target: body.target_language }, "translation done");
      return TranslateResponseSchema.parse({
        job_ref: jobRef ?? null,
        model: outcome.model,
        media: { duration_ms: durationMs },
        units: outcome.units,
      });
    } catch (e) {
      const err = toMlError(e);
      jobLogger(jobRef).warn({ error_type: err.type, retryable: err.retryable }, "translation failed");
      return reply.code(err.http).send(err.body(jobRef));
    } finally {
      await ws.cleanup();
    }
  });

  /**
   * POST /embed — one voice vector (voice enrollment, 2026-08-22).
   *
   * Multipart (one `audio` file — the enrollment clip) or JSON with
   * audio_url/audio_path + optional ms `ranges` picking one voice's speech
   * out of a longer take (how a call speaker gets its signature). The
   * vector means nothing to this service; what it names is core/'s
   * business. Health reports the capability so a deployment without the
   * model degrades ONE endpoint, said out loud, never startup.
   */
  app.post("/embed", async (req, reply) => {
    const ws = await makeWorkspace();
    let jobRef: string | undefined;
    try {
      const input = path.join(ws.dir, "input.bin");
      let ranges: { start_ms: number; end_ms: number }[] = [];
      if (req.isMultipart()) {
        const parsed = await consumeMultipart(req, input);
        jobRef = parsed.jobRef;
      } else {
        const body = EmbedRequestSchema.parse(req.body);
        jobRef = body.job_ref;
        ranges = body.ranges ?? [];
        if (body.audio_url) {
          const bytes = await fetchToFile(body.audio_url, input);
          jobLogger(jobRef).info(
            { step: "fetch", host: hostOnly(body.audio_url), bytes },
            "audio downloaded",
          );
        } else {
          await assertLocalPathAllowed(body.audio_path!);
          const { createReadStream } = await import("node:fs");
          await streamPipeline(createReadStream(body.audio_path!), createWriteStream(input));
        }
      }
      const log = jobLogger(jobRef);
      const wav = path.join(ws.dir, "mono16k.wav");
      await toMono16k(input, wav);
      const pcm = await readWav(wav);
      const sliced = sliceRanges(pcm.samples, pcm.sampleRate, ranges);
      const clipMs = Math.round((sliced.length / pcm.sampleRate) * 1000);
      if (clipMs < 1500) {
        // a vector from under ~1.5s of audio matches everyone a little and
        // nobody well — refusing beats storing a signature that lies
        throw new MlError("bad_request", `too little audio for a voice signature (${clipMs}ms < 1500ms)`);
      }

      /*
       * IS THERE A VOICE IN IT? (user report, 2026-09-07: "the enrolment
       * voice detection part of the platform does not work — i did 2 samples
       * and never it realise i am talking to it".)
       *
       * `speech_ms` used to be `sliced.length / sampleRate` — the clip's
       * DURATION wearing the name of a measurement, so it could not be less
       * than the clip and the floor above was a duration floor twice over.
       * Ten seconds of digital silence answered `speech_ms: 10000` and a
       * vector, and that vector is within a couple of percent of the one a
       * pure tone gives (measured on production, 2026-09-07): the extractor
       * returns essentially ONE null print for anything with no voice in it.
       * So a person whose microphone was muted, or whose browser picked a
       * different input, enrolled a signature that means "silence", was told
       * it was saved, and was never matched again — with nothing anywhere
       * saying why. Exactly the `vad: true` constant of 2026-08-13, in the
       * one number that could have refused the clip.
       *
       * The VAD is already here and the pipeline already trusts it. A clip
       * that carries less than a second and a half of SPEECH is refused by
       * name, because a print made from silence is worse than no print: no
       * print is a state the product can show, and a null print is a promise
       * that quietly never comes true.
       */
      const vad = await vadEngine();
      const speech = await vad.detect({
        samples: sliced,
        sampleRate: pcm.sampleRate,
        channels: 1,
        durationMs: clipMs,
      });
      const speechMs = speech.reduce((sum, s) => sum + (s.end_ms - s.start_ms), 0);
      if (speechMs < 1500) {
        throw new MlError(
          "no_speech",
          `no voice in the clip (${speechMs}ms of speech in ${clipMs}ms of audio)`,
        );
      }
      // cap what feeds the model — a signature saturates long before this
      const MAX_EMBED_S = 120;
      /* the SPEECH feeds the model, not the pauses around it: a signature
         taken over a clip that is half silence is a signature diluted by
         half — and `sliceRanges` is exactly the tool for it, which is what
         it was written for on the ranges path */
      const voiced = sliceRanges(sliced, pcm.sampleRate, speech);
      const capped = voiced.length > pcm.sampleRate * MAX_EMBED_S
        ? voiced.subarray(0, pcm.sampleRate * MAX_EMBED_S)
        : voiced;
      const started = Date.now();
      const embedding = await embedSamples(capped, pcm.sampleRate);
      log.info({ ms: Date.now() - started, dim: embedding.dim, speech_ms: speechMs }, "embedding done");
      return EmbedResponseSchema.parse({
        embedding: embedding.vector,
        dim: embedding.dim,
        model: embedding.model,
        speech_ms: speechMs,
      });
    } catch (e) {
      const err = toMlError(e);
      jobLogger(jobRef).warn({ error_type: err.type, retryable: err.retryable }, "embed failed");
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
