/**
 * M38 prove-at-acceptance (rule 7's live half): a REAL Persian WAV through
 * the REAL Soniox realtime endpoint, from the box that will run the relay.
 *
 * Usage (on the server, with SONIOX_API_KEY in the environment):
 *   node core/scripts/live-stt-probe.mjs /path/to/audio.wav
 *
 * PASS = final tokens arrive and form non-empty text (printed to stdout —
 * this is an operator's acceptance run, not a service; nothing here logs).
 * The wav can come from the box's own TTS (piper /synthesize), closing the
 * loop: the platform speaks a sentence, the relay hears it back.
 */
import { readFileSync } from "node:fs";

const wavPath = process.argv[2];
const apiKey = process.env.SONIOX_API_KEY;
if (!wavPath || !apiKey) {
  console.error("usage: SONIOX_API_KEY=... node live-stt-probe.mjs <audio.wav>");
  process.exit(2);
}

const audio = readFileSync(wavPath);
const model = process.env.SONIOX_RT_MODEL ?? "stt-rt-preview";
const ws = new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket");

let finals = "";
const timeout = setTimeout(() => {
  console.error(`TIMEOUT — finals so far: "${finals}"`);
  process.exit(1);
}, 60_000);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    api_key: apiKey,
    model,
    audio_format: "auto",
    language_hints: ["fa", "en"],
    enable_language_identification: true,
  }));
  // stream in relay-sized chunks, lightly paced like a live mic
  let offset = 0;
  const pump = setInterval(() => {
    if (offset >= audio.length) {
      clearInterval(pump);
      ws.send(""); // the provider's end-of-audio
      return;
    }
    ws.send(audio.subarray(offset, offset + 16_000));
    offset += 16_000;
  }, 50);
});

ws.addEventListener("message", (event) => {
  const body = JSON.parse(String(event.data));
  if (body.error_code !== undefined) {
    console.error(`PROVIDER ERROR ${body.error_code}: ${body.error_message ?? ""}`);
    process.exit(1);
  }
  for (const token of body.tokens ?? []) {
    if (token.is_final) finals += token.text;
  }
  if (body.finished === true) ws.close();
});

ws.addEventListener("close", () => {
  clearTimeout(timeout);
  console.log(`TRANSCRIPT: ${finals}`);
  if (finals.trim().length === 0) {
    console.error("FAIL — the relay heard nothing (positive detection)");
    process.exit(1);
  }
  console.log("PASS — live relay leg proven");
  process.exit(0);
});

ws.addEventListener("error", () => {
  console.error("SOCKET ERROR");
  process.exit(1);
});
