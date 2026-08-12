// The job: transcode → VAD → transcribe → diarize, and nothing else.
// Stateless from end to end — the workspace is deleted in a finally, and
// nothing about a job outlives the response (Invariant 6).

import path from "node:path";
import { config } from "./config.js";
import { MlError } from "./errors.js";
import type { JobLog } from "./log.js";
import { concatRegions, extractChannel, ffmpegVersionString, probe, toMono16k } from "./audio/ffmpeg.js";
import { readWav } from "./audio/wav.js";
import { assignSpeakers, diarizer } from "./diarize/index.js";
import type { Options, ProcessResponse, Segment, Speaker, Word } from "./schema.js";
import { transcribe } from "./stt/registry.js";
import type { Attempt, LaneOutcome } from "./stt/registry.js";
import type { SttWord } from "./stt/types.js";
import { TimelineMap } from "./timeline.js";
import { vadEngine } from "./vad/index.js";

export const ML_VERSION = "0.1.0";

export interface Job {
  /** The caller's audio, already on local disk. */
  input: string;
  workDir: string;
  jobRef: string | undefined;
  options: Options;
  log: JobLog;
}

export async function runJob(job: Job): Promise<ProcessResponse> {
  const cfg = config();
  const media = await probe(job.input);

  if (media.duration_ms !== null && media.duration_ms > cfg.ML_MAX_DURATION_MS) {
    throw new MlError("media_too_long", "audio exceeds ML_MAX_DURATION_MS");
  }

  // Two channels means two people on two microphones: take the speakers from
  // the channels and never diarize (M6). "force" overrides for the odd
  // recording where both voices are on both channels.
  const useChannels = media.channels >= 2 && job.options.diarize !== "force";

  const outcome = useChannels ? await perChannel(job, media.channels) : await singleStream(job);

  const { words, segments, speechMs, durationMs, lane, diarSource, diarEngine } = outcome;

  if (durationMs > cfg.ML_MAX_DURATION_MS) {
    throw new MlError("media_too_long", "audio exceeds ML_MAX_DURATION_MS");
  }

  const warnings: string[] = [];
  let degraded = false;

  if (lane.result.timestamps !== "word") {
    if (cfg.ML_REQUIRE_WORD_TIMESTAMPS) {
      // Refusing beats writing a transcript that silently cannot be seeked
      // (M6). Retrying the same lane would produce the same non-answer.
      throw new MlError(
        "stt_no_word_timestamps",
        `lane '${lane.lane}' produced ${lane.result.timestamps} timestamps; word timestamps are required`,
      );
    }
    degraded = true;
    warnings.push("stt_no_word_timestamps");
  }
  if (words.length === 0) warnings.push("no_speech_detected");

  const sorted = [...words].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);

  return {
    job_ref: job.jobRef ?? null,
    media: {
      container: media.container,
      codec: media.codec,
      duration_ms: durationMs,
      channels: media.channels,
      sample_rate_in: media.sample_rate_in,
    },
    speech: {
      speech_ms: speechMs,
      silence_trimmed_ms: Math.max(0, durationMs - speechMs),
      segments,
    },
    language: languageBreakdown(sorted, lane.result.language),
    words: sorted,
    speakers: tallySpeakers(sorted),
    provenance: {
      ml_version: ML_VERSION,
      transcode: { tool: "ffmpeg", version: await ffmpegVersionString() },
      vad: outcome.vad,
      stt: {
        lane: lane.lane,
        model: lane.result.model,
        timestamps: lane.result.timestamps,
        attempts: lane.attempts as Attempt[],
      },
      diarization: { source: diarSource, engine: diarEngine },
    },
    degraded,
    warnings,
  };
}

// ---------------------------------------------------------------- strategies

interface StreamOutcome {
  words: Word[];
  segments: Segment[];
  speechMs: number;
  durationMs: number;
  lane: LaneOutcome;
  vad: { engine: string; threshold: number } | null;
  diarSource: "channels" | "clustering" | "stt" | "none";
  diarEngine: string | null;
}

/** Mono (or forced-mix) audio: one transcription, then diarize if the lane didn't. */
async function singleStream(job: Job): Promise<StreamOutcome> {
  const full = path.join(job.workDir, "full.wav");
  await toMono16k(job.input, full);

  const pcm = await readWav(full);
  const durationMs = pcm.durationMs;

  const { map, segments, sttFile, vad } = await trimSilence(job, full, pcm.durationMs);

  const wantSpeakers = job.options.diarize !== "off";
  const lane = await transcribe(
    { file: sttFile, languageHints: job.options.language_hints, diarize: wantSpeakers, durationMs: map.speechMs },
    job.log,
    job.options.lane,
  );

  let words: SttWord[] = lane.result.words.map((w) => ({
    ...w,
    start_ms: map.toOriginal(w.start_ms),
    end_ms: map.toOriginal(w.end_ms),
  }));

  let diarSource: StreamOutcome["diarSource"] = "none";
  let diarEngine: string | null = null;

  if (!wantSpeakers) {
    // "off" is enforced here, not merely requested of the lane. A provider
    // that labels speakers anyway must not smuggle them into the record.
    words = words.map((w) => ({ ...w, speaker: null }));
  } else if (lane.result.diarized) {
    // The lane already separated the voices with full-file context.
    diarSource = "stt";
  } else {
    const engine = await diarizer();
    if (engine) {
      const segs = await engine.diarize(full, { maxSpeakers: job.options.max_speakers });
      words = assignSpeakers(words, segs);
      diarSource = "clustering";
      diarEngine = engine.name;
    } else {
      job.log.warn({ step: "diarize" }, "no diarizer available; words carry no speaker");
    }
  }

  return {
    words: words.map((w) => ({ ...w, channel: null })),
    segments,
    speechMs: map.speechMs,
    durationMs,
    lane,
    vad,
    diarSource,
    diarEngine,
  };
}

/**
 * Multi-channel audio: each channel is one speaker, transcribed on its own.
 * No diarization is involved at all — the microphones already did it.
 */
async function perChannel(job: Job, channels: number): Promise<StreamOutcome> {
  const words: Word[] = [];
  const segments: Segment[] = [];
  let speechMs = 0;
  let durationMs = 0;
  let lane: LaneOutcome | undefined;
  let vad: { engine: string; threshold: number } | null = null;

  for (let ch = 0; ch < channels; ch++) {
    const file = path.join(job.workDir, `ch${ch}.wav`);
    await extractChannel(job.input, file, ch);

    const pcm = await readWav(file);
    durationMs = Math.max(durationMs, pcm.durationMs);

    const trimmed = await trimSilence(job, file, pcm.durationMs);
    vad = trimmed.vad;
    segments.push(...trimmed.segments);
    speechMs += trimmed.map.speechMs;

    // Speakers come from the channels, so the lane is asked NOT to diarize.
    const outcome = await transcribe(
      {
        file: trimmed.sttFile,
        languageHints: job.options.language_hints,
        diarize: false,
        durationMs: trimmed.map.speechMs,
      },
      job.log,
      job.options.lane,
    );
    lane = mergeLaneOutcome(lane, outcome);

    const label = job.options.diarize === "off" ? null : `S${ch + 1}`;
    for (const w of outcome.result.words) {
      words.push({
        ...w,
        start_ms: trimmed.map.toOriginal(w.start_ms),
        end_ms: trimmed.map.toOriginal(w.end_ms),
        speaker: label,
        channel: ch,
      });
    }
  }

  if (!lane) throw new MlError("internal", "no channel produced a transcription");

  segments.sort((a, b) => a.start_ms - b.start_ms);

  return {
    words,
    segments,
    speechMs,
    durationMs,
    lane,
    vad,
    diarSource: job.options.diarize === "off" ? "none" : "channels",
    diarEngine: null,
  };
}

/** Per-channel runs are separate transcriptions; provenance keeps every attempt. */
function mergeLaneOutcome(prev: LaneOutcome | undefined, next: LaneOutcome): LaneOutcome {
  if (!prev) return next;
  return {
    lane: next.lane,
    result: { ...next.result, words: [] },
    attempts: [...prev.attempts, ...next.attempts],
  };
}

// ---------------------------------------------------------------- vad

interface Trimmed {
  map: TimelineMap;
  segments: Segment[];
  sttFile: string;
  vad: { engine: string; threshold: number } | null;
}

/**
 * Cut the silence out before the paid call. When VAD is off, or finds nothing
 * to cut, the original file goes to the STT and the map is the identity — we
 * never pay ffmpeg to rewrite a file for no gain.
 */
async function trimSilence(job: Job, file: string, durationMs: number): Promise<Trimmed> {
  if (!job.options.vad) {
    return {
      map: TimelineMap.identity(durationMs),
      segments: [{ start_ms: 0, end_ms: durationMs }],
      sttFile: file,
      vad: null,
    };
  }

  const engine = await vadEngine();
  const pcm = await readWav(file);
  const segments = await engine.detect(pcm);
  const vad = { engine: engine.name, threshold: engine.threshold };

  if (segments.length === 0) {
    // Silence all the way through: send the original rather than an empty file
    // and let the STT return nothing, which is the truthful answer.
    job.log.info({ step: "vad", segments: 0 }, "no speech detected");
    return { map: TimelineMap.identity(durationMs), segments: [], sttFile: file, vad };
  }

  const map = new TimelineMap(segments);
  const savedMs = durationMs - map.speechMs;
  job.log.info(
    { step: "vad", segments: segments.length, speech_ms: map.speechMs, trimmed_ms: savedMs },
    "vad done",
  );

  // Under a few seconds of savings the concat costs more than it saves.
  if (savedMs < 3000) {
    return { map: TimelineMap.identity(durationMs), segments, sttFile: file, vad };
  }

  const speechFile = path.join(job.workDir, `${path.basename(file, ".wav")}.speech.wav`);
  await concatRegions(file, speechFile, segments);
  return { map, segments, sttFile: speechFile, vad };
}

// ---------------------------------------------------------------- summaries

function tallySpeakers(words: readonly Word[]): Speaker[] {
  const acc = new Map<string, Speaker>();
  for (const w of words) {
    if (!w.speaker) continue;
    const cur = acc.get(w.speaker) ?? { label: w.speaker, channel: w.channel, total_ms: 0, word_count: 0 };
    cur.total_ms += Math.max(0, w.end_ms - w.start_ms);
    cur.word_count += 1;
    acc.set(w.speaker, cur);
  }
  return [...acc.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function languageBreakdown(words: readonly Word[], laneLanguage: string | null) {
  const counts = new Map<string, number>();
  for (const w of words) {
    if (w.language) counts.set(w.language, (counts.get(w.language) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const detected = [...counts.entries()]
    .map(([code, n]) => ({ code, share: total ? Number((n / total).toFixed(4)) : 0 }))
    .sort((a, b) => b.share - a.share);

  return { primary: detected[0]?.code ?? laneLanguage, detected };
}
