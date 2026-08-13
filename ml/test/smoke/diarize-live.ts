// LIVE diarization check — real audio, real models, no network.
//
//   npx tsx test/smoke/diarize-live.ts <audio-file> [expected-speaker-count]
//
// This is where POSITIVE validation of the diarizer lives, deliberately. A
// unit test can only assert what a model must NOT find (silence has no
// speakers, a tone is not a voice), and a model wired up wrong satisfies all
// of that perfectly — the Silero context-window bug passed every negative test
// this package had. Detecting the right number of real voices in real speech
// is the assertion that actually holds the engine to account.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toMono16k } from "../../src/audio/ffmpeg.js";
import { diarizer } from "../../src/diarize/index.js";
import { config } from "../../src/config.js";

const file = process.argv[2];
const expected = process.argv[3] ? Number(process.argv[3]) : null;

if (!file) {
  console.error("usage: tsx test/smoke/diarize-live.ts <audio-file> [expected-speaker-count]");
  process.exit(2);
}

const engine = await diarizer();
if (!engine) {
  console.error(
    "no diarizer available — set ML_SEGMENTATION_MODEL and ML_EMBEDDING_MODEL to the ONNX model paths",
  );
  process.exit(2);
}

const dir = await mkdtemp(path.join(tmpdir(), "echo-diar-"));
try {
  const wav = path.join(dir, "mono16k.wav");
  await toMono16k(path.resolve(file), wav);

  const started = Date.now();
  // Deliberately high: this smoke REPORTS the clusterer's true count rather
  // than capping it. A low ceiling here would hide over-splitting behind a
  // tidy number — which is exactly how the segment-dropping bug stayed
  // invisible until a real two-voice recording contradicted it.
  const segments = await engine.diarize(wav, { maxSpeakers: 64 });
  const elapsed = Date.now() - started;

  const total = segments.reduce((a, s) => a + (s.end_ms - s.start_ms), 0);
  const audioMs = segments.length ? Math.max(...segments.map((s) => s.end_ms)) : 0;

  const perSpeaker = new Map<string, { ms: number; turns: number }>();
  for (const s of segments) {
    const cur = perSpeaker.get(s.speaker) ?? { ms: 0, turns: 0 };
    cur.ms += s.end_ms - s.start_ms;
    cur.turns += 1;
    perSpeaker.set(s.speaker, cur);
  }

  console.log(`\nengine: ${engine.name} · threads=${config().ML_DIARIZER_THREADS} · threshold=${config().ML_DIARIZER_THRESHOLD}`);
  console.log(`segments: ${segments.length} · speech ${(total / 1000).toFixed(1)}s`);
  console.log(`wall ${(elapsed / 1000).toFixed(1)}s for ${(audioMs / 1000).toFixed(1)}s (RTF ${audioMs ? (elapsed / audioMs).toFixed(2) : "n/a"})`);

  console.log("\nspeakers:");
  for (const [label, v] of [...perSpeaker].sort()) {
    console.log(`  ${label}: ${v.turns} turns, ${(v.ms / 1000).toFixed(1)}s`);
  }

  // Alternation, for the two-speaker case: how often the voice actually changes
  // between consecutive segments. A diarizer that collapses everyone into one
  // cluster still produces plausible-looking segments, so this is what catches it.
  let changes = 0;
  for (let i = 1; i < segments.length; i++) {
    if (segments[i]!.speaker !== segments[i - 1]!.speaker) changes++;
  }
  console.log(`\nvoice changes: ${changes} across ${segments.length} segments`);

  const found = perSpeaker.size;
  const checks: Array<[string, boolean]> = [
    ["segments found", segments.length > 0],
    ["at least one speaker", found >= 1],
    ["no silent-file collapse", total > 0],
  ];
  if (expected !== null) {
    // The real test: the right COUNT, discovered rather than told. Inventing a
    // second speaker in a monologue is as wrong as merging two people into one.
    checks.push([`exactly ${expected} speaker(s) discovered (found ${found})`, found === expected]);
  }

  console.log("\nchecks:");
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(`\n${failed === 0 ? "DIARIZATION PASSED" : `DIARIZATION FAILED (${failed})`}\n`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  await rm(dir, { recursive: true, force: true });
}
