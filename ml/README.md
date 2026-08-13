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

No network and no keys — the STT lanes are stubbed. ffmpeg-dependent suites
skip themselves when ffmpeg is missing rather than failing.

(The count is deliberately not written here. It said 75 for long enough to be
wrong by a third, and a number a human has to remember to update is a number
that will be wrong again; `npm test` prints the real one.)

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
- **Diarization**: **1 speaker in the Persian monologue** — it did not invent a
  second voice, which is the failure that would matter most. Re-confirmed since
  at every clustering threshold from 0.5 to 1.15.
  - An earlier line here claimed "2 speakers discovered in the two-voice clip,
    19 of 20 turn changes correct". Its provenance is ambiguous — it predates
    the delivery of `persian-2voice-1.mp3`, so it likely refers to the spike's
    synthetic TTS pair rather than to any real recording. **Left unasserted
    rather than restated**, because the one claim of that shape that could be
    checked turned out to rest on a filename (below).
- **VAD**: trims ~11 % of a real recording with the transcript unchanged.

## Current gaps

- **Crosstalk loses roughly a third of the words, and nothing says so.**
  Measured (`test/smoke/crosstalk.ts`) by overlaying two real single-speaker
  passages at equal gain and comparing against the *same two passages played
  sequentially* — identical speech, identical voices, only the overlap differs:

  | | words | speakers | mean confidence |
  |---|---|---|---|
  | sequential (control) | 37 | 2 | 86 % |
  | overlaid (crosstalk) | 26 | 2 | 82 % |

  Both voices are still detected and the transcript interleaves them, so it is
  not garbled — it reads as a perfectly ordinary conversation with **30 % of
  the words missing**. `degraded` stays `false` and `warnings` stays empty.
  Confidence is *not* a usable detector: the 4-point drop sits inside the
  normal spread between clips (85 %, 84 %, 86 % on non-overlapping audio).
  So this is a real forfeit of the user's data that the pipeline currently
  cannot see and therefore cannot declare (M21). **The fixture is synthetic
  with its method recorded** — the real recording contains no measurable
  overlap at all (0 of 27 consecutive turn pairs cross in time).
- **Same-gender voices and far-field noise are still unmeasured.** The
  `Diarizer` interface stays swappable for exactly this reason.
- **A recorded caveat here was wrong, and the way it was wrong is the lesson.**
  This section used to say the local diarizer over-splits real conversation and
  that "no threshold yields 2". The ground truth of *2* came from the file's
  NAME — `persian-2voice-1.mp3` is a **four-person** conversation, which Soniox
  and the local diarizer independently agree on. The over-split was a
  clustering threshold set five times too low (`0.5`, validated by the spike on
  synthetic TTS); at `1.0` the count is right within one, and on single-speaker
  audio the threshold changes nothing at all. Default moved 0.5 → 1.0; the
  measured curve and its conditions are in `test/smoke/diarizer-threshold.ts`.
- **RTF numbers size nothing.** Diarization measured 0.24–0.41× realtime here,
  but the same file swung 6× under CPU contention. Measure on the deployment
  box before setting worker concurrency.
- **The OpenRouter fallback carries no timings at all** — not even line-level
  (chat-completions has nowhere to put them). Parts transcribed that way come
  back `degraded` with `timestamps: "none"` so the UI can disable seeking.
