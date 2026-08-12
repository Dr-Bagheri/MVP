// Spike item 3: Soniox async transcription — live.
//
//   node soniox.mjs <file.wav> [language]
//
// Key comes from the DPAPI store (never printed, never in argv/env dumps).
// Verifies: auth, the async job flow, WORD-LEVEL TIMESTAMPS (the M6 hard
// requirement), and speaker labels if the API returns them.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = "https://api.soniox.com";
const FILE = process.argv[2] ?? "two_speakers.wav";
const LANGUAGE = process.argv[3] ?? "fa";

function secret(name) {
  return execFileSync(
    "C:\\Users\\amirreza\\AppData\\Local\\NeurAI\\venv\\Scripts\\python.exe",
    ["-c", `from neurai.security import get_secret; print(get_secret('${name}'))`],
    { env: { ...process.env, NEURAI_DATA_DIR: "C:\\Users\\amirreza\\.neurai" }, encoding: "utf8" },
  ).trim();
}

const KEY = secret("soniox_key");
const auth = { Authorization: `Bearer ${KEY}` };

async function jsonOrThrow(res, what) {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${body.slice(0, 300)}`);
  try { return JSON.parse(body); } catch { return body; }
}

async function main() {
  const bytes = fs.readFileSync(FILE);
  console.log(`[soniox] file: ${FILE} (${(bytes.length / 1024 / 1024).toFixed(2)} MB), language hint: ${LANGUAGE}`);
  const t0 = Date.now();

  // 1. upload
  const form = new FormData();
  form.append("file", new Blob([bytes]), FILE);
  const up = await jsonOrThrow(
    await fetch(`${BASE}/v1/files`, { method: "POST", headers: auth, body: form }), "upload");
  const fileId = up.id;
  console.log(`[soniox] uploaded, file_id=${fileId} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  // 2. create transcription job
  const job = await jsonOrThrow(await fetch(`${BASE}/v1/transcriptions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      model: process.env.SONIOX_MODEL ?? "stt-async-preview",
      language_hints: [LANGUAGE],
      enable_speaker_diarization: true,
    }),
  }), "create job");
  console.log(`[soniox] job=${job.id} status=${job.status}`);

  // 3. poll
  let status = job.status;
  for (let i = 0; i < 150 && status !== "completed"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await jsonOrThrow(
      await fetch(`${BASE}/v1/transcriptions/${job.id}`, { headers: auth }), "poll");
    status = st.status;
    if (status === "error") throw new Error(`transcription error: ${st.error_message}`);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[soniox] status=${status} after ${elapsed}s`);

  // 4. transcript
  const out = await jsonOrThrow(
    await fetch(`${BASE}/v1/transcriptions/${job.id}/transcript`, { headers: auth }), "transcript");

  const tokens = out.tokens ?? [];
  console.log(`\n---- TEXT ----\n${(out.text ?? "").slice(0, 800)}`);
  console.log(`\n---- TOKENS: ${tokens.length} ----`);
  for (const t of tokens.slice(0, 12)) {
    console.log(`  ${String(t.start_ms).padStart(6)}–${String(t.end_ms).padStart(6)} ms  ` +
                `spk=${t.speaker ?? "-"}  ${JSON.stringify(t.text)}`);
  }
  const withTimes = tokens.filter((t) => Number.isFinite(t.start_ms) && Number.isFinite(t.end_ms));
  const monotonic = withTimes.every((t, i, a) => i === 0 || t.start_ms >= a[i - 1].start_ms);
  const speakers = new Set(tokens.map((t) => t.speaker).filter((s) => s != null));
  console.log(`\nword-level timestamps: ${withTimes.length}/${tokens.length} tokens ` +
              `(monotonic: ${monotonic})`);
  console.log(`distinct speakers labelled: ${speakers.size} ${[...speakers].join(",")}`);

  fs.writeFileSync("out/soniox.json", JSON.stringify(out, null, 1));
  console.log(`(full response → out/soniox.json)`);

  // 5. cleanup: don't leave audio sitting on a third-party server
  try {
    await fetch(`${BASE}/v1/transcriptions/${job.id}`, { method: "DELETE", headers: auth });
    await fetch(`${BASE}/v1/files/${fileId}`, { method: "DELETE", headers: auth });
    console.log("[soniox] remote file + transcription deleted");
  } catch (e) {
    console.log(`[soniox] cleanup warning: ${e.message}`);
  }
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
