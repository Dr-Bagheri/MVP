// The job: transcode → VAD → transcribe → diarize, and nothing else.
// Stateless from end to end — the workspace is deleted in a finally, and
// nothing about a job outlives the response (Invariant 6).

import path from "node:path";
import { config } from "./config.js";
import { MlError } from "./errors.js";
import type { JobLog } from "./log.js";
import { channelsAreDistinct, concatRegions, extractChannel, ffmpegVersionString, probe, toMono16k } from "./audio/ffmpeg.js";
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

  // Two channels means two people on two microphones — but ONLY if the
  // channels actually differ. Dual-mono (one microphone duplicated into two
  // channels) is what phone voice memos and most re-encodes produce, and
  // treating it as per-speaker channels transcribes every word twice, invents
  // two speakers who are the same person, and doubles the STT bill. Measured
  // on a real two-voice Persian recording; nothing failed, the transcript was
  // just nonsense.
  const distinct = media.channels >= 2 ? await channelsAreDistinct(job.input) : false;
  if (media.channels >= 2 && !distinct) {
    job.log.info(
      { channels: media.channels },
      "channels are identical (dual-mono): downmixing and diarizing instead of splitting",
    );
  }
  const useChannels = distinct && job.options.diarize !== "force";

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

  // The VAD found nothing but the STT found words: the audio was fine and the
  // VAD is wrong. The job still succeeds — we fall back to sending the whole
  // file — but a silent fallback here means we pay for silence forever without
  // anyone noticing, so it is said out loud. (A misconfigured Silero model did
  // exactly this once.)
  if (outcome.vadFoundNothing && words.length > 0) {
    warnings.push("vad_found_no_speech");
  }
  if (outcome.diarFoundNothing && words.length > 0) {
    warnings.push("diarization_found_no_speakers");
  }

  const anchored =
    lane.result.timestamps === "none" ? anchorTimelessWords(words, segments, durationMs) : words;

  const sorted = [...anchored].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);

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
  vadFoundNothing: boolean;
  /** A diarizer ran and returned no speakers at all (M19). */
  diarFoundNothing: boolean;
  diarSource: "channels" | "clustering" | "stt" | "none";
  diarEngine: string | null;
}

/** Mono (or forced-mix) audio: one transcription, then diarize if the lane didn't. */
async function singleStream(job: Job): Promise<StreamOutcome> {
  const full = path.join(job.workDir, "full.wav");
  await toMono16k(job.input, full);

  const pcm = await readWav(full);
  const durationMs = pcm.durationMs;

  const { map, segments, sttFile, vad, vadFoundNothing } = await trimSilence(job, full, pcm.durationMs);

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
  let diarFoundNothing = false;

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
      // M19: a component that silently finds nothing must say so. Zero
      // speakers on audio with words means every word comes back unlabeled,
      // which reads downstream as "a transcript with no speakers" rather than
      // as "the diarizer failed" — indistinguishable at exactly the moment the
      // difference matters.
      if (segs.length === 0) {
        job.log.warn({ step: "diarize", engine: engine.name }, "diarizer found no speakers");
        diarFoundNothing = true;
      }
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
    vadFoundNothing: Boolean(vadFoundNothing),
    diarFoundNothing,
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
  let silentChannels = 0;

  for (let ch = 0; ch < channels; ch++) {
    const file = path.join(job.workDir, `ch${ch}.wav`);
    await extractChannel(job.input, file, ch);

    const pcm = await readWav(file);
    durationMs = Math.max(durationMs, pcm.durationMs);

    const trimmed = await trimSilence(job, file, pcm.durationMs);
    vad = trimmed.vad;
    // A silent channel is ordinary — one participant simply did not speak. The
    // VAD is only suspect when it found nothing on EVERY channel.
    if (trimmed.vadFoundNothing) silentChannels++;
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
    vadFoundNothing: silentChannels === channels,
    // Channel-derived speakers cannot come up empty: the microphones assigned
    // them, so there is no detection step here to fail silently.
    diarFoundNothing: false,
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
  /** The VAD ran and found no speech at all — reported, never silently absorbed. */
  vadFoundNothing?: boolean;
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
    // Silence all the way through — or a VAD that is wrong. Either way we send
    // the original file and let the STT answer. The reported span is the whole
    // file, not an empty list: we did transcribe all of it, and an empty
    // timeline downstream is indistinguishable from a broken one.
    job.log.info({ step: "vad", segments: 0 }, "no speech detected");
    return {
      map: TimelineMap.identity(durationMs),
      segments: [{ start_ms: 0, end_ms: durationMs }],
      sttFile: file,
      vad,
      vadFoundNothing: true,
    };
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

/**
 * A lane that returned prose with no timings still must not produce a dead
 * timeline. Anchor every word to the span of audio it came from — first speech
 * to last speech, or the whole file when the VAD contributed nothing.
 *
 * Never `start_ms === end_ms === 0` for audio that actually has duration:
 * downstream, `transcript_segment.start_ms/end_ms` are NOT NULL, so zeros would
 * satisfy the constraint while meaning nothing and the database could never
 * tell us it had gone wrong. A coarse honest span degrades the UI from
 * click-a-word to click-a-line; zeros seek to the start of the recording and
 * look like a bug to the person reading their own call.
 */
export function anchorTimelessWords(
  words: readonly Word[],
  segments: readonly Segment[],
  durationMs: number,
): Word[] {
  if (words.length === 0) return [];

  const start = segments[0]?.start_ms ?? 0;
  const end = segments[segments.length - 1]?.end_ms ?? durationMs;
  // A zero-length span for real audio would reintroduce exactly the problem
  // this function exists to prevent.
  const safeEnd = end > start ? end : Math.max(durationMs, start + 1);

  return words.map((w) => ({ ...w, start_ms: start, end_ms: safeEnd }));
}

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
