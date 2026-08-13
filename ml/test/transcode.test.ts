// The transcode matrix. "Any audio format" is a user ruling (M6), so it gets
// asserted against real files ffmpeg actually produced, not mocks.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { channelsAreDistinct, extractChannel, probe, toMono16k, concatRegions, PIPELINE_SAMPLE_RATE } from "../src/audio/ffmpeg.js";
import { readWav } from "../src/audio/wav.js";
import { concat, convert, fixtureDir, ffmpegPresent, interleave, silence, tone, writeWav } from "./helpers.js";

const have = await ffmpegPresent();
const suite = have ? describe : describe.skip;

let dir: string;
let monoWav: string;
let stereoWav: string;

beforeAll(async () => {
  if (!have) return;
  dir = await fixtureDir();

  // 2s tone · 4s silence · 2s tone, at 44.1k so the resample is real work.
  monoWav = await writeWav(
    path.join(dir, "mono.wav"),
    concat(tone(220, 2000), silence(4000), tone(330, 2000)),
    1,
  );

  // Left speaks first, right answers — a two-microphone recording.
  stereoWav = await writeWav(
    path.join(dir, "stereo.wav"),
    interleave(concat(tone(220, 2000), silence(2000)), concat(silence(2000), tone(660, 2000))),
    2,
  );
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

suite("probe", () => {
  it("reads channels, rate and duration from a WAV", async () => {
    const p = await probe(monoWav);
    expect(p.channels).toBe(1);
    expect(p.sample_rate_in).toBe(16000);
    expect(p.duration_ms).toBeGreaterThan(7900);
    expect(p.codec).toContain("pcm");
  });

  it("sees two channels in a stereo file", async () => {
    expect((await probe(stereoWav)).channels).toBe(2);
  });

  it("refuses a file that is not media, without pretending it is", async () => {
    const notAudio = path.join(dir, "notes.txt");
    await writeWav(notAudio, silence(1)); // real WAV bytes...
    const junk = path.join(dir, "junk.bin");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(junk, Buffer.from("this is not audio, it is a sentence"));

    await expect(probe(junk)).rejects.toMatchObject({ type: "unsupported_media", retryable: false });
  });
});

suite("transcode matrix — any format in, pipeline format out", () => {
  const formats: Array<[string, string, string[]]> = [
    ["mp3", "m.mp3", ["-b:a", "128k"]],
    ["ogg/opus", "m.ogg", ["-c:a", "libopus"]],
    ["flac", "m.flac", []],
    ["m4a/aac", "m.m4a", ["-c:a", "aac"]],
    ["wav 8k mono", "m8k.wav", ["-ar", "8000"]],
    ["wav 48k stereo", "m48k.wav", ["-ar", "48000", "-ac", "2"]],
  ];

  for (const [label, name, args] of formats) {
    it(`accepts ${label}`, async () => {
      const src = await convert(monoWav, path.join(dir, name), args);
      const out = path.join(dir, `${name}.16k.wav`);
      await toMono16k(src, out);

      const pcm = await readWav(out);
      expect(pcm.sampleRate).toBe(PIPELINE_SAMPLE_RATE);
      expect(pcm.channels).toBe(1);
      // Lossy round-trips wobble the length by a few ms; 8s ± 300ms is honest.
      expect(pcm.durationMs).toBeGreaterThan(7700);
      expect(pcm.durationMs).toBeLessThan(8300);
    });
  }
});

suite("channel extraction — speakers from the microphones", () => {
  it("isolates each channel into its own mono stream", async () => {
    const left = path.join(dir, "ch0.wav");
    const right = path.join(dir, "ch1.wav");
    await extractChannel(stereoWav, left, 0);
    await extractChannel(stereoWav, right, 1);

    const l = await readWav(left);
    const r = await readWav(right);

    const energy = (s: Float32Array, from: number, to: number) => {
      let acc = 0;
      for (let i = from; i < to && i < s.length; i++) acc += (s[i] ?? 0) ** 2;
      return acc;
    };
    const half = Math.floor(l.samples.length / 2);

    // Left holds the first half only; right holds the second. If the channels
    // were mixed instead of split, both halves would be loud in both files.
    expect(energy(l.samples, 0, half)).toBeGreaterThan(energy(l.samples, half, l.samples.length) * 10);
    expect(energy(r.samples, half, r.samples.length)).toBeGreaterThan(energy(r.samples, 0, half) * 10);
  });
});

suite("dual-mono detection — the difference between two mics and one duplicated", () => {
  it("says two genuinely different channels ARE distinct", async () => {
    // Left speaks first, right answers: a real two-party recording.
    expect(await channelsAreDistinct(stereoWav)).toBe(true);
  });

  it("says a DUPLICATED channel is not", async () => {
    // What a phone voice memo actually produces: one microphone, copied into
    // two channels. Measured on a real recording, treating this as
    // per-speaker channels transcribed every word TWICE, invented two
    // speakers who were the same person, and doubled the STT bill — with
    // nothing failing anywhere.
    const mono = concat(tone(220, 2000), silence(500), tone(330, 2000));
    const dualMono = await writeWav(path.join(dir, "dualmono.wav"), interleave(mono, mono), 2);
    expect(await channelsAreDistinct(dualMono)).toBe(false);
  });

  it("treats a mono file as not distinct rather than throwing", async () => {
    expect(await channelsAreDistinct(monoWav)).toBe(false);
  });
});

suite("concatRegions — cutting the silence out", () => {
  it("produces a file as long as the speech it kept", async () => {
    const out = path.join(dir, "speech.wav");
    await concatRegions(monoWav, out, [
      { start_ms: 0, end_ms: 2000 },
      { start_ms: 6000, end_ms: 8000 },
    ]);

    const pcm = await readWav(out);
    expect(pcm.durationMs).toBeGreaterThan(3800);
    expect(pcm.durationMs).toBeLessThan(4200);
  });

  it("handles an empty region list without failing the job", async () => {
    const out = path.join(dir, "empty.wav");
    await concatRegions(monoWav, out, []);
    expect((await readWav(out)).durationMs).toBeLessThan(100);
  });
});
