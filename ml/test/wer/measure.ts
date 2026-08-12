// Persian accuracy, measured rather than asserted.
//
// A number needs a human-corrected reference transcript, which is the one
// thing this pipeline cannot produce for itself — so the harness is a
// FILL-IN-THE-REFERENCE exercise in two steps:
//
//   1. Emit what the lane heard, as a starting point to correct:
//        npx tsx test/wer/measure.ts <audio> --emit-reference refs/clip.txt
//   2. Correct that file by ear, then score against it:
//        npx tsx test/wer/measure.ts <audio> --reference refs/clip.txt
//
// Step 1 exists because correcting a transcript is far less work than typing
// one, and the difference decides whether the measurement ever gets done.
//
// It prints WER, the error breakdown, and — the part that is actually useful —
// every substitution, so a reader can see whether the lane is losing proper
// nouns (survivable, and Soniox's known weakness) or ordinary verbs (not).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildServer } from "../../src/server.js";
import { ProcessResponseSchema } from "../../src/schema.js";
import { wordErrorRate, normalizeFa, type AlignOp } from "./metric.js";

const args = process.argv.slice(2);
const audio = args[0];
const emitTo = flag("--emit-reference");
const referenceFile = flag("--reference");

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!audio || (!emitTo && !referenceFile)) {
  console.error(
    [
      "usage:",
      "  measure.ts <audio> --emit-reference <file>   # step 1: write what the lane heard",
      "  measure.ts <audio> --reference <file>        # step 2: score against your corrections",
    ].join("\n"),
  );
  process.exit(2);
}

if (!process.env.SONIOX_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.error("no lane key in the environment — set SONIOX_API_KEY");
  process.exit(2);
}

process.env.ML_ALLOW_LOCAL_PATHS = "1";
process.env.ML_LOG_LEVEL ??= "error";

const app = await buildServer();
const response = await app.inject({
  method: "POST",
  url: "/process",
  payload: { audio_path: path.resolve(audio), job_ref: "wer", options: { language_hints: ["fa", "en"] } },
});
await app.close();

if (response.statusCode !== 200) {
  console.error(`transcription failed (${response.statusCode}):`, response.json());
  process.exit(1);
}

const body = ProcessResponseSchema.parse(response.json());
const hypothesis = body.words.map((w) => w.text).join(" ");

if (emitTo) {
  await mkdir(path.dirname(path.resolve(emitTo)), { recursive: true });
  await writeFile(
    path.resolve(emitTo),
    [
      "# Reference transcript. Correct every line BY EAR against the audio,",
      "# then delete this header. Lines starting with # are ignored.",
      "#",
      "# Do not tidy the wording — a reference should record what was SAID,",
      "# including false starts and repetition. Cleaning it up measures the",
      "# lane against an edit rather than against the recording.",
      "#",
      `# audio : ${path.basename(audio)}`,
      `# lane  : ${body.provenance.stt.lane} (${body.provenance.stt.model})`,
      "",
      hypothesis,
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`\nwrote a starting reference to ${emitTo}`);
  console.log(`  ${body.words.length} words from ${body.provenance.stt.lane}`);
  console.log("  Correct it by ear, then re-run with --reference to get a number.\n");
  process.exit(0);
}

const raw = await readFile(path.resolve(referenceFile!), "utf8");
const reference = raw
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join(" ");

if (!normalizeFa(reference)) {
  console.error(`${referenceFile} has no reference text (only comments?)`);
  process.exit(2);
}

const result = wordErrorRate(reference, hypothesis);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log(`\n─── ${path.basename(audio)} · ${body.provenance.stt.lane} (${body.provenance.stt.model}) ───`);
console.log(`  reference   ${result.referenceWords} words`);
console.log(`  hypothesis  ${result.hypothesisWords} words`);
console.log(`  WER         ${pct(result.wer)}`);
console.log(
  `  errors      ${result.substitutions} substituted · ${result.deletions} deleted · ${result.insertions} inserted`,
);
console.log(`  accuracy    ${pct(result.hits / Math.max(1, result.referenceWords))} of reference words matched`);

const substitutions = result.ops.filter((op: AlignOp) => op.type === "sub");
if (substitutions.length > 0) {
  console.log("\n  substitutions (reference → heard):");
  for (const op of substitutions.slice(0, 40)) {
    console.log(`    ${op.reference}  →  ${op.hypothesis}`);
  }
  if (substitutions.length > 40) console.log(`    … and ${substitutions.length - 40} more`);
}

const dropped = result.ops.filter((op: AlignOp) => op.type === "del").map((op) => op.reference);
if (dropped.length > 0) {
  console.log(`\n  dropped: ${dropped.slice(0, 30).join(" · ")}${dropped.length > 30 ? " …" : ""}`);
}

console.log(
  "\n  Note: WER is computed after Persian normalization (ی/ک unification, ZWNJ,",
  "\n  harakat, digits, punctuation) — so this counts recognition errors, not",
  "\n  spelling conventions.\n",
);
