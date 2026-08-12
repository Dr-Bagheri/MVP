// Spike item 3b: the OpenRouter ASR head-to-head on the same clip.
//
// OpenRouter exposes audio to multimodal chat models via an `input_audio`
// content part (base64 + format). This is the M6 "OpenRouter ASR lanes"
// option — measured against Soniox on identical audio.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const FILE = process.argv[2] ?? "fixtures/persian-test-1.wav";
const MODEL = process.argv[3] ?? "google/gemini-3.6-flash";
const FORMAT = FILE.endsWith(".mp3") ? "mp3" : "wav";

const KEY = execFileSync(
  "C:\\Users\\amirreza\\AppData\\Local\\NeurAI\\venv\\Scripts\\python.exe",
  ["-c", "from neurai.security import get_secret; print(get_secret('openrouter_key'))"],
  { env: { ...process.env, NEURAI_DATA_DIR: "C:\\Users\\amirreza\\.neurai" }, encoding: "utf8" },
).trim();

const audio = fs.readFileSync(FILE).toString("base64");
console.log(`[or-asr] model=${MODEL} file=${FILE} (${(audio.length / 1.37 / 1024 / 1024).toFixed(2)} MB raw)`);

const t0 = Date.now();
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Transcribe this Persian audio verbatim. Output ONLY the transcript text, no commentary." },
        { type: "input_audio", input_audio: { data: audio, format: FORMAT } },
      ],
    }],
  }),
});

const body = await res.text();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
if (!res.ok) {
  console.log(`[or-asr] HTTP ${res.status} after ${elapsed}s\n${body.slice(0, 600)}`);
  process.exit(1);
}
const data = JSON.parse(body);
if (data.error) {
  console.log(`[or-asr] error body after ${elapsed}s: ${JSON.stringify(data.error).slice(0, 400)}`);
  process.exit(1);
}
const text = data.choices?.[0]?.message?.content ?? "";
console.log(`[or-asr] completed in ${elapsed}s, ${text.length} chars\n`);
console.log(text.slice(0, 1200));
console.log(`\n[or-asr] usage: ${JSON.stringify(data.usage ?? {})}`);
fs.writeFileSync("out/openrouter_asr.json", JSON.stringify({ model: MODEL, elapsed, text, usage: data.usage }, null, 1));
