// ffmpeg/ffprobe: the transcode step. Any audio format in (M6, user ruling)
// → 16 kHz signed-16 PCM out, which is what both the VAD and the STT lanes eat.
//
// The binaries are resolved from ML_FFMPEG_PATH/ML_FFPROBE_PATH or from PATH.
// We deliberately do NOT ship a vendored 80 MB binary: dev machines have
// ffmpeg, and the container profiles (M12.2/3) install it in the image, which
// is the same discipline with none of the download.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { MlError } from "../errors.js";

const exec = promisify(execFile);

export const PIPELINE_SAMPLE_RATE = 16000;

export interface Probe {
  container: string;
  codec: string;
  channels: number;
  sample_rate_in: number;
  /** From the container header; may be absent or a lie. The decoded PCM is authoritative. */
  duration_ms: number | null;
}

let ffmpegBin: string | undefined;
let ffprobeBin: string | undefined;
let ffmpegVersion: string | undefined;

async function works(bin: string): Promise<string | null> {
  try {
    const { stdout } = await exec(bin, ["-version"], { maxBuffer: 1 << 20 });
    return stdout.split("\n")[0] ?? "unknown";
  } catch {
    return null;
  }
}

/** Resolve once per process. Throws only when a job actually needs ffmpeg. */
export async function ffmpeg(): Promise<string> {
  if (ffmpegBin) return ffmpegBin;
  const candidates = [config().ML_FFMPEG_PATH, "ffmpeg"].filter(Boolean) as string[];
  for (const c of candidates) {
    const v = await works(c);
    if (v) {
      ffmpegBin = c;
      ffmpegVersion = parseVersion(v);
      return c;
    }
  }
  throw new MlError("internal", "ffmpeg not found: set ML_FFMPEG_PATH or put it on PATH");
}

export async function ffprobe(): Promise<string> {
  if (ffprobeBin) return ffprobeBin;
  const candidates = [config().ML_FFPROBE_PATH, "ffprobe"].filter(Boolean) as string[];
  for (const c of candidates) {
    if (await works(c)) {
      ffprobeBin = c;
      return c;
    }
  }
  throw new MlError("internal", "ffprobe not found: set ML_FFPROBE_PATH or put it on PATH");
}

function parseVersion(line: string): string {
  const m = /ffmpeg version (\S+)/.exec(line);
  return m?.[1] ?? "unknown";
}

/** For /health — never throws. */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await ffmpeg();
    await ffprobe();
    return true;
  } catch {
    return false;
  }
}

export async function ffmpegVersionString(): Promise<string> {
  try {
    await ffmpeg();
  } catch {
    return "unavailable";
  }
  return ffmpegVersion ?? "unknown";
}

export async function probe(file: string): Promise<Probe> {
  const bin = await ffprobe();
  let raw: string;
  try {
    const { stdout } = await exec(
      bin,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { maxBuffer: 8 << 20 },
    );
    raw = stdout;
  } catch (e) {
    throw new MlError("unsupported_media", "ffprobe could not read the input as media", { cause: e });
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new MlError("unsupported_media", "ffprobe returned no usable metadata", { cause: e });
  }

  const audio = (data.streams ?? []).find((s: any) => s.codec_type === "audio");
  if (!audio) throw new MlError("unsupported_media", "input contains no audio stream");

  const durSec = Number(data.format?.duration ?? audio.duration ?? NaN);

  return {
    container: String(data.format?.format_name ?? "unknown"),
    codec: String(audio.codec_name ?? "unknown"),
    channels: Number(audio.channels ?? 1),
    sample_rate_in: Number(audio.sample_rate ?? 0) || PIPELINE_SAMPLE_RATE,
    duration_ms: Number.isFinite(durSec) ? Math.round(durSec * 1000) : null,
  };
}

async function run(args: string[], what: string): Promise<void> {
  const bin = await ffmpeg();
  try {
    await exec(bin, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], {
      maxBuffer: 8 << 20,
    });
  } catch (e) {
    throw new MlError("transcode_failed", `ffmpeg failed: ${what}`, { cause: e });
  }
}

/** Whole file → mono 16 kHz PCM WAV. The pipeline format. */
export async function toMono16k(input: string, output: string): Promise<void> {
  await run(["-i", input, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", String(PIPELINE_SAMPLE_RATE), "-c:a", "pcm_s16le", output], "downmix to mono 16k");
}

/**
 * One channel of a multi-channel file → its own mono 16 kHz PCM WAV.
 * This is how two-channel recordings get their speakers: from the channels,
 * with no diarization at all (M6).
 */
export async function extractChannel(input: string, output: string, channel: number): Promise<void> {
  await run(
    [
      "-i",
      input,
      "-vn",
      "-map",
      "0:a:0",
      "-af",
      `pan=mono|c0=c${channel}`,
      "-ar",
      String(PIPELINE_SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      output,
    ],
    `extract channel ${channel}`,
  );
}

/**
 * Concatenate the speech regions VAD found into one shorter file, so we do not
 * pay the STT for silence. The caller keeps the segment list and maps the
 * returned timestamps back onto the original timeline.
 */
export async function concatRegions(
  input: string,
  output: string,
  regions: readonly { start_ms: number; end_ms: number }[],
): Promise<void> {
  if (regions.length === 0) {
    await run(["-i", input, "-t", "0.01", "-c:a", "pcm_s16le", output], "empty speech region");
    return;
  }
  const parts = regions
    .map(
      (r, i) =>
        `[0:a]atrim=start=${(r.start_ms / 1000).toFixed(3)}:end=${(r.end_ms / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
    )
    .join(";");
  const inputs = regions.map((_, i) => `[a${i}]`).join("");
  const filter = `${parts};${inputs}concat=n=${regions.length}:v=0:a=1[out]`;
  await run(
    ["-i", input, "-filter_complex", filter, "-map", "[out]", "-ar", String(PIPELINE_SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", output],
    "concatenate speech regions",
  );
}

/** Test seam: forget resolved binaries so a test can point at a stub. */
export function resetBinaries(): void {
  ffmpegBin = undefined;
  ffprobeBin = undefined;
  ffmpegVersion = undefined;
}
