// CROSSTALK — what does the pipeline do when two people talk at once?
//
// ml/README recorded crosstalk as untested, and it is where diarizers actually
// fail. This measures it rather than reasoning about it.
//
// ── Why the fixture is synthetic, and what that costs ───────────────────────
//
// The real two-speaker Persian recording contains NO measurable overlap:
// Soniox returns strictly non-overlapping word spans, and consecutive speaker
// turns never cross (0 of 27 turn pairs overlap). It is a rapid conversation —
// median turn gap 0.18s — but the speakers take turns. So the clip cannot
// answer the question, and saying "tested on real audio" about it would be a
// lie of the most useful-sounding kind.
//
// Instead: take two long single-speaker passages FROM that real recording and
// mix them. Real voices, real Persian, real room — synthetic only in that the
// two passages never actually co-occurred. Labelled synthetic-with-method
// exactly so nobody later reads this as a field measurement.
//
// ── The control is the point ────────────────────────────────────────────────
//
// A crosstalk run on its own proves nothing: if the transcript comes back
// poor, that could be the overlap or it could be that these two passages are
// simply hard. So the same two passages are also run CONCATENATED — identical
// speech, identical voices, identical duration of each source, differing only
// in whether they occur at the same time. The comparison is the measurement.
//
//   npx tsx test/smoke/crosstalk.ts <source-audio>
//
// Requires ml/ running (ML_BASE_URL) with a real STT key. Costs money.
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ffmpeg } from "../../src/audio/ffmpeg.js";

const exec = promisify(execFile);
const BASE = process.env.ML_BASE_URL ?? "http://127.0.0.1:7801";

const source: string = process.argv[2] ?? "";
if (!source) {
  console.error("usage: crosstalk.ts <source-audio>");
  process.exit(2);
}

/**
 * Two passages, chosen from the measured turn map of the source recording:
 * long, single-speaker, and different people. Not arbitrary — a passage that
 * silently contained a turn change would make the whole comparison meaningless.
 */
const A = { label: "speaker-A", startSec: 30.0, durSec: 10.0 };
const B = { label: "speaker-B", startSec: 55.5, durSec: 10.0 };

interface Result {
  words: number;
  speakers: string[];
  text: string;
  degraded: boolean;
  warnings: string[];
  timestamps: string;
  /** Mean per-word confidence, when the lane reports it. */
  meanConfidence: number | null;
  /** Share of words the lane was less than 70% sure of. */
  lowConfidenceShare: number | null;
}

async function process_(file: string, jobRef: string): Promise<Result> {
  const response = await fetch(`${BASE}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audio_path: file,
      job_ref: jobRef,
      options: { language_hints: ["fa"], diarize: "auto" },
    }),
  });
  if (!response.ok) throw new Error(`${jobRef}: HTTP ${response.status} ${await response.text()}`);
  const d = (await response.json()) as any;
  const confidences = d.words
    .map((w: any) => w.confidence)
    .filter((c: unknown): c is number => typeof c === "number");
  return {
    words: d.words.length,
    speakers: (d.speakers ?? []).map((s: any) => s.label),
    text: d.words.map((w: any) => w.text).join(""),
    degraded: Boolean(d.degraded),
    warnings: d.warnings ?? [],
    timestamps: d.provenance?.stt?.timestamps ?? "?",
    meanConfidence: confidences.length
      ? confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length
      : null,
    lowConfidenceShare: confidences.length
      ? confidences.filter((c: number) => c < 0.7).length / confidences.length
      : null,
  };
}

/** Longest common subsequence ratio — how much of `ref` survives in `hyp`. */
function survival(ref: string, hyp: string): number {
  const a = [...ref.replace(/\s+/g, "")];
  const b = [...hyp.replace(/\s+/g, "")];
  if (a.length === 0) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length]! / a.length;
}

async function main(): Promise<void> {
  const bin = await ffmpeg();
  const dir = await mkdtemp(path.join(os.tmpdir(), "crosstalk-"));
  const src = path.resolve(source);

  const cut = async (spec: typeof A, out: string) => {
    await exec(bin, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(spec.startSec), "-t", String(spec.durSec), "-i", src,
      "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out,
    ]);
  };

  const aFile = path.join(dir, "a.wav");
  const bFile = path.join(dir, "b.wav");
  await cut(A, aFile);
  await cut(B, bFile);

  // OVERLAID: both at once, equal gain (amix normalises by input count, so
  // neither voice is louder than the other and nothing clips).
  const mixed = path.join(dir, "crosstalk.wav");
  await exec(bin, [
    "-hide_banner", "-loglevel", "error", "-y", "-i", aFile, "-i", bFile,
    "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest",
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", mixed,
  ]);

  // CONTROL: the same two passages, one after the other.
  const seq = path.join(dir, "sequential.wav");
  await exec(bin, [
    "-hide_banner", "-loglevel", "error", "-y", "-i", aFile, "-i", bFile,
    "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", seq,
  ]);

  console.log(`fixture: SYNTHETIC (overlay of two real passages from ${path.basename(src)})`);
  console.log(`  A = ${A.startSec}s +${A.durSec}s, B = ${B.startSec}s +${B.durSec}s, equal gain\n`);

  const alone = { a: await process_(aFile, "ct-a"), b: await process_(bFile, "ct-b") };
  const control = await process_(seq, "ct-sequential");
  const crosstalk = await process_(mixed, "ct-overlap");

  const pct = (v: number | null) => (v === null ? "  n/a" : `${(v * 100).toFixed(0).padStart(3)}%`);
  const row = (name: string, r: Result) =>
    console.log(
      `  ${name.padEnd(22)} words ${String(r.words).padStart(3)}   speakers ${
        r.speakers.length
      } [${r.speakers.join(",")}]   conf ${pct(r.meanConfidence)}   low-conf ${pct(
        r.lowConfidenceShare,
      )}   degraded=${r.degraded}   ${r.warnings.join(",") || "-"}`,
    );

  console.log("── each passage alone (the reference) ──");
  row("A alone", alone.a);
  row("B alone", alone.b);
  console.log("\n── CONTROL: sequential (same speech, no overlap) ──");
  row("A then B", control);
  console.log("\n── CROSSTALK: overlaid ──");
  row("A over B", crosstalk);

  const sA = survival(alone.a.text, crosstalk.text);
  const sB = survival(alone.b.text, crosstalk.text);
  const cA = survival(alone.a.text, control.text);
  const cB = survival(alone.b.text, control.text);

  console.log("\n── how much of each speaker survives ──");
  console.log(`  sequential : A ${(cA * 100).toFixed(0)}%   B ${(cB * 100).toFixed(0)}%`);
  console.log(`  crosstalk  : A ${(sA * 100).toFixed(0)}%   B ${(sB * 100).toFixed(0)}%`);

  console.log("\n── verdict ──");
  const both = sA > 0.5 && sB > 0.5;
  const one = (sA > 0.5) !== (sB > 0.5);
  if (both) console.log("  BOTH speakers survive the overlap.");
  else if (one) console.log(`  ONE speaker survives, the other is lost (A ${(sA*100).toFixed(0)}% / B ${(sB*100).toFixed(0)}%).`);
  else console.log("  NEITHER speaker survives intact — the overlap garbles both.");
  console.log(
    `  Degradation declared by the pipeline: degraded=${crosstalk.degraded}, warnings=[${crosstalk.warnings.join(",") || "none"}]`,
  );
  console.log(
    "  M21 reading: losing a speaker is a forfeit of the user's DATA, and is only\n" +
      "  acceptable if it is declared. Compare the two lines above.",
  );

  console.log(`\n  crosstalk transcript (first 200 chars):\n  ${crosstalk.text.slice(0, 200)}`);

  await rm(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error("crosstalk smoke failed:", (e as Error).message);
  process.exit(1);
});
