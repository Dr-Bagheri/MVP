# §3 (closing) — Soniox, the OpenRouter head-to-head, and the diarization gate

Run 2026-08-12 on `fixtures/persian-test-1.m4a` (86.5 s, mono AAC 140 kbps) —
a Persian clip the user supplied **with explicit consent for third-party
testing**. Audio is gitignored; it never enters the repo. Remote artifacts
were deleted after the run.

---

## 3a. Soniox live — **VERDICT: strong Persian; adopt as the primary lane**

`node soniox.mjs fixtures/persian-test-1.m4a fa` — model `stt-async-preview`,
`language_hints: ["fa"]`, diarization on.

| | |
|---|---|
| upload | 1.3 s |
| **transcription** | **10.2 s for 86.5 s of audio (~0.12× realtime)** |
| tokens | 280, **all 280 timestamped, monotonic** |
| speakers | 1 (correct — single-speaker clip) |
| remote cleanup | file + job deleted (204) |

**Persian quality — very good.** Judged against the audio:

- Correct ZWNJ throughout: «می‌خوایم», «خلاصه‌ی», «نرم‌افزار», «پایه‌ای‌ش».
- Colloquial register preserved as spoken («می‌خوایم», «رو», «تو مرحله‌ی»)
  rather than silently formalized — right call for a transcript; register
  conversion is a downstream choice.
- Proper name «دکتر باقری» correct.
- **Code-switching handled the way a Persian speaker actually talks**:
  English tech terms transliterated into Persian script — «فاندیشن»,
  «ای‌آی اسیستنت», «اسکیل‌ها», «رول‌ها», «منجمنت», «دیتابیس».
- One substantive error: the product name was heard as «انحصاری اکو»
  (correct: «اکو»). Proper-noun risk is the expected weak spot.

### Integration note that changes core/'s adapter (important)

**Soniox returns SUB-WORD tokens, not words.** 280 tokens → 124 words. The
composition rule is a leading space: 123 tokens begin with `" "` and each
starts a new word (+1 for the first). Example: `"س"` + `"لام"` → `سلام`;
`" من"` starts the next word.

M6 requires **word-level** timestamps (click-a-word seeks). So the ml/ Soniox
adapter must assemble words: start a new word at each leading-space token,
`start_ms` = first token's start, `end_ms` = last token's end. Sending raw
tokens through would give the UI 280 unclickable fragments per 86 s.
`speaker` is present per token, so speaker survives assembly.

---

## 3b. OpenRouter ASR lane (same clip) — **VERDICT: viable fallback, not the primary**

`google/gemini-3.6-flash` via `input_audio` (base64 mp3), one chat call.

| | Soniox | OpenRouter (gemini-3.6-flash) |
|---|---|---|
| latency | 10.2 s | 12.3 s |
| word timestamps | **yes, all 280 tokens** | **none — prose only** |
| speaker labels | yes (per token) | none |
| cost (this clip) | — | $0.0138 (2163 audio tokens in, 1400 out incl. 1194 reasoning) |
| Persian quality | very good | very good — near-identical text |

Text quality is genuinely comparable; the two transcripts differ mainly in
punctuation and the same proper-noun miss («انصاری اکو» vs «انحصاری اکو» —
both wrong, differently). Two decisive differences:

1. **No timestamps at all** — fatal for M6's click-a-word requirement. A
   chat-completions ASR lane cannot satisfy the word-timestamp invariant; it
   can only ever be a degraded fallback (transcript text, no seek, no
   speaker alignment).
2. **It burns reasoning tokens to transcribe** (1194 of 1400 completion
   tokens), which is cost paid for nothing on a transcription task.

**Recommendation:** keep OpenRouter ASR exactly as M6 frames it — a fallback
lane — and have the pipeline **flag** any part transcribed through it as
timestamp-less, so the UI can disable seek for that part rather than
silently degrade (the M6 degrade-and-flag rule).

---

## 3c. Diarization gate on real audio — **plumbing CONFIRMED; multi-speaker gate still open**

`node diarize.mjs fixtures/persian-test-1.wav -1` (auto-cluster):

- **1 speaker found — correct**; the clip is a single speaker throughout.
- 3 speech segments covering 82.3 s of 86.5 s (95%) — sane VAD/segmentation
  on real, continuous Persian speech (no silence-padded TTS structure).
- No spurious second speaker invented, which is the failure mode that
  matters for single-speaker recordings.

**Verdict, stated honestly:** this confirms the sherpa-onnx path runs
end-to-end on real Persian audio and does not hallucinate speakers. It does
**not** close the multi-speaker gate — that needs a real 2+-voice Persian
recording, and remains open.

### A correction to my earlier RTF numbers — they were measured on an idle box

Re-running the **same synthetic file with the same config** now gives
**1.97×** realtime where it gave **0.33×** earlier today. Machine CPU is
pegged at **100%** by the other build sessions. So:

| measurement | earlier (idle) | now (100% CPU) |
|---|---|---|
| TTS 72.9 s file | 0.33× | 1.97× |
| real Persian 86.5 s | — | 1.61–2.25× |

The ~6× swing is **contention, not content**. My first instinct on seeing
1.61× for real audio was "real speech is 4× harder than TTS" — that reading
was wrong, and the paired re-measurement is what caught it. Controlling for
load, real audio is only marginally slower per second than the synthetic
file.

**What this means for capacity planning (M7):** the earlier "10 min of audio
≈ 4 min of CPU" figure is an **idle-machine best case**, not a planning
number. Diarization RTF must be re-measured on the target deployment
hardware, under representative concurrency, before the 30-minute-part
pipeline is sized. What survives regardless: diarization is the pipeline's
heaviest CPU stage and needs its own concurrency budget.

---

## Files

| File | What |
|---|---|
| `soniox.mjs` | live Soniox runner (key from DPAPI, never printed; deletes remote artifacts) |
| `openrouter_asr.mjs` | OpenRouter `input_audio` lane, same clip |
| `soniox_cleanup.mjs` | sweeps any files/jobs left on Soniox |
| `out/soniox.json`, `out/openrouter_asr.json` | full responses |
