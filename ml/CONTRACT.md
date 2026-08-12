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
| `GET` | `/health` | Liveness + which lanes are configured. No secrets in the body. |

### `GET /health`

```json
{
  "ok": true,
  "version": "0.1.0",
  "ffmpeg": true,
  "lanes": { "soniox": "configured", "openrouter": "configured" },
  "diarizer": "sherpa-onnx|python|unavailable",
  "vad": true
}
```

`configured` means a key is present — **never** whether it is valid, and never
any part of the key itself.

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
`timestamps: "none"`, words carrying the VAD segment's bounds rather than true
word bounds, `degraded: true`, and `warnings: ["stt_no_word_timestamps"]`.

**Policy switch** `ML_REQUIRE_WORD_TIMESTAMPS` (default `1`): when set,
/process **fails** with `stt_no_word_timestamps` instead of returning a
degraded result — the pipeline dead-letters the part rather than writing a
transcript that silently breaks click-a-word seeking.

> **STEWARD RULING NEEDED.** Default `1` is the M6-faithful reading: a
> transcript without word timestamps is not the record we promised. The
> alternative — degrade and let the user see *something* — is a product call,
> not mine. Flagging rather than deciding.

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
| `ML_REQUIRE_WORD_TIMESTAMPS` | `1` | §3 |
| `ML_ALLOW_LOCAL_PATHS` | `0` | enables `audio_path` |
| `ML_URL_ALLOWLIST` | — | comma-separated hosts `audio_url` may be fetched from. Empty = any host **only** when `ML_ALLOW_LOCAL_PATHS=1` (dev); in production an empty allow-list rejects every URL |
| `ML_MAX_DURATION_MS` | `2100000` | 35 minutes |
| `ML_MAX_BYTES` | `524288000` | 500 MB |
| `ML_WORK_DIR` | OS temp | per-job scratch, deleted in a `finally` |

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
