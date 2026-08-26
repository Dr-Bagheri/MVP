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
 *
 * SPEAKERS (2026-08-26): the probe now sends the same
 * `enable_speaker_diarization` the relay sends, and reports the DISTINCT
 * speaker labels it saw. That second number is why this ran before the
 * relay changed: the realtime lane's captions are load-bearing, and a
 * config field the model refuses would kill them wholesale. Run it against
 * a multi-voice clip — one voice cannot tell "diarization works" from
 * "diarization silently returns nothing" (rule 7's positive detection).
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
/** distinct speaker labels the provider attached to final tokens */
const speakers = new Set();
/* the timeout REPORTS what it learned before giving up: a long clip runs
   past the window routinely, and a timeout that prints nothing about the
   speakers turns a real observation into a non-result */
const timeout = setTimeout(() => {
  console.error(`TIMEOUT — finals so far: "${finals}"`);
  console.error(`SPEAKERS SEEN: ${speakers.size} — ${[...speakers].join(", ") || "(none attached)"}`);
  process.exit(1);
}, Number(process.env.PROBE_TIMEOUT_MS ?? 60_000));

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    api_key: apiKey,
    model,
    audio_format: "auto",
    language_hints: ["fa", "en"],
    enable_language_identification: true,
    enable_speaker_diarization: true,
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
    if (token.speaker !== undefined && token.speaker !== null) {
      speakers.add(String(token.speaker));
    }
  }
  if (body.finished === true) ws.close();
});

ws.addEventListener("close", () => {
  clearTimeout(timeout);
  console.log(`TRANSCRIPT: ${finals}`);
  console.log(`SPEAKERS: ${speakers.size} — ${[...speakers].join(", ") || "(none attached)"}`);
  if (finals.trim().length === 0) {
    console.error("FAIL — the relay heard nothing (positive detection)");
    process.exit(1);
  }
  console.log("PASS — live relay leg proven");
  /* the speaker leg is REPORTED, not gated: a single-voice clip honestly
     yields one label, and failing the whole probe on that would make the
     acceptance run depend on which audio someone reached for */
  process.exit(0);
});

ws.addEventListener("error", () => {
  console.error("SOCKET ERROR");
  process.exit(1);
});
