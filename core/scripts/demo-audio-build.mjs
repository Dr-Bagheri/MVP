#!/usr/bin/env node
// Build the demo organisation's SPEECH — once, offline, per content pack.
//
//   node --experimental-strip-types scripts/demo-audio-build.mjs
//   node --experimental-strip-types scripts/demo-audio-build.mjs --lang fa
//   node --experimental-strip-types scripts/demo-audio-build.mjs --skip-upload
//   node --experimental-strip-types scripts/demo-audio-build.mjs --out <dir>
//
// WHY THIS IS A SCRIPT AND NOT PART OF THE SEED (M52). Synthesis needs the
// network, a paid provider, ffmpeg and about a minute per record. A seed
// that did it would be slow, non-deterministic, and would fail in a demo
// because a TTS endpoint was rate-limiting — at the moment somebody is
// standing in front of a customer. So speech is generated ONCE, the measured
// timings are committed into the pack as data, the wavs are committed to the
// repository under core/assets/demo-audio/<language>/<record>.wav (the SOURCE
// OF TRUTH), and seeding is a storage COPY plus rows that already know where
// the audio landed. `_demo/<language>/<record>/part-N.wav` in `call-audio` is
// a CACHE: the seeder fills it from the bundled file on the first seed of a
// deployment (src/api/demo-seed/assets.ts), so production needs no manual
// upload. This script still uploads when it has credentials — a warm cache
// on the dev project — but the upload is a convenience, not a step anyone
// has to remember.
//
// THE VOICES (Soniox Text-to-Speech, model `tts-rt-v2`, 2026-09-09). Every
// Soniox voice speaks every supported language with the same timbre, so the
// SAME three voices carry both packs — the Persian demo and the English demo
// are one cast, which is what "the same demo in two languages" should sound
// like. The pack files name them; this header records the choice and why:
//
//   presenter (Sarah / سارا)            Emma   — female; smooth, relaxed,
//                                                confident, personable
//   NAI, the director                   Adrian — male; deep, focused, composed
//   Ms. Reynolds / خانم مرادی (pricing) Nina   — female; bright, youthful,
//                                                expressive — chosen to sit
//                                                far from Emma so a diarizer
//                                                and a listener both hear two
//                                                women, not one voice twice
//
// The list came from `GET https://api.soniox.com/v1/tts-models` (one entry
// per model, each carrying its `voices` with name, gender and description).
// The previous generator (edge-tts) had exactly two fa-IR voices, so the
// Persian pricing call's second woman was the presenter's voice pitched down;
// that asymmetry is gone and so are the pitch/rate offsets that carried it.
//
// WHAT IT DOES, in order, per record:
//   1. synthesise each dialogue line with Soniox (`POST https://tts-rt.soniox
//      .com/tts`, 16 kHz wav), CACHED by (voice, language, sha256 of the text)
//      so a re-run re-spends only on lines that changed; transient 429/5xx
//      and network faults retry with backoff, any other 4xx fails loudly with
//      the provider's own error_message and request_id;
//   2. normalise every clip to 16 kHz mono 16-bit PCM with ffmpeg — Soniox
//      streams its wav, so the RIFF/data sizes in its header are placeholders
//      (0xFFFFFFFF) and ffmpeg is what turns that into a header we can trust;
//   3. MEASURE it twice — ffprobe's duration and the PCM byte count must agree
//      within 5 ms, or the splice would drift and every click-to-seek after
//      the drift would land late; and refuse a line under 0.5 s or over 20 s,
//      because a clip that short is a provider that said nothing and one that
//      long is a line that was never a line;
//   4. splice: 600 ms of lead, then each clip followed by a 700 ms gap, 400 ms
//      of tail, into parts of at most six minutes;
//   5. write the parts, `timings.json`, the GENERATED module
//      src/api/demo-seed/audio.<language>.ts, and the bundled copy under
//      core/assets/demo-audio/<language>/ (the name comes from
//      `bundledDemoAudioFile`, the same function the seeder reads with);
//   6. upload each part with `x-upsert` and verify the object's size by
//      listing it back.
//
// Reads SONIOX_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_KEY from the
// environment or from ../.env.dev. Never prints a secret.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { ALL_PACKS } from "../src/api/demo-seed/packs.ts";
import { bundledDemoAudioFile } from "../src/api/demo-seed/pack.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
/** the committed recordings — what the seeder reads when the bucket is empty */
const ASSETS = resolve(here, "..", "assets", "demo-audio");
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const ONLY_LANG = flag("--lang", null);
const SKIP_UPLOAD = argv.includes("--skip-upload");
const OUT = resolve(flag("--out", join(tmpdir(), "neurai-demo-audio")));
// Where ffmpeg lives is a property of the MACHINE, so there is no default
// (same rule as NEURAI_PYTHON — see db/scripts/lib/neurai-python.mjs). Unset
// means "on PATH", which is the one guess that is true on more than one
// machine; a hardcoded home directory is true on exactly one and carries its
// owner's username into the repository.
const FFMPEG_DIR = flag("--ffmpeg-dir", process.env.FFMPEG_DIR ?? null);
const ffbin = (name) =>
  FFMPEG_DIR ? join(FFMPEG_DIR, process.platform === "win32" ? `${name}.exe` : name) : name;

const BUCKET = "call-audio";
const SAMPLE_RATE = 16000;
const GAP_MS = 700;
const LEAD_MS = 600;
const TAIL_MS = 400;
const PART_MAX_MS = 6 * 60 * 1000;
/** a line outside this window is a provider fault, not a measurement */
const LINE_MIN_MS = 500;
const LINE_MAX_MS = 20_000;

const TTS_URL = "https://tts-rt.soniox.com/tts";
const TTS_MODEL = "tts-rt-v2";
const TTS_ATTEMPTS = 5;

// ── env ────────────────────────────────────────────────────────────────────
for (const file of [resolve(repo, ".env.dev")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (v !== "" && process.env[k] === undefined) process.env[k] = v;
  }
}
const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const SONIOX_KEY = process.env.SONIOX_API_KEY ?? "";
const canUpload = !SKIP_UPLOAD && SUPABASE_URL !== "" && SERVICE_KEY !== "";
if (!SKIP_UPLOAD && !canUpload) {
  console.warn("  ! SUPABASE_URL / SUPABASE_SERVICE_KEY missing — nothing will be uploaded");
}

// ── wav helpers ────────────────────────────────────────────────────────────
function readPcm16k(file) {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`not a wav: ${file}`);
  }
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === "fmt ") {
      fmt = {
        format: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        rate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
    }
    if (id === "data") data = b.subarray(body, Math.min(body + size, b.length));
    p = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`wav without fmt/data: ${file}`);
  if (fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== SAMPLE_RATE || fmt.bits !== 16) {
    throw new Error(`wav is not 16 kHz mono 16-bit PCM: ${file} (${JSON.stringify(fmt)})`);
  }
  return data;
}

function wavFromPcm(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const msToBytes = (ms) => Math.round((ms / 1000) * SAMPLE_RATE) * 2;
const bytesToMs = (bytes) => Math.round((bytes / 2 / SAMPLE_RATE) * 1000);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function ffprobeMs(file) {
  const r = spawnSync(
    ffbin("ffprobe"),
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`ffprobe failed on ${file}: ${(r.stderr || r.error?.message || "").trim()}`);
  }
  const sec = Number(String(r.stdout).trim());
  if (!Number.isFinite(sec)) throw new Error(`ffprobe gave no duration for ${file}`);
  return Math.round(sec * 1000);
}

function ffmpegNormalize(input, output) {
  const r = spawnSync(
    ffbin("ffmpeg"),
    ["-y", "-v", "error", "-i", input, "-ac", "1", "-ar", String(SAMPLE_RATE),
     "-sample_fmt", "s16", "-f", "wav", output],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed on ${input}: ${(r.stderr || r.error?.message || "").trim()}`);
  }
}

// ── synthesis ──────────────────────────────────────────────────────────────
/**
 * The cache key is the whole request that decides the sound: voice, language,
 * speed, and the text itself. The file name is the text's hash rather than a
 * line number, so re-ordering the dialogue or moving a sentence between
 * records costs nothing, and editing one sentence costs exactly one call.
 */
function cachePath(pack, voice, text) {
  const key = sha256(Buffer.from(`${TTS_MODEL}|${voice.voice}|${pack.language}|${voice.speed ?? ""}|${text}`, "utf8"));
  const dir = join(OUT, "cache", pack.language, voice.voice);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${key}.wav`);
}

class TtsRefusal extends Error {}

/**
 * One line through Soniox. The text goes as UTF-8 JSON exactly as the pack
 * spells it — Persian letters, ZWNJ, Persian digits — because the provider
 * reads the language from the `language` field, not from the bytes, and any
 * "helpful" normalisation here would be audible without being visible.
 *
 * A 429 or a 5xx is the provider's moment, not ours: back off and retry. Any
 * other 4xx is OUR request being wrong (a voice that does not exist, a text
 * over the limit, a bad key) and retrying it would only spend the same
 * refusal five times, so it fails on the first with the provider's sentence.
 */
async function speak(pack, voice, text, out) {
  if (SONIOX_KEY === "") {
    throw new Error("SONIOX_API_KEY missing — set it in the environment or ../.env.dev");
  }
  const body = {
    model: TTS_MODEL,
    language: pack.language,
    voice: voice.voice,
    text,
    audio_format: "wav",
    sample_rate: SAMPLE_RATE,
  };
  if (voice.speed !== undefined) body.speed = voice.speed;
  const payload = JSON.stringify(body);

  let lastFault = null;
  for (let attempt = 1; attempt <= TTS_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(TTS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${SONIOX_KEY}`, "Content-Type": "application/json" },
        body: payload,
      });
    } catch (e) {
      lastFault = `network: ${e?.message ?? e}`;
      await backoff(attempt, lastFault);
      continue;
    }

    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      // the header is streamed with placeholder sizes; the magic is what we
      // can check here, ffmpeg re-measures the rest
      if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF") {
        const ct = res.headers.get("content-type") ?? "";
        throw new Error(`soniox returned ${bytes.length} B of ${ct || "unknown"} for a wav request`);
      }
      const tmp = `${out}.part`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, out);
      return;
    }

    const detail = await describeError(res);
    if (res.status === 429 || res.status >= 500) {
      lastFault = detail;
      await backoff(attempt, detail);
      continue;
    }
    throw new TtsRefusal(`soniox refused (${detail}) for ${pack.language}/${voice.voice}: ${text.slice(0, 60)}…`);
  }
  throw new Error(`soniox gave up after ${TTS_ATTEMPTS} attempts — last: ${lastFault}`);
}

async function describeError(res) {
  let text = "";
  try { text = await res.text(); } catch { /* the status is the message then */ }
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object" && j.error_message) {
      return `HTTP ${res.status} ${j.error_type ?? ""}: ${j.error_message} [request ${j.request_id ?? "?"}]`.trim();
    }
  } catch { /* not the JSON error shape */ }
  return `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
}

async function backoff(attempt, why) {
  if (attempt >= TTS_ATTEMPTS) return;
  const ms = Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
  console.warn(`  ~ soniox attempt ${attempt} failed (${why}); retrying in ${ms} ms`);
  await sleep(ms);
}

// ── storage ────────────────────────────────────────────────────────────────
const storageHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function storageUpload(path, bytes) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "PUT",
    headers: { ...storageHeaders, "content-type": "audio/wav", "x-upsert": "true" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`storage upload ${path}: HTTP ${r.status}`);
}

async function storageList(prefix) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...storageHeaders, "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
  });
  if (!r.ok) throw new Error(`storage list ${prefix}: HTTP ${r.status}`);
  const rows = await r.json();
  return Array.isArray(rows)
    ? rows.map((o) => ({ name: o.name, size: o.metadata?.size ?? null }))
    : [];
}

// ── build one record ───────────────────────────────────────────────────────
async function buildRecord(pack, record) {
  const dir = join(OUT, pack.language, record.key);
  mkdirSync(dir, { recursive: true });

  let made = 0;
  const clips = [];
  for (let i = 0; i < record.lines.length; i++) {
    const line = record.lines[i];
    const voice = record.voices[line.speaker];
    const raw = cachePath(pack, voice, line.text);
    const norm = join(dir, `line-${String(i).padStart(2, "0")}.wav`);
    if (!existsSync(raw) || statSync(raw).size === 0) {
      await speak(pack, voice, line.text, raw);
      made++;
    }
    if (!existsSync(norm) || statSync(norm).mtimeMs < statSync(raw).mtimeMs) {
      ffmpegNormalize(raw, norm);
    }
    const pcm = readPcm16k(norm);
    const probed = ffprobeMs(norm);
    const counted = bytesToMs(pcm.length);
    // two instruments, one fact — a disagreement here means the splice would
    // drift, and a drifting splice is a click that lands on the wrong sentence
    if (Math.abs(probed - counted) > 5) {
      throw new Error(`${pack.language}/${record.key} line ${i}: ffprobe ${probed} ms vs PCM ${counted} ms`);
    }
    if (probed < LINE_MIN_MS || probed > LINE_MAX_MS) {
      throw new Error(`${pack.language}/${record.key} line ${i}: ${probed} ms is outside ${LINE_MIN_MS}–${LINE_MAX_MS} ms (${voice.voice}: ${line.text.slice(0, 50)}…)`);
    }
    clips.push({ i, speaker: line.speaker, pcm, ms: probed });
  }
  console.log(`  ${pack.language}/${record.key}: ${made} line(s) synthesised, ${clips.length - made} cached`);

  const parts = [];
  const lines = [];
  let part = null;
  let cursor = 0;
  const openPart = () => {
    part = {
      idx: parts.length,
      offsetMs: cursor,
      buffers: [Buffer.alloc(msToBytes(LEAD_MS))],
      within: LEAD_MS,
    };
    cursor += LEAD_MS;
    parts.push(part);
  };
  const closePart = () => {
    part.buffers.push(Buffer.alloc(msToBytes(TAIL_MS)));
    part.within += TAIL_MS;
    cursor = part.offsetMs + part.within;
    part.pcm = Buffer.concat(part.buffers);
    part.durationMs = bytesToMs(part.pcm.length);
    delete part.buffers;
  };
  openPart();
  for (const c of clips) {
    if (part.within + c.ms + GAP_MS + TAIL_MS > PART_MAX_MS) {
      closePart();
      openPart();
    }
    const startMs = part.offsetMs + part.within;
    lines.push({ startMs, endMs: startMs + c.ms, partIdx: part.idx });
    part.buffers.push(c.pcm, Buffer.alloc(msToBytes(GAP_MS)));
    part.within += c.ms + GAP_MS;
  }
  closePart();

  const written = [];
  const bundleDir = join(ASSETS, pack.language);
  mkdirSync(bundleDir, { recursive: true });
  for (const p of parts) {
    const file = join(dir, `part-${p.idx}.wav`);
    const wav = wavFromPcm(p.pcm);
    writeFileSync(file, wav);
    const probed = ffprobeMs(file);
    if (Math.abs(probed - p.durationMs) > 5) {
      throw new Error(`${pack.language}/${record.key} part ${p.idx}: ffprobe ${probed} ms vs splice ${p.durationMs} ms`);
    }
    // the repository copy — the seeder's source of truth; written AFTER the
    // probe so a part that failed measurement never lands in the bundle
    const bundled = join(bundleDir, bundledDemoAudioFile(record.key, p.idx));
    writeFileSync(bundled, wav);
    console.log(`  bundled ${bundled} (${wav.length} B)`);
    written.push({
      idx: p.idx,
      offsetMs: p.offsetMs,
      durationMs: p.durationMs,
      byteSize: wav.length,
      sha256: sha256(wav),
      file,
      bytes: wav,
    });
  }

  const totalMs = written.reduce((a, p) => Math.max(a, p.offsetMs + p.durationMs), 0);
  const audio = {
    totalMs,
    parts: written.map(({ file: _f, bytes: _b, ...rest }) => rest),
    lines,
  };
  writeFileSync(join(dir, "timings.json"), `${JSON.stringify(audio, null, 1)}\n`, "utf8");
  return { audio, written };
}

// ── the generated module ───────────────────────────────────────────────────
function writeAudioModule(pack, byRecord) {
  const upper = pack.language.toUpperCase();
  const body = [
    "/**",
    " * GENERATED — do not hand-edit.",
    " *",
    ` * Written by core/scripts/demo-audio-build.mjs from the ${pack.language === "fa" ? "Persian" : "English"} pack's own`,
    " * dialogue. Every number here is a MEASUREMENT of speech that exists: the",
    ` * generator synthesises each line with Soniox Text-to-Speech (${TTS_MODEL}),`,
    " * normalises it to 16 kHz mono 16-bit PCM, measures it twice (ffprobe's",
    " * duration and the PCM byte count must agree), splices the lines with a",
    " * 700 ms gap, and records where each one landed. Those are the timings the",
    " * transcript seeks to, so a hand-edit here is a click that lands on the",
    " * wrong sentence.",
    " *",
    ` * The bytes themselves ship in the repository under core/assets/demo-audio/${pack.language}/`,
    ` * <record>.wav and are cached in Storage under \`_demo/${pack.language}/<record>/part-N.wav\``,
    " * by the first seed on a deployment (the sha256 here is what that seed",
    " * checks the bundled file against before uploading it); every seed then",
    " * COPIES the cached object into the organisation. Re-run the generator only",
    " * when the dialogue or the voices change.",
    " */",
    "",
    'import type { DemoAudio, DemoRecordKey } from "./pack.ts";',
    "",
    `export const AUDIO_${upper}: Record<DemoRecordKey, DemoAudio> = {`,
  ];
  for (const record of pack.records) {
    const a = byRecord.get(record.key);
    body.push(`  ${record.key}: {`);
    body.push(`    totalMs: ${a.totalMs},`);
    body.push("    parts: [");
    for (const p of a.parts) {
      body.push(
        `      { idx: ${p.idx}, offsetMs: ${p.offsetMs}, durationMs: ${p.durationMs}, byteSize: ${p.byteSize}, sha256: "${p.sha256}" },`,
      );
    }
    body.push("    ],");
    body.push("    lines: [");
    for (const l of a.lines) {
      body.push(`      { startMs: ${l.startMs}, endMs: ${l.endMs}, partIdx: ${l.partIdx} },`);
    }
    body.push("    ],");
    body.push("  },");
  }
  body.push("};", "");
  const out = resolve(here, "..", "src", "api", "demo-seed", `audio.${pack.language}.ts`);
  writeFileSync(out, body.join("\n"), "utf8");
  console.log(`  wrote ${out}`);
}

// ── main ───────────────────────────────────────────────────────────────────
const packs = ALL_PACKS.filter((p) => ONLY_LANG === null || p.language === ONLY_LANG);
if (packs.length === 0) {
  console.error(`no pack for --lang ${ONLY_LANG}`);
  process.exit(2);
}
console.log(`demo-audio-build: ${packs.map((p) => p.language).join(", ")} -> ${OUT}`);

for (const pack of packs) {
  const byRecord = new Map();
  const uploads = [];
  for (const record of pack.records) {
    const { audio, written } = await buildRecord(pack, record);
    byRecord.set(record.key, audio);
    for (const p of written) {
      uploads.push({ path: `_demo/${pack.language}/${record.key}/part-${p.idx}.wav`, ...p });
    }
    const mins = Math.floor(audio.totalMs / 60000);
    const secs = String(Math.round((audio.totalMs % 60000) / 1000)).padStart(2, "0");
    console.log(`  ${pack.language}/${record.key}: ${audio.parts.length} part(s), ${mins}m${secs}s, ${audio.lines.length} lines`);
  }
  writeAudioModule(pack, byRecord);

  if (canUpload) {
    for (const u of uploads) await storageUpload(u.path, u.bytes);
    // verify by LISTING it back — the upload's 200 says the request was
    // accepted, the listing says the object is there at the size we wrote
    for (const record of pack.records) {
      const prefix = `_demo/${pack.language}/${record.key}`;
      const objs = await storageList(prefix);
      for (const u of uploads.filter((x) => x.path.startsWith(`${prefix}/`))) {
        const name = u.path.slice(prefix.length + 1);
        const there = objs.find((o) => o.name === name);
        if (!there) throw new Error(`${u.path} is not in storage after upload`);
        if (Number(there.size) !== u.byteSize) {
          throw new Error(`${u.path}: storage says ${there.size} B, we wrote ${u.byteSize} B`);
        }
        console.log(`  storage ok: ${u.path} = ${there.size} B`);
      }
    }
  }
}
console.log("done");
