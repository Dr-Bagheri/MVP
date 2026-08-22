/**
 * Voice-embedding acceptance (rule 7: positive detection on real audio) —
 * run ON THE DEPLOYMENT BOX, where the model and the piper voices live:
 *
 *   ML_URL=http://127.0.0.1:<port> PIPER_DIR=/opt/neurai/tts \
 *     npx tsx test/smoke/embedding-live.ts
 *
 * The claim under test: the extractor tells VOICES apart, not sentences.
 * So the same voice speaks TWO DIFFERENT sentences (same-voice pair must
 * score high) and a different voice speaks a third (cross-voice pair must
 * score clearly lower). Using the text axis as the control is deliberate:
 * an extractor that actually fingerprints phrasing or content would fail
 * the same-voice/different-text pair immediately.
 *
 * HONEST BOUND, recorded exactly as the diarizer spike recorded its own:
 * piper voices are synthetic — clean, close-mic, no room. This proves the
 * plumbing and the separation, NOT far-field/same-gender robustness. The
 * first real enrollment is the real positive detection, and the match
 * threshold in core stays conservative until real voices calibrate it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const ML_URL = process.env.ML_URL ?? "http://127.0.0.1:8000";
const PIPER_DIR = process.env.PIPER_DIR ?? "/opt/neurai/tts";

const SENTENCE_A = "جلسهٔ امروز دربارهٔ بودجهٔ سال آینده و برنامهٔ استخدام بود.";
const SENTENCE_B = "لطفاً گزارش فروش ماه گذشته را تا پنج‌شنبه برای من ارسال کنید.";

async function synth(model: string, text: string, out: string): Promise<void> {
  // piper reads its text from stdin; the shell pipe is the reliable feed.
  // The short flags (-m/-f) are the ones both the C++ binary and the
  // python CLI accept — the long spellings differ between them.
  const piper = process.env.PIPER_BIN ?? path.join(PIPER_DIR, "piper", "piper");
  await run("bash", ["-c",
    `printf %s ${JSON.stringify(text)} | ${piper} -m ${model} -f ${out}`]);
}

async function embed(file: string): Promise<number[]> {
  const bytes = await readFile(file);
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "clip.wav");
  const res = await fetch(`${ML_URL}/embed`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`/embed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { embedding: number[]; dim: number; speech_ms: number };
  console.log(`  embedded ${path.basename(file)}: dim=${body.dim} speech_ms=${body.speech_ms}`);
  return body.embedding;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const dir = await mkdtemp(path.join(tmpdir(), "embed-live-"));
try {
  const models = (await readdir(PIPER_DIR)).filter((f) => f.endsWith(".onnx"));
  if (models.length < 2) throw new Error(`need 2 piper voices in ${PIPER_DIR}, found ${models.length}`);
  const voiceA = path.join(PIPER_DIR, models[0]!);
  const voiceB = path.join(PIPER_DIR, models[1]!);
  console.log(`voice A = ${models[0]}, voice B = ${models[1]}`);

  const a1 = path.join(dir, "a1.wav");
  const a2 = path.join(dir, "a2.wav");
  const b1 = path.join(dir, "b1.wav");
  await synth(voiceA, SENTENCE_A, a1);
  await synth(voiceA, SENTENCE_B, a2); // SAME voice, DIFFERENT sentence
  await synth(voiceB, SENTENCE_A, b1); // different voice, SAME sentence as a1

  const [ea1, ea2, eb1] = [await embed(a1), await embed(a2), await embed(b1)];
  const same = cosine(ea1, ea2);
  const crossSameText = cosine(ea1, eb1);
  const crossDiffText = cosine(ea2, eb1);
  console.log(`same-voice/diff-text : ${same.toFixed(3)}`);
  console.log(`cross-voice/same-text: ${crossSameText.toFixed(3)}  <- the text-axis control`);
  console.log(`cross-voice/diff-text: ${crossDiffText.toFixed(3)}`);

  const failures: string[] = [];
  if (!(same > 0.5)) failures.push(`same-voice similarity ${same.toFixed(3)} <= 0.5 — the extractor does not recognise its own voice`);
  if (!(same > crossSameText + 0.15)) failures.push(`same-voice does not beat cross-voice by a margin (${same.toFixed(3)} vs ${crossSameText.toFixed(3)}) — it may be fingerprinting TEXT, not voice`);
  if (!(same > crossDiffText + 0.15)) failures.push(`same-voice does not beat cross-voice/diff-text by a margin`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exit(1);
  }
  console.log("PASS — the extractor separates voices, not sentences (synthetic-audio bound recorded in the header)");
} finally {
  await rm(dir, { recursive: true, force: true });
}
