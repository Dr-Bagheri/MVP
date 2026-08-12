// A minimal RIFF/WAVE reader for the one format we produce ourselves:
// 16-bit signed PCM. It is not a general WAV library and does not need to be —
// ffmpeg has already normalized anything the caller gave us.

import { readFile } from "node:fs/promises";
import { MlError } from "../errors.js";

export interface Pcm {
  /** Samples in [-1, 1], mono. */
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  durationMs: number;
}

export function parseWav(buf: Buffer): Pcm {
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
      dataLen = size === 0 || body + size > buf.length ? buf.length - body : size;
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
    sampleRate,
    channels,
    durationMs: Math.round((frames / sampleRate) * 1000),
  };
}

export async function readWav(path: string): Promise<Pcm> {
  return parseWav(await readFile(path));
}
