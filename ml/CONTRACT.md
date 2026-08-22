# ml/ — the speech facade: contract

> **Status: DRAFT 1** — awaiting steward review. `core/worker` codes against
> this document. Architecture: M1 (ml/ shape), M6 (speech), M9 (stack),
> Invariant 6 (ml/ is productless).

**What ml/ is:** audio in → words + speakers out.

**What ml/ is not:** it has no database, no identity, no product credentials,
and no memory. It does not know what an org, a user, a call, or a part is. It
holds only its own upstream API keys. Nothing about a job survives the
response.

---

## 1. Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/process` | The whole job: transcode → VAD → transcribe → diarize. Synchronous. |
| `POST` | `/embed` | One speaker-embedding vector from audio (M39). Multipart `audio` file, or JSON `{audio_url\|audio_path, ranges?: [{start_ms,end_ms}], job_ref?}` — `ranges` (ms, file-relative) pick one voice's speech out of a longer take. Response: `{embedding, dim, model, speech_ms}`. The `model` name travels with every vector: vectors compare only within one model's space. Refuses < 1.5 s of audio (`bad_request`); `embedding_unavailable` (503, retryable) when the deployment carries no model; `/health.embedder` reports the capability. |
| `GET` | `/health` | Liveness + which lanes are configured. No secrets in the body. |

### `GET /health`

```json
{
  "ok": true,
  "version": "0.1.0",
  "ffmpeg": true,
  "lanes": { "soniox": "configured", "openrouter": "configured" },
  "diarizer": "sherpa-onnx|python|unavailable",
  "vad": "silero-vad-v5|energy-rms|unavailable",
  "vad_degraded": false
}
```

`configured` means a key is present — **never** whether it is valid, and never
any part of the key itself.

`vad` **names the engine and is not a boolean.** It used to be one, and the
boolean could never be false: the energy gate is an unconditional fallback, so
a box with no Silero model reported a healthy VAD while every job quietly ran
the degraded gate. `vad_degraded` is true when the fallback is what is running —
a legitimate configuration, reported rather than refused.

---

## 2. `POST /process`

### Request

Exactly one of three audio sources, checked in this order:

| Source | How | When to use |
|---|---|---|
| `multipart/form-data` field `audio` | raw bytes + `options` field (JSON string) | small files; tests |
| `audio_url` (JSON body) | a **pre-signed, self-authorizing** URL ml/ fetches | **production path** — the signed URL carries its own authority, so ml/ still holds no product credentials |
| `audio_path` (JSON body) | absolute path on a filesystem both processes see | local-dev profile (M12.1) and fixtures. Rejected unless `ML_ALLOW_LOCAL_PATHS=1` |

JSON body (`application/json`):

```jsonc
{
  "audio_url": "https://…",          // or audio_path
  "job_ref": "opaque-string",        // OPTIONAL. Log correlation only. Carries no
                                     // authority; ml/ attaches no meaning to it.
  "options": {
    "language_hints": ["fa", "en"],  // default ["fa", "en"] — Persian primary, M6
    "diarize": "auto",               // "auto" | "off" | "force"
    "max_speakers": 8,               // hint for clustering; ignored when 2-channel
    "vad": true,                     // trim silence before paid STT
    "lane": null                     // null = policy order; or pin "soniox"/"openrouter"
  }
}
```

`diarize: "auto"` means: **2-channel audio takes speakers from the channels and
is never diarized** (M6); mono audio is diarized by clustering. `"force"`
diarizes even 2-channel input; `"off"` returns words with no speaker.

### Response `200`

```jsonc
{
  "job_ref": "opaque-string",
  "media": {
    "container": "matroska,webm",
    "codec": "opus",
    "duration_ms": 1830000,
    "channels": 2,
    "sample_rate_in": 48000
  },
  "speech": {
    "speech_ms": 1520000,
    "silence_trimmed_ms": 310000,
    "segments": [ { "start_ms": 1200, "end_ms": 8400 } ]
  },
  "language": {
    "primary": "fa",
    "detected": [ { "code": "fa", "share": 0.94 }, { "code": "en", "share": 0.06 } ]
  },
  "words": [
    {
      "text": "سلام",
      "start_ms": 1200,
      "end_ms": 1480,
      "confidence": 0.98,   // null when the lane gives none
      "speaker": "S1",      // null when diarize:"off" and no channel speakers
      "channel": 0,         // null for mono
      "language": "fa"      // null when the lane gives none
    }
  ],
  "speakers": [ { "label": "S1", "channel": 0, "total_ms": 812000, "word_count": 1840 } ],
  "provenance": {
    "ml_version": "0.1.0",
    "transcode": { "tool": "ffmpeg", "version": "8.0.1" },
    "vad": { "engine": "silero-vad-v5", "threshold": 0.5 },
    "stt": {
      "lane": "soniox",
      "model": "stt-async-v5",
      "timestamps": "word",
      "attempts": [ { "lane": "soniox", "ok": true, "ms": 41200 } ]
    },
    "diarization": { "source": "channels", "engine": null }
  },
  "degraded": false,
  "warnings": []
}
```

### The five rules `core/worker` can rely on

1. **All timestamps are on the ORIGINAL input timeline.** Silence trimming and
   channel splitting are internal; ml/ maps every timestamp back before
   returning. `start_ms: 0` is the first sample of the file the caller gave us.
2. **Speaker labels are local and meaningless outside this response.** `S1`,
   `S2`, … number by first appearance. ml/ never names a person and never sees
   the org's speaker directory — linking is a product act (M11).
3. **`words` is ordered by `start_ms`**, and every word carries the fields
   above (nullable where the lane cannot supply them). Segments/turns are the
   product's to build — ml/ returns words, not lines.
4. **`provenance` is complete or the request fails.** Every derived artifact
   records what produced it (Invariant 4).
5. **`degraded: true` means the result did not meet the full contract** — see
   §3. `warnings` says why, in stable machine-readable codes.

---

## 3. Timestamp granularity and the degraded path

M6 requires **word-level timestamps**. The lanes differ:

| Lane | Timestamps | Diarization | Persian |
|---|---|---|---|
| **Soniox** (`stt-async-v5`) | **word** — `start_ms`/`end_ms` per token, always on | built in, up to 15 speakers | supported (`fa`) |
| **OpenRouter ASR** (fallback) | **none** — plain text only | none | works via auto-detect |

Two OpenRouter quirks carried over from Echo Mobile's working lane
(`Neurai-Echo/backend/worker/echo_worker/providers.py`, verified live
2026-08-09), so we do not rediscover them:

- **no `language` field** — the provider 400s on `language=fa`, while
  auto-detection transcribes Persian correctly;
- **`response_format: "json"` only** — `verbose_json` is unsupported by the ASR
  model, so there are no per-segment timings either.

Consequence: the fallback lane **cannot satisfy M6**. It produces
`timestamps: "none"`, `degraded: true`, and
`warnings: ["stt_no_word_timestamps"]`. Its words all carry the span of the
audio they were transcribed from — deliberately *not* a per-word estimate.
Spreading words evenly across a span would look like data and be fiction, and
proportional estimates were already a visible quality gap in Echo Mobile.

**Policy switch** `ML_REQUIRE_WORD_TIMESTAMPS` (default `0`): when set to `1`,
/process **fails** with `stt_no_word_timestamps` instead of returning a
degraded result.

> **RULED (steward, M6 — locked): degrade-and-flag.** A call is never lost
> because the only reachable lane cannot carry timings. The result comes back
> with `degraded: true` and `provenance.stt.timestamps: "none"`, and the
> product degrades **visibly**: the UI disables seeking on such parts, and
> core/worker queues the part for automatic re-transcription when the primary
> lane recovers. Honest degradation beats absence; **silent** degradation stays
> forbidden — which is exactly what the provenance block and the `degraded`
> flag exist to prevent. The flag must ride through core/worker to the UI.
>
> Measured, not assumed (Phase-0, real Persian audio): the OpenRouter lane
> returns prose only — no word timings, no line timings, no speaker labels.
> Chat-completions has nowhere to put them. So the degraded path is
> `timestamps: "none"`, never `"segment"`.

**What a degraded result still guarantees.** Timing-less prose is anchored, not
zeroed:

- every word carries the span of the audio it came from — first speech to last,
  or the whole file when the VAD contributed nothing;
- `end_ms > start_ms` always, for any input with real duration;
- `speech.segments` is never empty for audio that was transcribed.

`start_ms == end_ms == 0` would satisfy a NOT NULL column downstream while
meaning nothing, and the database could never report that it had gone wrong. A
coarse honest span degrades the reader's experience from click-a-word to
click-a-line; zeros seek to the head of the recording and read as a bug.

**The `has word timestamps` signal core/ should key off is
`provenance.stt.timestamps === "word"`** (with `degraded` as the coarse
boolean). Both ride in every response.

> **Boundary note for core/worker.** ml/ has no idea what a *part* is
> (Invariant 6). Every timestamp it returns is on the timeline of **the audio
> file it was handed**, where `0` is that file's first sample. Placing a part
> inside a call — adding `call_part.offset_ms` — is core/'s arithmetic, on both
> the full-fidelity and the degraded path. ml/ cannot do it without being told
> about parts, and being told about parts is exactly what it must not be.

---

## 3.1 What counts as a word

Soniox returns **tokens**, which are words *or sub-words*: measured on real
Persian audio, 280 tokens compose into 124 words. ml/ assembles them before
returning, because the transcript is the product's record — raw tokens would
hand the UI roughly three unclickable fragments per word and make tap-to-seek
useless.

The assembly rule, stated carefully because the obvious phrasing is a trap:

- a token whose text **begins with whitespace** starts a new word;
- a token that is **whitespace only** *is* a boundary — it starts the next
  word. **Do not filter separator tokens out as noise before applying the first
  rule**: that silently merges the words on either side of them. This is not
  hypothetical — it produced `figuresright` on a live run here;
- a **speaker change** starts a new word; one word cannot belong to two voices;
- `start_ms` comes from the word's first token, `end_ms` from its last, and
  confidence is the **weakest** of its pieces, not the strongest.

Anyone parsing this provider elsewhere should read the second rule twice.

---

## 4. Errors

Every failure returns a stable `error_type` and an explicit `retryable`, so the
DAG (M7) knows retry-with-backoff from dead-letter without parsing prose.

```json
{ "error_type": "stt_failed", "message": "lane exhausted", "retryable": true, "job_ref": "…" }
```

| `error_type` | HTTP | `retryable` | Meaning |
|---|---|---|---|
| `bad_request` | 400 | false | schema violation; no audio source, or two |
| `audio_source_forbidden` | 403 | false | `audio_path` without `ML_ALLOW_LOCAL_PATHS`, or `audio_url` host not allow-listed |
| `download_failed` | 502 | true | the pre-signed URL did not yield bytes |
| `unsupported_media` | 415 | false | ffmpeg cannot decode it — it is not audio |
| `media_too_long` | 413 | false | over `ML_MAX_DURATION_MS` (default 35 min: a 30-min part plus slack) |
| `transcode_failed` | 500 | true | ffmpeg failed on decodable input |
| `stt_unavailable` | 503 | true | no lane is configured |
| `stt_failed` | 502 | true | every lane attempted and failed; `attempts` details each |
| `stt_no_word_timestamps` | 422 | false | §3 policy switch; retrying changes nothing |
| `diarization_failed` | 500 | true | clustering step failed |
| `internal` | 500 | true | anything unclassified |

---

## 5. Configuration (env only — no secrets in the repo, M10)

| Var | Default | Purpose |
|---|---|---|
| `ML_PORT` | `7801` | listen port |
| `SONIOX_API_KEY` | — | primary lane. Absent → lane unconfigured |
| `OPENROUTER_API_KEY` | — | fallback lane |
| `ML_LANE_ORDER` | `soniox,openrouter` | attempt order |
| `ML_REQUIRE_WORD_TIMESTAMPS` | `0` | §3 — degrade-and-flag, in **every** deployment profile. `1` (refuse instead) is sanctioned **only** for CI and acceptance runs, where a contract regression should fail loudly rather than degrade quietly. Never set it in a deployment |
| `ML_ALLOW_LOCAL_PATHS` | `0` | enables `audio_path` |
| `ML_URL_ALLOWLIST` | — | comma-separated hosts `audio_url` may be fetched from. Empty = any host **only** when `ML_ALLOW_LOCAL_PATHS=1` (dev); in production an empty allow-list rejects every URL |
| `ML_MAX_DURATION_MS` | `2100000` | 35 minutes |
| `ML_MAX_BYTES` | `524288000` | 500 MB |
| `ML_WORK_DIR` | OS temp | per-job scratch, deleted in a `finally` |
| `ML_HOST` | `127.0.0.1` | listen address; ml/ is an internal service |
| `ML_FFMPEG_PATH` / `ML_FFPROBE_PATH` | from `PATH` | ffmpeg is **not vendored** — dev machines have it, container images install it |
| `ML_SILERO_MODEL` | — | `silero_vad.onnx`. Absent → the energy-gate fallback, and silence trimming gets weaker |
| `ML_DIARIZER` | `auto` | `auto` \| `off` |
| `ML_SEGMENTATION_MODEL` / `ML_EMBEDDING_MODEL` | — | local diarization ONNX models; both absent → no local diarizer |
| `ML_DIARIZER_THREADS` | `4` | measured optimum — 8 was **slower** (oversubscription). Never auto-set from core count |
| `ML_DIARIZER_THRESHOLD` | `0.5` | clustering threshold; M6 requires it tunable |
| `ML_STT_TIMEOUT_MS` | `900000` | ceiling on one lane's whole attempt |
| `ML_STT_POLL_MS` | `3000` | async-lane poll interval |
| `ML_LOG_LEVEL` | `info` | pino level |

ml/ reads **only these**. It is never given a database URL, a Supabase key, or
a product JWT — if one appears in its environment, that is a bug in the caller.

---

## 6. Logging

pino, structured, **no content ever** (Invariant 7). A job logs: `job_ref`,
step name, durations, byte counts, channel count, lane name, outcome, and
`error_type`. It never logs a transcript word, a filename from user input, an
audio path, a URL query string (signed URLs are credentials), or any part of a
key.

---

## 7. Deliberately not in v1

- **No streaming / live transcription** (M7 — user ruling). Soniox has a
  real-time model; the lane interface leaves room, nothing calls it.
- **No async job mode.** `/process` is synchronous by the steward's design:
  audio arrives, results return, nothing persists. If a 30-min part ever
  outruns a sane request timeout, the seam is `202 + /jobs/{id}` — a change to
  this document, not to the steps behind it.
- **No self-hosted STT.** Later, behind the same `SttLane` interface (M6).
- **No speaker identification.** ml/ separates voices; naming them is the
  product's job (M11 — the directory is built from deliberate acts).
