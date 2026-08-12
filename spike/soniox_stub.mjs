// Spike item 3: Soniox Persian ASR — BLOCKED on the account key.
//
// The harness call is stubbed to the shape M6 needs (word-level timestamps),
// so the moment the key arrives this runs unchanged:
//   SONIOX_KEY=... node soniox_stub.mjs clip.wav
//
// Soniox async flow: upload file → create transcription job → poll → fetch
// transcript with per-word start/end. Endpoints per their 2026 docs; verify
// against the live API when the key lands (that verification IS the task).
import fs from "node:fs";

const BASE = "https://api.soniox.com";
const KEY = process.env.SONIOX_KEY ?? "";
const FILE = process.argv[2] ?? "persian_clip.wav";

export async function transcribeSoniox(file, { model = "stt-async-preview", language = "fa" } = {}) {
  if (!KEY) throw new Error("SONIOX_KEY not set — item 3 is key-blocked");
  const headers = { Authorization: `Bearer ${KEY}` };

  // 1. upload
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)]), file);
  const up = await fetch(`${BASE}/v1/files`, { method: "POST", headers, body: form });
  if (!up.ok) throw new Error(`upload failed: ${up.status} ${await up.text()}`);
  const { id: fileId } = await up.json();

  // 2. create job
  const job = await fetch(`${BASE}/v1/transcriptions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, model, language_hints: [language] }),
  });
  if (!job.ok) throw new Error(`job failed: ${job.status} ${await job.text()}`);
  const { id: jobId } = await job.json();

  // 3. poll
  for (let i = 0; i < 120; i++) {
    const st = await (await fetch(`${BASE}/v1/transcriptions/${jobId}`, { headers })).json();
    if (st.status === "completed") break;
    if (st.status === "error") throw new Error(`transcription error: ${st.error_message}`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 4. fetch transcript (word-level timestamps — the M6 requirement)
  const out = await (await fetch(`${BASE}/v1/transcriptions/${jobId}/transcript`, { headers })).json();
  return {
    text: out.text,
    words: (out.tokens ?? []).map((t) => ({
      w: t.text, start_ms: t.start_ms, end_ms: t.end_ms, speaker: t.speaker,
    })),
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  transcribeSoniox(FILE)
    .then((r) => {
      console.log(`text: ${r.text.slice(0, 400)}`);
      console.log(`words: ${r.words.length}`);
      console.log(`first 10 word timings:`);
      for (const w of r.words.slice(0, 10)) console.log(`  ${w.start_ms}-${w.end_ms}ms  ${w.w}`);
      const monotonic = r.words.every((w, i, a) => i === 0 || w.start_ms >= a[i - 1].start_ms);
      console.log(`word timings monotonic: ${monotonic}`);
    })
    .catch((e) => { console.error(String(e.message)); process.exit(1); });
}
