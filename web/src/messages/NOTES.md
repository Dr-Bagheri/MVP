# Translation notes

JSON cannot carry comments, so decisions that would otherwise be "fixed" back
live here. Read this before changing a string in `fa.json` / `en.json`.

## `status.linking` — «تطبیق گویندگان», NOT «تفکیک گویندگان»

`linking` matches voices **across parts** and to directory people: the same
voice recognised as one speaker. That is *matching* (تطبیق).

*Separating* (تفکیک) is diarization — a different operation one level down,
inside `ml/`, which runs per part inside the `processing` status and never
appears as a call status at all. «تفکیک گویندگان» was in this file when the
status vocabulary was wrong; it is not a synonym, it names the other thing.

Steward-ratified. Do not revert.

## `status.*` — the list is closed, and it is core/'s

The six values mirror `echo.call_status` (db/0001): `recording`, `processing`,
`linking`, `summarizing`, `ready`, `failed`. Per-part work (transcode → vad →
transcribe → diarize) happens *inside* `processing` — there is no
`transcribing` or `diarizing` status, however plausible they sound. An earlier
version of this file had labels for four states that do not exist, invented on
this side and never contradicted because the fixtures were invented to match.

Adding a label here does not create a state. If a status needs a label, it
comes from core/'s enum first.

## Never write source files with PowerShell — and the hazard has TWO modes

The rule is usually written up as an encoding-destruction danger: a PS 5.1
round-trip through the ANSI/cp1252 default mangles Persian. True, and visible —
you see mojibake immediately.

**The second mode is invisible and did real damage.** `Set-Content`/`Out-File
-Encoding utf8` in Windows PowerShell 5.1 emits UTF-8 **with a BOM** (`EF BB
BF`). Persian survives perfectly. ZWNJ survives. Nothing looks wrong. But a
strict parser chokes on those three bytes:

- `web/package.json` acquired a BOM this way and **took the dev server down for
  every session** — webpack could not parse the manifest, so every route 500'd
  with `Module not found: SyntaxError: … (directory description file)`.
- `src/api/mock-data.ts` carried the same BOM. TypeScript and esbuild tolerate
  a leading BOM, so typecheck stayed green and it went unnoticed.

So: "the Persian looks fine" is **not** evidence the file is fine. Check the
first three bytes.

Use the Write/Edit tools for source files. If a script genuinely must write
one, use `[System.IO.File]::WriteAllText($path, $text, (New-Object
System.Text.UTF8Encoding($false)))` — the `$false` is the no-BOM flag and is
the whole point.

## Digits

Digit shaping belongs to `lib/format.ts`, where it follows the active locale
and can be tested — **never** to a font feature. Enabling Vazirmatn's `ss01`
swaps Latin digit glyphs for Persian at the font level, which silently
overrides locale and rendered «۱۱ Aug ۲۰۲۶» in the English UI.
