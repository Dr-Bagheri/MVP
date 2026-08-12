# ml/ — the speech facade

Audio in → words + speakers out. That is the whole job.

**[CONTRACT.md](CONTRACT.md) is the interface** `core/worker` codes against.
This file is how to run it.

ml/ is **productless** (Invariant 6): no database, no identity, no product
credentials, no memory. It does not know what an org, a user, a call, or a part
is. Nothing about a job survives the response.

## Run it

```bash
npm install
cp .env.example .env.local     # fill in SONIOX_API_KEY
npm run dev                    # http://127.0.0.1:7801
```

Requires **Node 22+** and **ffmpeg/ffprobe on PATH** (or `ML_FFMPEG_PATH`).
`GET /health` tells you what is actually wired up.

The VAD model is **not in the repo** (2.3 MB binary, git-ignored). Fetch it once:

```bash
curl -L -o models/silero_vad.onnx https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx
```

then point `ML_SILERO_MODEL` at it. Without it ml/ still runs, on an energy
gate that trims less and therefore costs more per call.

Local diarization needs two more (~44 MB, also git-ignored) — only for **mono**
audio on a lane that does not diarize, since Soniox does and two-channel audio
takes speakers from the channels:

- [`sherpa-onnx-pyannote-segmentation-3-0`](https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2) → `models/segmentation.onnx`
- [`3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`](https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx) → `models/embedding.onnx`

(The `recongition` typo is upstream's, not ours.)

## Test it

```bash
npm test
```

75 tests, no network and no keys — the STT lanes are stubbed. ffmpeg-dependent
suites skip themselves when ffmpeg is missing rather than failing.

Audio fixtures are **generated, never committed**: `test/helpers.ts` builds
tones and silence from a formula, so a failing assertion points at a number you
can read instead of an opaque binary.

The live acceptance smoke is separate, deliberate, and costs real money:

```bash
npx tsx test/smoke/persian-live.ts <audio-file>
```

## Shape

```
src/
  server.ts      POST /process · GET /health — the entire surface
  pipeline.ts    transcode → VAD → transcribe → diarize
  timeline.ts    maps trimmed timestamps back onto the ORIGINAL audio
  schema.ts      zod, both directions: the contract cannot drift silently
  errors.ts      stable error_type + retryable, for the M7 DAG
  audio/         ffmpeg (any format → 16k PCM), WAV reader, source resolution
  vad/           Silero ONNX, energy fallback, shared segmentation
  stt/           SttLane interface · Soniox (primary) · OpenRouter (fallback)
  diarize/       Diarizer interface · sherpa-onnx · speaker assignment
```

Every provider sits behind an interface, so swapping one — a self-hosted STT, a
different diarizer, the Python escape hatch of M1/M9 — changes one file and
nothing above it.

## Two things to know before changing anything

**Timestamps are on the original timeline.** VAD cuts silence out before the
paid STT call, so the provider's timestamps are on a shortened file.
`TimelineMap` puts them back. If you add a step that reshapes audio, it maps
its timestamps back too, or click-a-word seeking breaks in a way no test above
this layer will catch.

**Content never reaches a log** (Invariant 7). Not a transcript word, not a
filename, not a URL — a pre-signed URL *is* a credential. Log the host, the
byte count, the duration, the outcome. The live smoke prints transcript
excerpts because a human has to read them; the service never does.

**Negative tests do not cover a model.** Silero was fed the wrong frame size
for a while — v5 wants 64 samples of the previous frame prepended, its context
dimension is dynamic so the wrong shape is *accepted*, and it scored real
speech at 0.0003 while every unit test stayed green. All of them asserted what
the VAD must **not** detect, which a broken model satisfies perfectly. Positive
validation needs real speech and lives in the live smoke.

## Verified on real audio

- **Persian, live through Soniox** (86.5 s consented clip): word timestamps,
  correct ZWNJ, colloquial register preserved, English tech terms transliterated
  the way speakers actually say them. 280 sub-word tokens assembled into **124
  words** — matching the Phase-0 spike's independent count exactly. Proper nouns
  are the weak spot (`اکو` came back wrong); that is a provider limit, not ours.
- **Diarization**: 2 speakers discovered in the two-voice clip (19 of 20 turn
  changes correct) and **1 speaker in the Persian monologue** — it did not
  invent a second voice, which is the failure that would matter most.
- **VAD**: trims ~11 % of a real recording with the transcript unchanged.

## Current gaps

- **Diarization is unmeasured on hard audio.** Everything above is one clean
  voice per clip, no overlap, no far-field noise. Crosstalk, same-gender voices
  and room noise are where diarizers actually fail, and none of that has been
  tested. The `Diarizer` interface stays swappable for exactly this reason.
- **RTF numbers size nothing.** Diarization measured 0.24–0.41× realtime here,
  but the same file swung 6× under CPU contention. Measure on the deployment
  box before setting worker concurrency.
- **The OpenRouter fallback carries no timings at all** — not even line-level
  (chat-completions has nowhere to put them). Parts transcribed that way come
  back `degraded` with `timestamps: "none"` so the UI can disable seeking.
