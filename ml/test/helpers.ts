// Test fixtures are GENERATED, never committed: audio binaries in a repo rot,
// bloat clones, and hide what they actually contain. Everything here is built
// from a formula, so a failing assertion points at a number you can read.

import { mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";

const exec = promisify(execFile);

export const SR = 16000;

export function tone(freq: number, ms: number, amp = 0.4): Float32Array {
  const n = Math.round((SR * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

export function silence(ms: number): Float32Array {
  return new Float32Array(Math.round((SR * ms) / 1000));
}

export function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Interleave two mono signals into one stereo buffer, zero-padding the short one. */
export function interleave(left: Float32Array, right: Float32Array): Float32Array {
  const n = Math.max(left.length, right.length);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = left[i] ?? 0;
    out[i * 2 + 1] = right[i] ?? 0;
  }
  return out;
}

export async function writeWav(
  file: string,
  samples: Float32Array,
  channels = 1,
  sampleRate = SR,
): Promise<string> {
  const frames = samples.length / channels;
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  buf.writeUInt16LE(channels * 2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);

  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }

  await writeFile(file, buf);
  void frames;
  return file;
}

export async function fixtureDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "echo-ml-test-"));
}

/** Re-encode a fixture into another container, to exercise "any audio format" (M6). */
export async function convert(input: string, output: string, args: string[] = []): Promise<string> {
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, ...args, output]);
  return output;
}

export async function ffmpegPresent(): Promise<boolean> {
  try {
    await exec("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}
