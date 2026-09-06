// A minimal RIFF/WAVE reader for the one format we produce ourselves:
// 16-bit signed PCM. It is not a general WAV library and does not need to be —
// ffmpeg has already normalized anything the caller gave us.
//
// Two ways to read (2026-09-06, the long-file lane): `readWav` loads the whole
// file into a Float32Array — fine for a test clip, and 1.15 GB of process
// memory for a five-hour recording on a box with one gigabyte to spare.
// `openWavStream` yields the same samples chunk by chunk from a file handle,
// which is what the VAD consumes; nothing in the pipeline needs a whole
// recording in memory at once, and the streaming source is how that stays
// true when the ceiling moves from 35 minutes to five hours.

import { readFile, open } from "node:fs/promises";
import { MlError } from "../errors.js";

export interface Pcm {
  /** Samples in [-1, 1], mono. */
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  durationMs: number;
}

/** What the header says: where the samples start and how many there are. */
export interface WavHeader {
  sampleRate: number;
  channels: number;
  bits: number;
  dataStart: number;
  dataLen: number;
  frames: number;
  durationMs: number;
}

/**
 * The same samples, delivered in bounded pieces. `chunks()` yields mono
 * Float32 frames in file order; a consumer that must see whole windows keeps
 * its own carry across chunk edges (the VADs do).
 */
export interface PcmSource {
  sampleRate: number;
  channels: number;
  durationMs: number;
  chunks(): AsyncIterable<Float32Array>;
}

/** the header parse, over as much of the file as the caller read (≥ 64 KiB covers every ffmpeg output) */
export function parseWavHeader(buf: Buffer, fileLength: number = buf.length): WavHeader {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new MlError("transcode_failed", "expected a RIFF/WAVE file from ffmpeg");
  }

  let pos = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let dataStart = -1;
  let dataLen = 0;

  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;

    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataStart = body;
      // A streamed WAV can carry size 0 or 0xFFFFFFFF; trust the file length.
      dataLen = size === 0 || body + size > fileLength ? fileLength - body : size;
      break;
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataStart < 0 || !sampleRate || !channels) {
    throw new MlError("transcode_failed", "WAV missing fmt or data chunk");
  }
  if (bits !== 16) {
    throw new MlError("transcode_failed", `expected 16-bit PCM, got ${bits}-bit`);
  }

  const frames = Math.floor(dataLen / 2 / channels);
  return {
    sampleRate,
    channels,
    bits,
    dataStart,
    dataLen,
    frames,
    durationMs: Math.round((frames / sampleRate) * 1000),
  };
}

export function parseWav(buf: Buffer): Pcm {
  const header = parseWavHeader(buf);
  const { channels, dataStart, frames } = header;
  const samples = new Float32Array(frames);
  // Downmix defensively: everything upstream is already mono, but a stray
  // stereo file should average rather than alias.
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      acc += buf.readInt16LE(dataStart + (f * channels + c) * 2);
    }
    samples[f] = acc / channels / 32768;
  }

  return {
    samples,
    sampleRate: header.sampleRate,
    channels,
    durationMs: header.durationMs,
  };
}

export async function readWav(path: string): Promise<Pcm> {
  return parseWav(await readFile(path));
}

/** the header alone — the duration of a five-hour file without reading it */
export async function readWavHeader(path: string): Promise<WavHeader> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    await handle.read(head, 0, head.length, 0);
    return parseWavHeader(head, size);
  } finally {
    await handle.close();
  }
}

export async function wavDuration(path: string): Promise<number> {
  return (await readWavHeader(path)).durationMs;
}

/** thirty seconds of 16 kHz audio per chunk: ~1 MB of samples in flight, never the file */
const DEFAULT_FRAMES_PER_CHUNK = 16_000 * 30;

/**
 * The file as a PcmSource. Each chunk is decoded from a reused byte buffer;
 * the Float32 chunk handed out is the consumer's to keep or drop.
 */
export async function openWavStream(path: string, framesPerChunk: number = DEFAULT_FRAMES_PER_CHUNK): Promise<PcmSource> {
  const header = await readWavHeader(path);
  const perChunk = Math.max(1, Math.floor(framesPerChunk));
  return {
    sampleRate: header.sampleRate,
    channels: header.channels,
    durationMs: header.durationMs,
    async *chunks() {
      const handle = await open(path, "r");
      try {
        const bytesPerFrame = 2 * header.channels;
        const buf = Buffer.alloc(perChunk * bytesPerFrame);
        let frame = 0;
        while (frame < header.frames) {
          const want = Math.min(perChunk, header.frames - frame);
          const { bytesRead } = await handle.read(buf, 0, want * bytesPerFrame, header.dataStart + frame * bytesPerFrame);
          const got = Math.floor(bytesRead / bytesPerFrame);
          if (got === 0) break; // a file shorter than its header claimed
          const out = new Float32Array(got);
          for (let f = 0; f < got; f++) {
            let acc = 0;
            for (let c = 0; c < header.channels; c++) acc += buf.readInt16LE((f * header.channels + c) * 2);
            out[f] = acc / header.channels / 32768;
          }
          frame += got;
          yield out;
        }
      } finally {
        await handle.close();
      }
    },
  };
}

/** in-memory PCM as a one-chunk source — tests, and any caller that already holds the samples */
export function pcmSource(pcm: Pcm): PcmSource {
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels,
    durationMs: pcm.durationMs,
    async *chunks() { yield pcm.samples; },
  };
}

export function isPcm(input: Pcm | PcmSource): input is Pcm {
  return (input as Pcm).samples instanceof Float32Array;
}

/** what every VAD accepts: the whole thing, or a stream of it */
export type PcmInput = Pcm | PcmSource;

export function asSource(input: PcmInput): PcmSource {
  return isPcm(input) ? pcmSource(input) : input;
}
