# Echo Platform (repo: MVP) — session guide

The commercial rebuild: calls/meetings → transcripts → versioned summaries →
an org-scoped AI agent, built to be **sold** — completeness and correctness
over speed. TypeScript everywhere. Persian-first UI.

**Naming convention (user-set, use everywhere):** plain **Echo** always means
THIS platform; the Android recorder app (Desktop/Neurai-Echo repo) is always
called **Echo Mobile** — in conversation, docs, commits, and UI copy.

## Sources of truth

1. **[docs/SPEC.md](docs/SPEC.md)** — WHAT the product does. Product behavior
   conflicts resolve here.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — HOW it's built; decisions M1–M18,
   **LOCKED (user, 2026-08-12)** — binding on every session. Deviations go to
   the steward first and are amended in the document BEFORE code.

## Rules for every session

1. Do not contradict SPEC.md or locked M-decisions. Deviations go to the
   steward session first; amendments are marked and logged.
2. New constraining choices get numbered M-decisions before or with the code.
3. **Security invariants are non-negotiable**: no DB access without a user
   identity; the agent borrows the caller's authority and never more; RLS +
   role grants are the wall (prompts are never the wall); the agent's DB role
   has no DELETE; `ml/` stays productless; secrets never in the repo; content
   never in logs.
4. Persian-first: RTL, normalization at ingest and query, Persian digits,
   Jalali-capable dates.
5. Schema is hand-written SQL with numbered migrations; Drizzle for queries
   only. RLS/grant changes ship with their SQL tests.
6. The transcript is the source of truth; derived artifacts are rebuildable
   and carry provenance.
7. **Model integrations need positive-detection tests** (M19, from ml/'s
   Silero finding): a model wired up wrong usually fails *silently* and passes
   negative tests. Every integration of a model — VAD, STT, diarization, LLM
   lanes — ships at least one assertion that something is positively detected
   on real data, plus a logged warning when a component silently finds nothing.
   Corollary (sherpa-onnx finding): a health check must resolve the specific
   callable it guards — probing a module's presence is not a health check.
   Live-lane standard (steward ruling): live tests (real network, real spend)
   are opt-in, NOT in the default suite. The bar is **prove-at-acceptance** —
   run it once for real at package acceptance and record the result — plus
   re-run at release gates (steward-driven). "Runnable but never run" is
   theatre and does not count.
8. **The timing ladder (M20)**: transcript timing degrades word → line →
   part-spanning segment, never to "nothing". ml/ emits 0-based timings;
   core/'s worker anchors to `part.offset_ms` and synthesizes the
   part-spanning segment on `timestamps:"none"`; core/ refuses
   `end_ms <= start_ms` on non-empty parts.

## Workflow

Parallel Claude sessions: **steward** (architecture, coordination, verification,
release gate — this file's author), **backend** (core/, ml/, schema), **frontend**
(web/, design via ui-ux-pro-max skill), **docs**, and the **publisher** — the only
session that touches GitHub. Repo: **github.com/Dr-Bagheri/MVP — PRIVATE**.

- No `git commit` / `git push` from build sessions; the publisher reviews and
  pushes. Local tree: `C:\Users\amirreza\Desktop\mvp`.
- `*.docx`, `docs/*.pdf`, `.env*`, keys and keystores never reach the repo.
- Reference codebases (read-only, do not modify): `Desktop\neurai-mvp`
  (on-prem predecessor), `Desktop\Neurai-Echo` (cloud recorder — the pgmq-style
  worker, RLS wall, harness lanes, and near-miss hygiene lessons live there).

## Status

- 2026-08-10: Folder created; private repo live (Dr-Bagheri/MVP); SPEC.md
  captured; ARCHITECTURE.md through DRAFT 2 + rounds 2-3 folded (M1–M18,
  §OPEN empty).
- 2026-08-10 (build start, user-directed): **parallel build begins on
  ruling-stable parts before formal lock** — web/ dispatched (scaffold +
  design system + screens on typed mocks); backend session on the Phase-0
  spike (its findings settle the one open ruling: ml/ language, M1/M9).
  Remaining backend packages (schema+RLS, core/api, core/worker, ml/,
  gateway) split across sessions as they free up; user opens additional
  sessions in this folder when more parallelism is wanted — this file
  onboards them, steward assigns packages.
- 2026-08-12: **ARCHITECTURE LOCKED by the user** (v1.0, M1–M18) after three
  review rounds + the measured Phase-0 spike. Build tracks running: web/
  (Front-end), core/ (Backend), ml/ (Backend 2), schema+RLS (Backend 3).
  Dev Supabase live (aqgpxnyuxukwgphrxslw; keys in DPAPI store under
  echo_platform_*). Soniox funded; quality numbers land post-lock.
- 2026-08-12 (later): **web/ Phase A serving** — full screen set captured,
  awaiting the user's visual-direction verdict. **db/ schema green on the dev
  project** (17 migrations, 135 checks) and line-reviewed; **M19 added**
  (db/D1–D13 ratified, Q2/Q3/Q4 ruled as built, model-testing rule). Two
  review findings returned to Backend 3 before core/ may depend on the schema:
  purge-vs-assistant-message FK (`agent_message.agent_run_id` must be
  `on delete set null`) and the current-summary pointer joining the
  owner-only column list. **core/**: runtime + permission core approved;
  api layer in progress. **ml/**: Silero VAD live (RTF 0.14, −15% STT cost);
  Persian WER measurement pending a real clip.
- 2026-08-12 (evening): **ml/ COMPLETE** — 87 tests, Persian acceptance passed
  on a real device recording (RTF 0.16, ZWNJ correct, VAD-trimmed transcript
  unchanged), diarization verified both directions (2 voices found / no voice
  invented). Honest gaps recorded in ml/README.md (crosstalk untested; RTF
  numbers size nothing under contention — measure on the deployment box).
  **M20 ruled** (timing ladder). core/ at 69 tests (rule-7 pass: an
  empty-but-well-formed model response now FAILS the run; live OpenRouter
  lane executed once, green); /v1 + SSE in progress. Package assignment:
  **core/worker → Backend 2** (owns `core/src/worker/**` only; shared core/
  files are read-only to them — changes go through Backend 1;
  transcript-mapping.ts handed over as theirs; **postgres AgentRunStore is
  Backend 1's** — worker consumes, never forks). web/ EN-locale fixes
  verified by steward re-shoot (ss01 font feature was silently swapping
  digit glyphs — removed, digits follow locale from lib/format.ts; title
  locale-aware). Diarization multi-speaker sub-gate: open, awaits a real
  2-voice Persian clip (3-minute job when it arrives).
