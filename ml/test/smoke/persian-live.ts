// LIVE acceptance smoke — real audio, real key, real money. Never part of
// `npm test`: it is run by hand, on purpose.
//
//   $env:SONIOX_API_KEY = "…"   # from the operator's secret store, never the repo
//   npx tsx test/smoke/persian-live.ts <audio-file>
//
// This is a developer tool, so it DOES print transcript excerpts to the
// terminal — that is the only way a human can judge whether the Persian came
// back right. The service itself still logs no content (Invariant 7).

import path from "node:path";
import { buildServer } from "../../src/server.js";
import { ProcessResponseSchema } from "../../src/schema.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx test/smoke/persian-live.ts <audio-file>");
  process.exit(2);
}
if (!process.env.SONIOX_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.error("no lane key in the environment — set SONIOX_API_KEY (and/or OPENROUTER_API_KEY)");
  process.exit(2);
}

process.env.ML_ALLOW_LOCAL_PATHS = "1";
process.env.ML_LOG_LEVEL ??= "info";
// The one sanctioned use of the strict flag (M6): in an ACCEPTANCE run a
// contract regression should fail loudly rather than degrade quietly. Never
// set this in a deployment — there it turns a degraded call into a lost one.
// Override to watch the degraded path deliberately.
process.env.ML_REQUIRE_WORD_TIMESTAMPS ??= "1";

const app = await buildServer();
const started = Date.now();

const res = await app.inject({
  method: "POST",
  url: "/process",
  payload: { audio_path: path.resolve(file), job_ref: "live-smoke", options: { language_hints: ["fa", "en"] } },
});

const elapsed = Date.now() - started;

if (res.statusCode !== 200) {
  console.error(`FAILED ${res.statusCode}:`, res.json());
  await app.close();
  process.exit(1);
}

const body = ProcessResponseSchema.parse(res.json());
await app.close();

const dur = body.media.duration_ms / 1000;
console.log("\n─── media ───");
console.log(`  ${body.media.container} / ${body.media.codec}  ${dur.toFixed(1)}s  ${body.media.channels}ch @ ${body.media.sample_rate_in}Hz`);

console.log("\n─── speech ───");
console.log(`  speech ${(body.speech.speech_ms / 1000).toFixed(1)}s · trimmed ${(body.speech.silence_trimmed_ms / 1000).toFixed(1)}s · ${body.speech.segments.length} segments`);

console.log("\n─── lane ───");
console.log(`  ${body.provenance.stt.lane} (${body.provenance.stt.model}) · timestamps=${body.provenance.stt.timestamps} · diarization=${body.provenance.diarization.source}`);
console.log(`  attempts: ${body.provenance.stt.attempts.map((a) => `${a.lane}:${a.ok ? "ok" : a.error_type}`).join(", ")}`);
console.log(`  wall time ${(elapsed / 1000).toFixed(1)}s for ${dur.toFixed(1)}s of audio (RTF ${(elapsed / 1000 / dur).toFixed(2)})`);

console.log("\n─── speakers ───");
for (const s of body.speakers) {
  console.log(`  ${s.label}${s.channel !== null ? ` (ch${s.channel})` : ""}: ${s.word_count} words, ${(s.total_ms / 1000).toFixed(1)}s`);
}

console.log("\n─── language ───");
console.log(`  primary=${body.language.primary} · ${body.language.detected.map((d) => `${d.code} ${(d.share * 100).toFixed(0)}%`).join(", ")}`);

// The acceptance criteria, checked rather than eyeballed.
const checks: Array<[string, boolean]> = [
  ["words returned", body.words.length > 0],
  ["word-level timestamps", body.provenance.stt.timestamps === "word"],
  ["timestamps inside the media", body.words.every((w) => w.end_ms <= body.media.duration_ms + 1000)],
  ["timestamps ordered", body.words.every((w, i, a) => i === 0 || w.start_ms >= a[i - 1]!.start_ms)],
  ["not degraded", !body.degraded],
  // A single-speaker recording legitimately has one label; only demand
  // separation when the clip is known to have several voices.
  ["speakers labelled", body.speakers.length >= (Number(process.env.EXPECT_SPEAKERS ?? 1) || 1)],
  // Positive VAD validation can only happen on real speech: synthetic tones
  // are correctly rejected by a trained VAD, so the unit suite can assert what
  // it must NOT detect but never what it must. A model fed the wrong input
  // shape returns near-zero on obvious speech and passes every negative test.
  ["vad found speech", body.speech.segments.length > 0],
  ["vad trimmed something", body.speech.silence_trimmed_ms > 0],
];

console.log("\n─── turns (first 20 speaker changes) ───");
let last: string | null = null;
let shown = 0;
let line = "";
for (const w of body.words) {
  if (w.speaker !== last) {
    if (line) console.log(`  ${line}`);
    if (++shown > 20) break;
    last = w.speaker;
    line = `[${fmt(w.start_ms)}] ${w.speaker ?? "??"}: ${w.text}`;
  } else {
    line += ` ${w.text}`;
  }
}
if (line && shown <= 20) console.log(`  ${line}`);

console.log("\n─── checks ───");
let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}

console.log(
  `\n${failed === 0 ? "ACCEPTANCE PASSED" : `ACCEPTANCE FAILED (${failed})`} — ${body.words.length} words, ${body.warnings.length ? body.warnings.join(",") : "no warnings"}\n`,
);
process.exit(failed === 0 ? 0 : 1);

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
