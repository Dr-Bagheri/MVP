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
   never in logs. **Secret naming (steward ruling, 2026-08-12): every Echo
   platform credential in the DPAPI store carries the `echo_platform_`
   prefix.** Three products share that store (`supabase_*` = other projects,
   `echo_supabase_*` = Echo Mobile); a plausible-name guess there is
   unrecoverable — a session nearly pointed a service key at the wrong
   project. Never consume a `supabase_*`/`echo_supabase_*` name from Echo
   platform code.
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
   Corollary (resolveSkill finding): **a missing floor is loud** — when a
   SYSTEM resource (seeded skill, shipped prompt) fails to resolve, that is a
   broken deployment or an invalid identity and must fail loudly; org/user
   overrides falling through to the next rung is the ladder working, but the
   bottom rung going missing is never a fallback — the summarizer silently
   ran without its anti-fabrication instructions and nothing said so.
   Corollary (sherpa-onnx finding): a health check must resolve the specific
   callable it guards — probing a module's presence is not a health check.
   Live-lane standard (steward ruling): live tests (real network, real spend)
   are opt-in, NOT in the default suite. The bar is **prove-at-acceptance** —
   run it once for real at package acceptance and record the result — plus
   re-run at release gates (steward-driven). "Runnable but never run" is
   theatre and does not count.
8. **The timing ladder (M20)**: transcript timing degrades word → line →
   anchored speech span, never to "nothing". ml/ emits 0-based timings;
   core/'s worker anchors to `part.offset_ms` and synthesizes one
   speech-span segment (first→last speech in the part) on
   `timestamps:"none"`; core/ refuses `end_ms <= start_ms` on non-empty
   parts.
9. **Fixture independence** (named after three bites in two days: VAD's
   all-negative suite, the per-word span check, the call-flag-keyed fixture
   generator): a test cannot fail when its fixture is derived from the same
   belief as the implementation. For every test ask: *where did this input
   come from — could it have come from the same place as the bug?* At least
   one fixture per feature must come from reality (a real clip, a real
   provider response, the schema's own shape), not from the code's
   assumptions. Sibling trap, the altitude pattern: an invariant enforced at
   a different level than it was guaranteed "reads as defensive rigour and
   behaves as a landmine" — enforce invariants at the altitude they are
   promised. Runtime corollary: vitest transpiles what
   `--experimental-strip-types` refuses to boot, and tests import modules a
   missing entrypoint never loads — a green suite is not evidence the
   process starts. Per milestone, **start every process under the
   production runtime and make it answer one request** ("it loads" is not
   the bar: api/main.ts didn't exist under 219 green tests, then exited 0
   silently). Windows trap: never string-compare `import.meta.url` to
   `process.argv[1]` for an entrypoint guard — drive letters and slashes
   make it silently false; use `pathToFileURL(process.argv[1]).href`. And
   log Postgres errors by structured field (code/constraint/table/column),
   never message OR detail — detail quotes the offending row, which can be
   transcript content.
10. **Boundary fixtures come from the producer** (named after the words-shape
   incident: worker stored `{w, s, e}`, api published `{w, start_ms,
   end_ms}`, both suites green, every consumer read undefined). Two correct
   sides and an unowned boundary is how cross-package bugs ship. For every
   data shape that crosses a package boundary, ONE fixture is generated by
   the producing side and asserted by the consuming side — never two
   hand-written beliefs about the same wire.
11. **Fake at the right altitude** (named after the M15 401-bounce: two
   individually-correct RLS policies composed through an INNER JOIN made
   the pending state unreachable, and every fake WAS the join's already-
   successful result, so the failure was unrepresentable). When the thing
   being faked is a composition of access rules, the fake must be the
   rules, not the composition's output. Practical floor: the
   identity-resolution path is exercised against REAL RLS for each of
   {active, pending, suspended-org, unknown} — that is where
   independently-correct policies compose.
12. **Distinguish the kinds of nothing** (after ~a dozen real-wiring
   defects, every one shaped as "'nothing came back' reported as the wrong
   kind of nothing" while all nine suites stayed green): absent-because-
   invisible is not absent-because-missing; no-such-route is not a
   transport failure; no-org-row is not no-such-person. A component that
   finds nothing must name WHICH nothing — and a fake must never decide
   what "nothing" means at a point where the real system decides it
   differently. See also M21: whatever is forfeited is said out loud.
   Deepest form (summarizer-tools gap): **the absent thing is often a
   legitimate value** — empty tool list = "nothing prior to find",
   undefined = "no skill configured", missing org row = "no such person" —
   so something helpful absorbs the absence and reports success. When a
   feature's absence is indistinguishable from a valid state on SOME input,
   the test fixture must be the input where they differ (a single call can
   never prove the summarizer searches history; two related calls can).
13. **Turn rules into things that run.** Proof case: a session broke rule
   9's strip-types trap within ONE HOUR of its codification, in the file
   being edited to satisfy another ruling — caught only by a manual
   re-boot. A rule in prose protects only whoever is currently remembering
   it; a rule that executes protects everyone forever. The existing
   mechanizations are the pattern: the boot test spawning the REAL runtime
   (test/api-boot.test.ts — asserts start + one answered request, and
   `exited === null` because the Windows guard bug exits ZERO), the
   negative-space schema tests, the pg_enum union assertion,
   verify-before-store. When you write a rule, ask what test makes it
   unnecessary to remember — and verify the test fails on the bug it was
   written for before trusting it. The symmetric duty (route-manifest
   finding: a tree-fragment parser reported eleven "missing" routes that
   exist): **verify a failure names a real defect before relaying it — red
   output lies exactly as fluently as green.**

## Workflow

Parallel Claude sessions: **steward** (architecture, coordination, verification,
release gate — this file's author), **backend** (core/, ml/, schema), **frontend**
(web/, design via ui-ux-pro-max skill), **docs**, and the **publisher** — the only
session that touches GitHub. Repo: **github.com/Dr-Bagheri/MVP — PRIVATE**.

- No `git commit` / `git push` from build sessions; the publisher reviews and
  pushes. Local tree: `C:\Users\amirreza\Desktop\mvp`.
- **Windows/PS 5.1 hazard: never edit source files with `Set-Content` /
  `Out-File`** — they default to ANSI, which silently destroys Persian text
  via a cp1252 round-trip AND survives typecheck (it mangled three files in
  one day). Use the harness Edit/Write tools; if PowerShell is unavoidable,
  pass `-Encoding utf8` explicitly.
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
- 2026-08-12 (night): first milestone PUSHED (5 commits, exclusions verified).
  Worker underway (124 core tests): **M7 amended** — queue transport ≠ status
  ladder; one `process_part` message walks the per-part rungs (ml/ does all
  four in one call); db/0019 LANDED (146 checks) — queues now
  echo_process_part + link_speakers + summarize (+ echo_transcode until
  Backend 2 confirms the switch → 0021). db test is fixture-scoped by
  default; --fresh drops schema (release-gate use, steward-driven). db/0020
  (152 checks, D15): call_part.has_word_timestamps — worker asserts,
  demote-only trigger on words-blanking, restore never re-promotes (only
  re-transcription does); negative-space test forbids any call-level
  word/timing column forever. Worker seq scheme (ratified): deterministic
  ranging `seq = part.idx × 100_000` — no coordination, retry-idempotent,
  duplicates trip UNIQUE loudly; stride-overflow refuses. Worker acceptance
  bar (steward): logic-on-fakes insufficient — one real recording through
  real Postgres/pgmq/ml//storage, plus an exercised part-failure gap, before
  the package closes. db/0021 LANDED (153 checks): queue thread closed —
  exact inventory asserted + no retired name may return; enqueue contract
  ({callId, ownerId, partId}, ownerId written while a genuine caller is
  present) promoted into M7. db/ has no open items. Dev-project login
  authorized (steward, user can veto): echo_app + echo_agent only, CSPRNG
  passwords as percent-encoded URLs in the DPAPI store
  (echo_platform_db_app_url / echo_platform_db_agent_url) — purge waits for
  its package, vendor NEVER logs in. **Worker E2E acceptance 11/11 on real
  wiring** (dev Postgres + pgmq + ml/ + live Soniox on the consented clip;
  forced part failure → visible gap, call survived): four bugs fakes
  couldn't see — strip-types boot failure (39 green tests, unbootable
  process), pgmq.send overload casts, double-JSON encoding (caught by B3's
  words_is_array constraint), vacuous [].every() in the harness itself.
  Package still open on two legs: real Supabase Storage (signer with
  Backend 1 — critical path) and summarize-step E2E. 188 core tests.
- 2026-08-12 (late): core/ milestone at 219 tests — transcripts, summaries,
  search (db-only fa_fold; ts_headline over raw text: right display always,
  marks nearly always), storage signer, M17 gateway. Rulings: **M17 amended**
  — assistant is per-key opt-in (api_key.allow_assistant default false,
  db/0022 assigned) + webhook bodies = identifiers/status ONLY (invariant,
  outbound twin of no-content-logs). withActor now asserts role
  in-transaction (loud misconfig ratified). **Rule 10**: boundary fixtures
  come from the producer (words-shape incident: {w,s,e} stored vs
  {w,start_ms,end_ms} published, both suites green, wire broken).
  run-store moved to echo_agent (grant wall caught its own author).
  db/0022 (158 checks): allow_assistant default false, returned by
  resolve_api_key (signature moved — only reachable pre-identity there).
  Role memberships: NONE, deliberately and load-bearing — a 42501 at
  set-local-role means a miswired URL; never "fix" it with a grant.
  OPEN FIX (Backend 1): agent-run status enum drift — types.ts
  succeeded/failed vs schema ok/error; every run stuck at 'running' on real
  db (fakes green). Direction: TS adopts schema + rule-10 pg_enum
  assertion. api boot smoke (221 tests): api/main.ts did not EXIST under
  219 green tests, then silently exited 0 (Windows-false entrypoint guard —
  use pathToFileURL; worker/main.ts has the same guard, B2 warned).
  Milestone bar raised: starts under production runtime AND answers one
  request. pg `detail` redacted at logger level. api requires BOTH pool
  URLs — no fallback. Role assertion is fail-LOUDLY, not fail-safe.
  WER harness done (ml/test/wer/, 15 tests): normalize-then-score with
  both-direction guards; alignment report, not just a percentage; reference
  awaiting user correction at ml/test/wer/refs/persian-test-1.txt (124
  words, gitignored — reference = recording content). Worker boots under
  production runtime and consumed real messages (skip path, no-transcript
  refusal, DEAD LETTER UNRECORDED all observed live); dev project swept
  clean of test residue. db/0023 assigned: call.summary_skipped_reason
  (set on skip, cleared when a summary lands — failure_reason means
  failure again). B1's enum fix landed ahead of its tests (5 red,
  relayed). max_tool_calls RULED into M4 (per-skill ceiling, nullable →
  runtime default; B3 caught the field outrunning the ruling). Stable dev
  identity approved: dev-only SCRIPT, never a migration (fixed UUIDs in
  db/README.md; prod seeds no identities). resolveSkill fix directed:
  system-skill miss = LOUD run failure ("a missing floor is loud" — rule 7
  corollary; summarizer had silently dropped anti-fabrication prompts). **M5 amended**: unattended-model ladder (owner pref → org
  default [allow-list[0] v1 stand-in] → env → SKIP with visible retryable
  flag — a missing model may cost a summary, never a call). Worker at
  12/19 real-wiring checks, all 7 failures downstream of the enum.
  call-audio bucket created; storage.objects zero-policies ruled permanent
  (M10: "the missing piece is a signer, not a policy"). Awaiting user key
  rotation → stale-key deletion → storage leg closes. Two altitude-class bugs fixed in handed-over mapping
  code (cross-part seq collision on >30-min calls; zero-duration Persian
  word «و»). Dead-letter semantics ratified: part→gap, call-step→resumable
  fail, all-missing→fail-not-summarize, unknown→retry, owner-unresolvable→NO
  product write (invariant 2, no exceptions; dead-letter sink must be loud).
  M20 wording corrected: degraded rung = anchored speech span, not
  part-spanning (frontend flag, verified in code).
- 2026-08-12 (latest): M15 401-bounce fixed (256 core tests): pending users
  got 401, not 403 kind:"pending" — two individually-correct RLS policies
  composed through an INNER JOIN made the state unreachable; LEFT JOIN +
  NULL-is-inactive. **Rule 11** minted: fake at the right altitude —
  identity path tested against real RLS across {active, pending,
  suspended-org, unknown}. kind:"suspended" ADDED to the auth taxonomy
  (additive; copy post-verdict, points at vendor not org admin).
  Inactive-owner jobs: legible refusal → normal retry/dead-letter
  (requeueable when suspension lifts). resolveSkill loud-floor implemented
  (org-override fallback protected by test); max_tool_calls wired
  (db/0025); schema contract at 14 checks, run by B1 against the live
  catalogue. **Worker 20/20 on real wiring incl. summarize** (shipped
  Persian skill proven through the resolver); dead-letter reasons named:
  owner_not_found non-retryable / owner_cannot_see_call retryable.
  **M21 adopted** (forfeit hierarchy: never the user's data; forfeits are
  loud; degrade what was INFERRED, fail on what was TOLD). **Rule 12**:
  distinguish the kinds of nothing (~12 defects this session, all found
  against the real system, all suites green throughout). Storage leg =
  the only worker item left, on the user's key rotation. kind:"suspended"
  shipped (kind-as-field, person-before-org order load-bearing;
  disabled-individual = generic forbidden, taxonomy gap logged). **Rule
  13**: turn rules into things that run (B1 broke rule 9's trap within an
  hour of codification; test/api-boot.test.ts spawns the real runtime,
  verified red on its target bug; worker equivalent offered to B2).
  267 core tests. SPEC GAP found by B2: summarizer runs with ZERO tools
  (0015 declares four; agent/tools.ts implements none) — invisible to any
  single-call fixture ("nothing prior" is legitimate). Domain tools
  ASSIGNED to B1 as part of the api milestone; acceptance = two related
  calls, second summary references the first. Tool-capability directive:
  investigate OpenRouter supported_parameters (unknown = not tool-capable,
  fail closed); tool-refusing model at runtime = flagged forfeit (M21),
  never silent transcript-only success. Rule 12 gained its deepest-form
  clause ("the absent thing is a legitimate value"). **api LINE-REVIEW
  APPROVED** (282 tests; auth/jwt/errors/sse/apikeys/members read in full):
  one required finding — webhook dispatch is an SSRF vector with a
  port-scan oracle (stored response_code); delivery-time resolve-and-refuse
  of private/loopback/metadata ranges required, mirrors ml/'s allow-list.
  Nits: aud pinning promised-not-implemented; README must record the
  HS256-vs-JWKS Supabase signing-mode dependency. SPEC-surface manifest
  test adopted (rule 13). B3 seeding a suspended org. Timezone bug killed:
  iso() in vocabulary.ts is contract (String(date) was shipping
  server-local English dates — Jalali UI would shift meetings by a DAY).
  Remaining before api closes: domain tools + two-call fixture, capability
  filter, SSRF guard.
- 2026-08-12 (closing): domain tools LANDED (server default; two-call
  fixture at tool layer; an api without tools would look like a bad model —
  pre-empted). Capability filter live from OpenRouter supported_parameters
  (335→332, incapable choice = 400). B1's fetch-failure deviation RATIFIED
  (checked-incapable ≠ could-not-check; unfiltered-and-labelled beats
  empty-and-lying; cache-last-good directed). M21 marker in runtime ("no
  tool called although N available"). WRITE tools + SSRF-guarded dispatcher
  + approval-card flow = NEXT milestone (post-verdict). api review items
  all closed (311 tests; SSRF connect-time guard; aud pinning; manifest
  with KNOWN_ABSENT; red-lies-too added to rule 13). Two-call E2E RUN:
  real Gemini chose search + list_related_calls with self-exclusion from
  the shipped Persian prompt — SPEC proven at mechanism level. Gate
  ruling: assert-the-REACH in agent_run.steps, never the prose ("the
  first red everyone shrugs at is the last red anyone reads"). Fixture
  degenerate (same clip twice) — user's 2-voice clip does double duty.
  Push #2 gate: B1 fixes agent_run.steps double-encoding (3rd
  double-encode today → ONE shared jsonb helper, rule 13; queryability
  assertion as the test) + B2 re-runs 24/24. Steps fix LANDED (315 tests):
  `$1::text::jsonb` + src/db/jsonb.ts helper (cast travels with the
  value); `request` had the same bug (unqueried data is unverified data);
  SQL-phrased queryability test + zero-double-encoded-rows standing
  assertion; SQL-text pin justified (the string IS the defect). Remaining
  gate: B2's 24/24 + helper adoption at their two sites.
- 2026-08-13: **24/24 — MILESTONE 2 GATE GREEN, push #2 requested.** All
  three double-encode sites route through db/jsonb.ts (grep-clean). Gate
  design ratified: demand the BEHAVIOUR (either cross-call tool), never
  the model's particular choice among legitimate paths. Worker: everything
  session-closeable is closed; open legs are user-gated (storage rotation,
  2nd Persian clip). Next milestone (post-verdict): write tools +
  approval-card flow, SSRF-guarded dispatcher, purge job. ml/ 110 tests,
  core/ 298 + 24/24 live, dev project swept to deliberate fixtures only.
