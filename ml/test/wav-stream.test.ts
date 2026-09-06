/**
 * The streaming WAV source against the whole-file reader (2026-09-06, the
 * long-file lane). The claim under test is EQUALITY: a VAD fed thirty-second
 * chunks must see exactly the frames it saw from one array, or the regions —
 * and every line boundary built on them (M20) — move the day the ceiling
 * moves. The chunk sizes here are chosen NOT to divide the VADs' window
 * sizes, so every chunk edge splits a window and the carry has to do its job.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openWavStream, parseWavHeader, pcmSource, readWav, readWavHeader, wavDuration } from "../src/audio/wav.js";
import { EnergyVad } from "../src/vad/energy.js";
import { windows } from "../src/vad/types.js";
import { concat, fixtureDir, interleave, silence, tone, writeWav, SR } from "./helpers.js";

let dir: string;
let mono: string;
let stereo: string;
const signal = concat(tone(220, 1500), silence(2000), tone(330, 900), silence(700), tone(440, 1200));

beforeAll(async () => {
  dir = await fixtureDir();
  mono = await writeWav(path.join(dir, "mono.wav"), signal, 1);
  stereo = await writeWav(
    path.join(dir, "stereo.wav"),
    interleave(concat(tone(220, 1000), silence(1000)), concat(silence(1000), tone(660, 1000))),
    2,
  );
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function collect(source: { chunks(): AsyncIterable<Float32Array> }): Promise<Float32Array> {
  const parts: Float32Array[] = [];
  for await (const chunk of source.chunks()) parts.push(chunk);
  return concat(...parts);
}

describe("the WAV header and the streaming source", () => {
  it("reads the duration from the header alone, equal to the whole-file read", async () => {
    const whole = await readWav(mono);
    expect(await wavDuration(mono)).toBe(whole.durationMs);
    const header = await readWavHeader(mono);
    expect(header.frames).toBe(whole.samples.length);
    expect(header.sampleRate).toBe(SR);
  });

  it("yields the same samples in chunks that do not divide any window size", async () => {
    const whole = await readWav(mono);
    // 7001 frames: not a multiple of 512 (Silero) nor 480 (the energy frame)
    const streamed = await collect(await openWavStream(mono, 7001));
    expect(streamed.length).toBe(whole.samples.length);
    expect(Array.from(streamed)).toEqual(Array.from(whole.samples));
  });

  it("downmixes a stereo file the same way chunked as whole", async () => {
    const whole = await readWav(stereo);
    const streamed = await collect(await openWavStream(stereo, 1234));
    expect(Array.from(streamed)).toEqual(Array.from(whole.samples));
    expect((await openWavStream(stereo)).channels).toBe(2);
  });

  it("refuses a header that is not 16-bit PCM", () => {
    const buf = Buffer.alloc(44);
    buf.write("RIFF", 0, "ascii"); buf.write("WAVE", 8, "ascii"); buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(SR, 24); buf.writeUInt16LE(24, 34); // 24-bit
    buf.write("data", 36, "ascii"); buf.writeUInt32LE(0, 40);
    expect(() => parseWavHeader(buf)).toThrow(/16-bit/);
  });
});

describe("windows over a chunked stream", () => {
  it("assembles a window that straddles two chunks and drops the trailing partial", async () => {
    const samples = Float32Array.from({ length: 1000 }, (_, i) => i);
    const chunked = { async *chunks() { yield samples.subarray(0, 300); yield samples.subarray(300, 650); yield samples.subarray(650); } };
    const seen: number[][] = [];
    for await (const w of windows(chunked.chunks(), 256)) seen.push(Array.from(w));
    expect(seen.length).toBe(3); // 1000 / 256 = 3 whole windows, 232 dropped
    expect(seen[1]![0]).toBe(256);
    expect(seen[1]![255]).toBe(511);
    expect(seen[2]![0]).toBe(512);
    expect(seen[2]![255]).toBe(767);
  });
});

describe("the energy VAD sees the same frames either way", () => {
  it("returns identical regions for a whole-file PCM and a streamed source", async () => {
    const whole = await readWav(mono);
    const vad = new EnergyVad();
    const fromMemory = await vad.detect(whole);
    const fromStream = await vad.detect(await openWavStream(mono, 7001));
    const fromAdapter = await vad.detect(pcmSource(whole));
    expect(fromMemory.length).toBeGreaterThan(1); // the fixture has three tones
    expect(fromStream).toEqual(fromMemory);
    expect(fromAdapter).toEqual(fromMemory);
  });
});
