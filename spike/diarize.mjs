// Spike item 2: Node diarization quality (decides ml/'s language, M1/M9).
//
// sherpa-onnx-node + pyannote-segmentation-3.0 + 3D-Speaker embeddings,
// pure Node on Windows CPU. Ground truth: alternating male/female TTS turns.
import fs from "node:fs";
import path from "node:path";
import sherpa from "sherpa-onnx-node";

const WAV = process.argv[2] ?? "two_speakers.wav";
const EXPECTED = Number(process.argv[3] ?? 2);

const config = {
  segmentation: {
    pyannote: { model: process.env.SEG_MODEL ?? "./models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx" },
    debug: 0,
  },
  embedding: { model: "./models/emb.onnx", debug: 0, numThreads: Number(process.env.THREADS ?? 4) },
  clustering: { numClusters: EXPECTED > 0 ? EXPECTED : -1, threshold: 0.5 },
  minDurationOn: 0.3,
  minDurationOff: 0.5,
};

console.log(`[diarize] file: ${WAV}`);
const buildStart = Date.now();
const sd = new sherpa.OfflineSpeakerDiarization(config);
const buildMs = Date.now() - buildStart;
console.log(`[diarize] model load: ${(buildMs / 1000).toFixed(1)}s   sampleRate: ${sd.sampleRate}`);

const wave = sherpa.readWave(WAV);
const audioSeconds = wave.samples.length / wave.sampleRate;
console.log(`[diarize] audio: ${audioSeconds.toFixed(1)}s @ ${wave.sampleRate} Hz`);

const runStart = Date.now();
const segments = sd.process(wave.samples);
const runMs = Date.now() - runStart;

console.log(`\n[diarize] wall clock: ${(runMs / 1000).toFixed(1)}s for ${audioSeconds.toFixed(1)}s audio`);
console.log(`[diarize] realtime factor: ${(runMs / 1000 / audioSeconds).toFixed(3)}x  ` +
            `(projected for 10 min: ${((runMs / 1000 / audioSeconds) * 600).toFixed(0)}s)`);

const speakers = new Map();
for (const s of segments) {
  const key = `S${s.speaker}`;
  const entry = speakers.get(key) ?? { turns: 0, seconds: 0 };
  entry.turns += 1;
  entry.seconds += s.end - s.start;
  speakers.set(key, entry);
}
console.log(`\n[diarize] segments: ${segments.length}, speakers found: ${speakers.size} (expected ${EXPECTED})`);
for (const [k, v] of [...speakers].sort()) {
  console.log(`  ${k}: ${v.turns} turns, ${v.seconds.toFixed(1)}s (${((v.seconds / audioSeconds) * 100).toFixed(0)}% of audio)`);
}

console.log(`\nfirst 14 turns:`);
for (const s of segments.slice(0, 14)) {
  console.log(`  S${s.speaker}  ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s  (${(s.end - s.start).toFixed(2)}s)`);
}

// Ground truth check: TTS parts alternate strictly A,B,A,B… Count how often
// consecutive diarized turns alternate speaker — a crude but honest signal.
let alternations = 0;
for (let i = 1; i < segments.length; i++) {
  if (segments[i].speaker !== segments[i - 1].speaker) alternations += 1;
}
console.log(`\nspeaker changes between consecutive turns: ${alternations}/${segments.length - 1}`);

fs.writeFileSync(
  path.join("out", "diarization.json"),
  JSON.stringify({ file: WAV, audioSeconds, runMs, buildMs, segments }, null, 1),
);
console.log(`\n(full segment list written to out/diarization.json)`);
