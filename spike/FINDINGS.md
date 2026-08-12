# Phase 0 spike — findings (2026-08-12)

Measured, not assumed. Working dir `mvp/spike/` (throwaway). Machine: Windows
11, Node v22.13.0, CPU-only.

---

## 1. Pi harness + our permission wall (M4) — **VERDICT: embeds cleanly, adopt**

`@earendil-works/pi-agent-core` + `pi-ai` v0.84.1 (98 packages, 0 vulns).
Ran a real 4-turn OpenRouter loop with two fake domain tools
(`search_calls`, `read_window`), one wrapper carrying caller identity, and a
deliberately hostile prompt (asked the model to read another org's call and
an `admin-*` window). Script: `pi-wall.mjs`.

**Can our wrapper intercept EVERY tool call? YES — two independent layers.**

1. **Our wrapper** (`scoped()`): tools are only ever constructed through it,
   so Pi never receives an unwrapped tool. It closes over the caller, filters
   by org *in code*, and appends every attempt to an audit array — the M4
   `agent_runs` analogue. Measured: 4 attempted calls, 2 allowed, 2 denied.
2. **Pi's own `beforeToolCall` / `afterToolCall` hooks** (`AgentLoopConfig`) —
   a documented, first-class interception point. `beforeToolCall` receives
   `{assistantMessage, toolCall, args, context}` and returning
   `{block: true, reason}` stops execution dead; the loop turns it into an
   error tool result the model then reads. Measured: 8 hook fires, 1 policy
   block on `admin-7`.

This is better than the brief assumed: the steward's note said "Pi ships no
permission system by design; the scope wall is ours" — true, but Pi ships the
*mount points* for one. Our wall gets a central veto without wrapping every
tool twice.

**Leak check:** the other org's transcript text never entered the message
history (asserted on the final transcript). Both denial paths return the same
"call not found" shape — ownership isn't probeable, matching the platform's
existing discipline.

**Model swap mid-session? YES.** `prepareNextTurn` returns
`{model, context?, thinkingLevel?}` between turns. Measured a live swap after
turn 1: `google/gemini-3.6-flash → openai/gpt-5-mini`, same session, same
tools, conversation continued correctly and the final answer was coherent
across the boundary.

**Bonus finding (M5 relevance):** `pi-ai` ships a *generated model catalogue* —
39 providers, **335 OpenRouter models** — with `builtinModels()` /
`getBuiltinModel()`. M5's "admin-curated catalogue, tool-capable only" gets its
data source for free; we filter, we don't build.

**Friction, honestly:**

- **ESM-only, no CJS.** `require()` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
  Fine for our Next/Fastify stack; worth knowing.
- **`npm i` postinstall needs `node` on PATH** — failed under the Git-Bash
  environment, worked from PowerShell. CI note, not a defect.
- **Hand-rolling a provider is a trap.** `createProvider({api: "openai-completions"})`
  looks right and yields `Unknown provider: openrouter` at stream time —
  `api` wants a `ProviderStreams` *implementation*, and `createModels()` takes
  no `providers` option (you call `setProvider`). **Use `builtinModels()`**;
  30 minutes lost here.
- **Reasoning-mandatory models need an explicit level.** Pi defaults to no
  reasoning; `google/gemini-3.x` on OpenRouter then 400s with "Reasoning is
  mandatory for this endpoint and cannot be disabled." Fix: `reasoning: "low"`
  in the loop config. Our catalogue filter should carry a per-model
  "reasoning required" flag or default the level.
- **Errors are in-band, not thrown.** A failed LLM call arrives as an
  `AssistantMessage` with `stopReason: "error"` and `errorMessage`; the loop
  returns normally with an empty answer. Silent-looking failure if you don't
  subscribe to `message_end`. Our runtime must surface that explicitly.

**Ergonomics verdict:** good. ~90 lines from zero to a working scoped agent;
types are thorough and documented in the `.d.ts`; the event stream
(`agent_start/turn_start/message_*/tool_execution_*/turn_end/agent_end`) maps
cleanly onto SSE for M9's streaming.

---

## 2. Node diarization quality (M1/M9 — decides ml/'s language) — **VERDICT: Node is viable; recommend Node, with a caveat**

`sherpa-onnx-node` (2 packages) + `pyannote-segmentation-3.0` (5.7 MB) +
`3D-Speaker eres2net` embeddings (37.8 MB). Script: `diarize.mjs`.

**Does it run in pure Node on Windows CPU? YES.** Prebuilt native binding
installed and loaded first try — no Python, no build toolchain, no
node-gyp. Exposes `OfflineSpeakerDiarization`, `SpeakerEmbeddingExtractor`,
`SpeakerEmbeddingManager`, `Vad` (the last one covers M6's Silero VAD need
in the same dependency).

**Is the clustering sane? PERFECT on this material.** Ground truth: TTS
male/female strictly alternating turns.

| Test | Audio | Segments | Speakers found | Turn alternation |
|---|---|---|---|---|
| known count (2) | 72.9 s | 20 | 2 ✓ | 19/19 ✓ |
| **auto-cluster (-1)** | 72.9 s | 20 | **2 ✓** | 19/19 ✓ |
| auto-cluster, int8 seg | 72.9 s | 20 | 2 ✓ | 19/19 ✓ |
| auto-cluster, 11 min | 655.9 s | 180 | **2 ✓** | 179/179 ✓ |

20 diarized turns for 20 TTS parts; 180 for 180. Auto-clustering (threshold
0.5, speaker count unknown — the production case) found exactly 2 both times.
Boundaries land tightly on the turns (e.g. `S0 0.03→2.48`, `S1 3.22→5.84`).

**Wall clock for 10 minutes of audio: ~4 minutes (RTF 0.41).**
Measured 268.5 s for 655.9 s of audio, 4 threads. Short-file RTF was 0.30;
the long run is the honest number. Notes: `int8` segmentation gave **no**
speedup (0.339 vs 0.332 — embeddings dominate); **8 threads was *slower***
than 4 (0.453 vs 0.332) — oversubscription on this box. Model load is 0.5 s,
amortized by a warm worker.

Against M7's 30-minute parts: ~12 minutes of CPU per part, which is a
background-job cost, not an interactive one — acceptable, but it is the
pipeline's heaviest CPU stage and wants its own worker concurrency budget.

**The caveat, stated plainly:** this was *clean synthetic TTS* — two
maximally distinct voices, no overlap, no far-field noise, English. It proves
the **plumbing and the clustering algorithm**, not real-meeting robustness.
Real Persian room audio (the PSRB-style hard case) can degrade any diarizer.
The honest reading: **Node is not the risk — the models are**, and they are
the *same ONNX models* Python would run. sherpa-onnx is a thin binding over
identical inference.

**Recommendation for ml/:** go **Node/TypeScript** (M9's TypeScript-first
default holds; no Python process, no second runtime in the deploy). Keep the
Python escape hatch documented but unused unless a *measured* quality gap on
real recordings appears — and if it does, the fix is likely a different
model, not a different language. Re-run this exact script on the first real
Persian recording as the confirmation gate.

---

## 3. Soniox Persian — **API CONTRACT VERIFIED; transcription blocked on account balance**

Key retrieved from the DPAPI store (never printed). Live run with
`soniox.mjs` against a 25 s synthetic clip:

```
[soniox] uploaded, file_id=… (1.1s)          ← auth OK, upload OK
[soniox] job=… status=queued                 ← job creation OK
FAILED: Organization balance exhausted. Please either add funds
        manually or enable autopay.
```

**What this DID settle** (worth having): the key is valid, and the async
contract in my stub was right on the first try — `POST /v1/files` (multipart)
→ `POST /v1/transcriptions` `{file_id, model, language_hints, enable_speaker_diarization}`
→ poll `GET /v1/transcriptions/{id}` → `GET /v1/transcriptions/{id}/transcript`,
with `DELETE` on both resources. The failure is **billing, not shape**: the
job reached `queued` and died at execution.

**What it did NOT settle:** Persian accuracy, word-timestamp quality, or the
head-to-head against an OpenRouter ASR lane — the actual questions. Those
need (a) funds on the Soniox org, and (b) a Persian clip.

**Remote hygiene:** the uploaded file and the errored job were deleted from
Soniox's servers (`soniox_cleanup.mjs`, both returned 204). Nothing of ours
is sitting on their infrastructure.

**On the Persian clip — a consent point, deliberately not decided here.**
The only real Persian audio on this machine is the user's own encrypted
meeting recordings (`~/.neurai/recordings/*.neura`). Sending those to a
third-party API is exactly the class of action the predecessor platform makes
consent-gated by architecture (D15: online mode **plus** explicit per-meeting
opt-in), so I did not do it unilaterally. The test clip should be either a
recording the user explicitly nominates, or a throwaway one recorded for the
purpose. **Blocked pending: funds + a nominated clip.**

---

## Files

| File | What |
|---|---|
| `pi-wall.mjs` | item 1 — scoped agent, wall, model swap (runs live) |
| `diarize.mjs` | item 2 — diarization + timing harness (`SEG_MODEL`/`THREADS` env) |
| `make_test_audio.ps1` | 2-voice TTS ground-truth generator |
| `soniox.mjs` | item 3 — live runner (key from DPAPI, never printed) |
| `soniox_cleanup.mjs` | deletes our files/jobs off Soniox's servers |
| `soniox_stub.mjs` | earlier stub, superseded by soniox.mjs |
| `out/diarization.json` | full segment output of the last run |
| `explore.mjs`, `debug1.mjs` | SDK surface exploration (kept: they document the friction) |

Not committed: `node_modules/` (144 MB), `models/` (52 MB), generated WAVs.
