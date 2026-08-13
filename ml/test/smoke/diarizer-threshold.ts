// The local diarizer's clustering threshold, measured rather than guessed.
//
// WHY THIS EXISTS. ml/ carried a recorded caveat that sherpa "over-splits real
// conversation — no threshold yields 2". Two things were wrong with that.
//
// First, the ground truth was wrong. It came from the FILE NAME
// (`persian-2voice-1.mp3`), not from the audio. The recording is a FOUR-person
// Persian conversation: Soniox labels four speakers with plausible turn-taking
// (median gap 0.18s, short backchannels like «آره» from one voice, a
// participant addressed by name), and the local diarizer independently lands
// on four at the right threshold. Two systems agreeing beats a filename.
//
// Second, the over-split is a PARAMETER, not a property of the model. The
// sweep below is monotonic and well-behaved: it is a knob set to the wrong
// place, not a clusterer that cannot cluster.
//
// ── Measured, 2026-08-13, sherpa-onnx + pyannote segmentation + the shipped
//    embedding model, on two real Persian recordings ──────────────────────────
//
//   threshold      4-speaker conversation      1-speaker recording
//   0.50 (was      22 clusters                 1
//    the default)
//   0.70           17                          1
//   0.90            9                          1
//   1.00            5                          1
//   1.05            4  ← matches Soniox        1
//   1.10            3                          1
//   1.15            2                          1
//   1.20            1, and 14s of speech lost  —
//
// The single-speaker column is the control, and it is what makes the change
// safe: raising the threshold does not merge or invent anything on audio with
// one voice — the count is flat across the whole range, identical segments,
// identical speech total. So the old default bought nothing on that side and
// cost a factor of five on the other.
//
// minDurationOn / minDurationOff were swept too and move the cluster count
// barely at all (at 1.5s minDurationOn the count at 0.5 is still 16) — while
// discarding 17% of the speech. The knob that most reduces over-splitting is
// the one that deletes the user's words, which makes it the wrong knob (M21).
//
// ── What this is NOT ────────────────────────────────────────────────────────
//
// Two recordings, both Persian, speaker counts 1 and 4. The threshold is
// specific to this embedding model. This is a better default with its
// conditions attached, not a validated universal — and it is why the shipped
// value is 1.0 rather than the 1.05 that fits this sample exactly.
//
//   ML_SEGMENTATION_MODEL=… ML_EMBEDDING_MODEL=… \
//   npx tsx test/smoke/diarizer-threshold.ts <audio> [expected-speakers]
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { toMono16k } from "../../src/audio/ffmpeg.js";
import { readWav } from "../../src/audio/wav.js";

const input: string = process.argv[2] ?? "";
const expected = process.argv[3] ? Number(process.argv[3]) : null;
if (!input) {
  console.error("usage: diarizer-threshold.ts <audio-file> [expected-speakers]");
  process.exit(2);
}

const SEG = process.env.ML_SEGMENTATION_MODEL;
const EMB = process.env.ML_EMBEDDING_MODEL;
if (!SEG || !EMB) {
  console.error("ML_SEGMENTATION_MODEL and ML_EMBEDDING_MODEL are required");
  process.exit(2);
}

const mod: any = await import("sherpa-onnx-node" as string);
const sherpa = mod.default?.OfflineSpeakerDiarization ? mod.default : mod;

const dir = await mkdtemp(path.join(os.tmpdir(), "diar-thr-"));
try {
  const wav = path.join(dir, "mono.wav");
  await toMono16k(path.resolve(input), wav);
  const pcm = await readWav(wav);
  console.log(`${path.basename(input)}: ${(pcm.durationMs / 1000).toFixed(1)}s mono 16k`);
  if (expected !== null) console.log(`expected speakers: ${expected}`);
  console.log("\nthreshold  clusters  segments  speech(s)");
  console.log("-".repeat(42));

  const results: { thr: number; clusters: number }[] = [];
  for (const thr of [0.5, 0.7, 0.9, 1.0, 1.05, 1.1, 1.15, 1.2]) {
    const sd = new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: SEG }, debug: 0 },
      embedding: { model: EMB, debug: 0, numThreads: 4 },
      clustering: { numClusters: -1, threshold: thr },
      minDurationOn: 0.3,
      minDurationOff: 0.5,
    });
    const raw = sd.process(pcm.samples) as Array<{ start: number; end: number; speaker: number }>;
    const clusters = new Set(raw.map((r) => r.speaker)).size;
    const speech = raw.reduce((a, r) => a + (r.end - r.start), 0);
    const mark = expected !== null && clusters === expected ? "  <- matches expected" : "";
    console.log(
      `${thr.toFixed(2).padStart(9)}${String(clusters).padStart(10)}` +
        `${String(raw.length).padStart(10)}${speech.toFixed(1).padStart(11)}${mark}`,
    );
    results.push({ thr, clusters });
  }

  if (expected !== null) {
    const hit = results.filter((r) => r.clusters === expected).map((r) => r.thr);
    console.log(
      hit.length
        ? `\nthresholds that find exactly ${expected}: ${hit.join(", ")}`
        : `\nNO threshold in the swept range finds ${expected} — that would be a real bound, ` +
            `not a tuning problem. Check the expected count against the audio before believing it.`,
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
