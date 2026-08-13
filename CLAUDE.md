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
   platform code. **Deliberate exception (ruled 2026-08-13): cross-product
   PROVIDER keys keep their canonical single names** — `openrouter_key`,
   `soniox_key` — because they are not project-scoped (no wrong-project
   hazard) and duplicating them under `echo_platform_*` would mean two
   names for one secret, where a rotation updates one and strands the
   other. Read them via the DPAPI store's get_secret; never copy them to
   new names.
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
   Authorization-matrix corollary (the M11 break): asserting the PRIVILEGED
   path and the REFUSED path leaves the ORDINARY path unproven — and **the
   ordinary path is the product** (admins-delete-any and members-can't-
   delete-others' were both asserted; members-delete-their-own never was,
   and never worked). Walk the whole matrix.
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
   assumptions. **Fixing one instance does not fix its siblings** (the
   purge 403 fixture — a raw status the API never sends — survived the
   404 post-mortem in the SAME file, because only the fixture that had
   burned was replaced; the rest sat there looking rigorous): a
   post-mortem re-derives EVERY fixture in the block from the provider,
   not the one that failed. Sibling trap, the altitude pattern: an invariant enforced at
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
   independently-correct policies compose. Instrument precondition
   (soft-delete finding): **a policy check must assert it is NOT
   bypassing RLS before testing** — drop to the product role and assert
   `rolbypassrls = false` first; run as superuser, every policy check
   passes unconditionally and reports the bug it exists for as fixed.
   The counting corollary (the three-orgs episode): **under RLS, "I
   counted N" and "there are N" are different statements** — a count run
   below the wall is an inventory true only for the counter; inventory
   questions answer only at owner altitude. And on dev: an auth.users
   row is NOT evidence a real sign-up ever succeeded — seeds write it by
   hand at owner altitude. Author-side corollary (the
   enqueue-policy near-miss, written hours after its author documented the
   same bug): **when a policy needs a fact about another protected table,
   reach for a constraint, not a subquery** — an EXISTS in a policy runs as
   the caller and silently intersects with that table's policies; a
   composite FK makes the wrong state unrepresentable instead. Structure
   doesn't have the intersection problem; predicates do.
12. **Distinguish the kinds of nothing** (after ~a dozen real-wiring
   defects, every one shaped as "'nothing came back' reported as the wrong
   kind of nothing" while all nine suites stayed green): absent-because-
   invisible is not absent-because-missing; no-such-route is not a
   transport failure; no-org-row is not no-such-person. A component that
   finds nothing must name WHICH nothing — and a fake must never decide
   what "nothing" means at a point where the real system decides it
   differently. See also M21: whatever is forfeited is said out loud.
   Indistinguishability debt (the soft-delete 404): every place we
   DELIBERATELY make two states indistinguishable to a caller (RLS
   refusal = 404 = no such row — correct posture), we owe ourselves a
   way to tell them apart on OUR side — a structured warn on the hidden
   branch (codes only, never content), or "the database refuses this
   for everyone" hides inside "no such call" and the route looks like
   it works on a row that doesn't exist. And a peer's status claim is
   not evidence — "soft delete already worked" was believed, repeated,
   and never true; a belief nothing asserts against is the enum drift's
   shape wherever it appears.
   Deepest form (summarizer-tools gap): **the absent thing is often a
   legitimate value** — empty tool list = "nothing prior to find",
   undefined = "no skill configured", missing org row = "no such person" —
   so something helpful absorbs the absence and reports success. When a
   feature's absence is indistinguishable from a valid state on SOME input,
   the test fixture must be the input where they differ (a single call can
   never prove the summarizer searches history; two related calls can).
   And **the states your own recovery paths create are mandatory
   fixtures** (the purge finding: objects-first ordering deliberately
   leaves rows whose objects are gone — recovery working as designed —
   and the already-absent branch handling exactly that state was dead
   code behind a provider-spelling assumption; the ordering had built the
   deadlock it exists to prevent). Absence is decided by the ADAPTER —
   the only layer that knows how its provider spells the word — and
   reaches callers as a boolean.
   Instrument form (the audit that certified three 500 pages): an empty
   error page has no elements, no violations, a perfect score — "renders
   identically to its absence" INSIDE the measuring tool actively issues
   passes. **An instrument must positively identify its subject before
   reporting on it** — assert something specific to each screen, not "body
   has children" (a partially-hydrated page satisfies that too). Stated as
   the rule: **a checker that can pass vacuously must assert it had
   something to check** — return INVALID instead of a result when the
   subject didn't render, carry an element count with every pass, and
   verify the guard fires on a synthetic failure before trusting any
   result. The mirror trap (the orphan-checker's first draft excluded
   trigger functions from the very corpus it searched and reported a
   consumed function orphaned): **a checker that manufactures false
   positives gets muted within a week and is then worse than absent** —
   fails-when-it-shouldn't is the failure that kills adoption. And rule
   9 binds live harnesses too: a check depending on ambient data must
   SEED ITS OWN ("did not run, result unknown" saved one from passing
   vacuously; self-seeding is the fix). The inverse of red-lies-too, and
   the more dangerous direction: nobody investigates a green. Probe
   discipline (the dead-key verdict — "expect 401" met a 403 wrapped in
   a 400): **a probe whose result you did not predict has not yet told
   you anything** — it must DISTINGUISH the cases before settling one;
   add controls (no-credential, invented-credential) until the responses
   differ. And the habit that caught it: **distrust
   any result that CHANGED without a reason — in either direction** (the
   clean sweep that was a 500; the .tap "failure" that was a probe
   outside the viewport). Neither catch came from suspecting a tool; both
   came from a number that didn't match a reading taken twenty minutes
   earlier — keep prior readings to compare against. Proxy clause (the assistant
   overlay: main went 40px→375px, overflow stayed clean, and the app
   became unreachable behind an opaque default-open layer — third instance
   in one session with the empty-500 harness and the BOM): **a proxy
   metric confirms the fix it was chosen for, not the property it was
   standing in for.** The instrument tell: layout audits measure boxes;
   users press things — hit-test the actual control (elementFromPoint),
   which no invisible covering layer can satisfy, where every box metric
   can. And its red side: elementFromPoint returns null OUTSIDE the
   viewport, which looks identical to a miss — scroll into view before
   believing a failed hit. The spectrum, so the next one is caught: a
   broken instrument (measured an error page) is fixed by proving it had
   a subject; but the BOM and the overlay were CORRECT measurements of
   the wrong property — no had-something-to-check assertion helps.
   **Prefer the measurement that fails when the user would fail, not the
   one that describes the layout.** CSS-layer sibling (three in one
   session: ring-offset-color as a non-property, .tap on a <select>,
   text-on-accent without its config entry — the last one shipped as a
   FIX and made the number worse while the markup read as fixed): **the
   artifact is present and reads as satisfied** — a reviewer sees the
   fix, a grep finds it, only the computed value disagrees. The general
   form (four instances once the audit's own opaque-ancestor probe joined
   the table — a translucent tint measured against the layer BEHIND it):
   **verify the rendered artifact, not the source that should have
   produced it** — the failure is invisible at the place you would look;
   layout answers with hit-testing, stylesheets with computed values,
   compositing with alpha-aware sampling. And the workflow half: the
   worst instance was the failure mode of a FIX (right token, right
   diagnosis, worse outcome, markup reading as repaired) — **nobody
   re-measures a line they just watched land**, so a fix's re-measurement
   belongs to someone who didn't watch it land.
13½. **A producer with no consumer is a defect, and the producer's owner
   cannot see it** (named after the third seam-break in one arc: enum
   drift — worker wrote labels the api didn't have; M11 delete — api
   wrote a row db/ forbade it to read back; M15 signup —
   register_account existed, granted, commented, and NOTHING ever called
   it, so the product could not onboard a single user while every
   layer's tests were green and honest). No session can assert "the
   piece I hand over is picked up by anyone" from inside its own
   package; the seams need their own instruments. First one: every
   function granted to echo_app must have at least one caller in
   core/src — grep, not cleverness, and it would have caught M15 the day
   0015 landed.
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
   output lies exactly as fluently as green.** Timing form (the boot-test
   fix): **wait on the condition, never on a duration** — a sleep makes
   the result depend on suite load, and lengthening it delays detection
   of exactly the failure the test exists for (silent-exit-zero); poll
   for the expected line or an exit, whichever comes first.

## Workflow

Parallel Claude sessions: **steward** (architecture, coordination, verification,
release gate — this file's author), **backend** (core/, ml/, schema), **frontend**
(web/, design via ui-ux-pro-max skill), **docs**, and the **publisher** — the only
session that touches GitHub. Repo: **github.com/Dr-Bagheri/MVP — PRIVATE**.

- No `git commit` / `git push` from build sessions; the publisher reviews and
  pushes. Local tree: `C:\Users\amirreza\Desktop\mvp`.
- **Claim before you build** (after two sessions built one screen for an
  hour on crossed messages): before starting any multi-hour piece, announce
  "starting X now" to the session owning adjacent files and wait for the
  ack if the piece overlaps their tree. Steward assignments can cross
  in-flight work; the claim ping is what surfaces it in minutes instead of
  an hour.
- **Windows/PS 5.1 hazard: never write source files with `Set-Content` /
  `Out-File` — in EITHER encoding mode.** The hazard has two failure modes
  and only one is visible: default ANSI mangles Persian via cp1252 (visible
  — it wrecked three files in one day); `-Encoding utf8` emits UTF-8 *with
  BOM* — Persian and ZWNJ survive perfectly, typecheck stays green, and a
  strict parser dies (a BOM'd package.json 500'd every route for every
  session). **"The Persian looks fine" is not evidence the file is fine.**
  [An earlier version of this rule recommended `-Encoding utf8` as the
  escape hatch — that advice CAUSED the BOM outage; corrected, and left
  visible as the reason the rule now has no escape hatch.] Use the harness
  Edit/Write tools. If a script genuinely must write a file:
  `[System.IO.File]::WriteAllText($p, $t, (New-Object
  System.Text.UTF8Encoding($false)))`.
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
- 2026-08-13 (verdict day): **DESIGN VERDICT delivered (user-delegated):
  direction APPROVED + bounded navy strengthening pass** (Trust & Authority
  tokens: primary #0F172A, accent #0369A1, border #E2E8F0; navy sidebar;
  card borders; density +1; Vazirmatn stays both locales — single font
  overrules the skill's Latin pairing). Freeze LIFTED. **Usage ruling
  RE-AFFIRMED in M15** (no v1 surface; agent_run tokens keep it derivable).
  **Milestone 3 OPEN**: B1 = write tools + proposal/approval flow (approval
  recorded in agent_run.steps); B2 = webhook dispatcher (address-guard
  contract, blocked≠retryable) + purge job as echo_purge (B3 mints login on
  request; storage objects purge with rows; Q5 semantics); FE = design pass
  → 4 copy items → connectors/gateway rebuild → approval-card UI. User
  handed the WER reference file for correction; rotation + 2-voice clip
  remain the other user items. Milestone-3 rulings: webhook signing = HMAC
  keyed by stored secret_sha256 (integrator derives from whsec_; posture
  on record: verification material at rest in an org-scoped API-invisible
  row — DB compromise forfeits the premise anyway; v1= version prefix,
  asymmetric = the v2 seam) + REPLAY protection required (signature covers
  "{t}.{body}", 5-min tolerance). Purge order: OBJECTS-FIRST — "the row is
  the map to the object; delete the map last"; already-absent tolerated;
  idempotent end-to-end. Dispatcher = 4th handler in runner.ts; purge =
  isolated 3rd process (the only DELETE lives where nothing else does).
  Webhook identity contradiction found by B2 (0013's comment describes a
  member-worker the policies forbid; M17's enqueue half never built).
  RULED: dispatcher runs as webhook.created_by (D6 consistency —
  fail-closed on demotion is a feature; in M17 text; RLS-relaxation
  rejected). Deeper gap flagged by steward: the member enqueuer can't
  discover org webhooks — B3 assigned: delivery-queue migration + scoped
  read ({id, events, enabled} only; url/secret stay admin-absolute;
  numbered decision) + 0013 comment/policy reconciliation. **0026 LANDED**
  (186 checks): echo_deliver_webhook queue; subscribed_webhooks(event)
  scoped read (D19 — disabled returned-not-filtered, M21 outbound);
  dispatch=admin policy; RETURNING caveat documented. D9 extended + rule
  11 corollary: "when a policy needs a fact about another protected
  table, reach for a constraint, not a subquery" (B3 wrote the
  intersection bug hours after documenting it — caught by re-read).
  Purge credential minted as echo_platform_db_purge_url; verify-before-
  store gained a DISCRIMINATING probe (the sees-nothing check was
  vacuously true for the actor-independent purge role — now
  sees-only-expired / refuses-live / deletes-expired).
- 2026-08-13 (write tools shaped, 399 tests): tools VALIDATE and return
  proposals; applyProposal (confirm endpoint only) is the sole mutating
  path; negative test = a write tool issues no UPDATE/INSERT. RULED into
  M4: confirm body = {run_id} only (server re-reads from steps — proposal
  and approval are ONE object; no confirm without the step); confirmed
  writes run on the AGENT role (approval widens content, never the
  grant); **NO pending-proposals inbox, ever** (FE's consent argument:
  outside its conversation a proposal loses the sentence that made it
  approvable). Correction clears words → D15 demote chain composes
  end-to-end unplanned. PROPOSAL_KINDS in @echo/core/vocabulary (5th
  invented-vocabulary catch). Live propose→confirm→write loop = B1's to
  write AND run (their surface, not the DAG). FE1: 4 copy items DONE
  (mixed scoped to the part; suspended's load-bearing clause; blessed
  gateway sentences verbatim) + 2 more false claims killed («کلید
  سازمان» → «کلید API» — keys name a MEMBER) + connectors REBUILT
  (blocking-panel mint door — "a toast on a timer would destroy the only
  copy of an unrecoverable credential"; acts-as; revoked rows; 503-retry
  visible in deliveries) + favicon. Collision resolved: FE2 REDIRECTED
  to responsive (375/768/1024, mobile-nav proposal to steward first) +
  dark-theme audit. FE1's open item: approval card (B1's matched
  before/after pair is the contract).
- 2026-08-13 (proposal loop): harness written (drives HTTP, not the
  runtime; real-model assertion NOT stubbable); found preferred_model
  written-and-never-read ("stored and unqueried is unverified") + no-model
  now 400-before-stream. RULED: second confirm = **409 via steps
  containment** (UPDATE … WHERE NOT steps @> marker — the audit trail IS
  the decided-state; race-proof in one statement; uniform across kinds).
  Rule 3 amended: provider keys (openrouter_key, soniox_key) keep
  canonical single names — cross-product, rotation-safe. Loop unblocked
  via get_secret mechanism.
- 2026-08-13 (LIVE LOOP GREEN + the approval ruling): real Gemini
  proposed, human confirmed, row changed. Four finds: tools:[] in main.ts
  (an absent-vs-empty FIX created an absent-vs-empty BUG one file away;
  diagnosed by querying request->>'tools' — yesterday's queryability fix
  did it); logger OFF in prod ("built, ratified, tested, not switched
  on" — boot check must now assert logging is on); + the two earlier.
  **INVARIANT COLLISION RULED**: record-approvals-in-steps directive
  REVOKED (0011's closed-run invariant wins) — approvals are HUMAN
  actions. **SUPERSEDED SAME DAY by B1's convergent better shape (now
  the ruling): dedicated `echo.proposal_decision` table** — proposal_id
  PK (= the replay-409, one insert one 23505), decision approve|REJECT
  (a "no" is a human decision too), run_id/call_id/org_id composite FKs,
  decided_by stamped, append-only; NO admin_action rename (with member
  decisions on their own surface its name becomes true again). Confirm =
  ONE transaction (decision row + write) — approval_recorded:false
  becomes unreachable; reject = decision row alone. Provider-key
  exception moves to the discovery site (db/README credential table). M5 liveness gap
  recorded (retired ai21 tops the alphabet): now-fix = order catalogue by
  suggestion ranking; seam = our own agent_run error classes as the
  liveness source.
- 2026-08-13 (decisions surface built + a possible M5 violation): 0028 at
  200 checks — human_action rename, approval shape (actor
  stamped-and-CORRECTED; agent_run_id SET NULL — approval outlives purged
  run), partial UNIQUE = replay-409, both-directions transactional test.
  0029 ruled: created_by must equal registering actor ("a fact must not
  be supplyable"; webhook acts-as, if ever, = explicit column per the key
  pattern). Catalogue ordering: NO ranking existed (M5's claim was
  unmaterialized) — B1 created one LABELLED curated; but its live top-5
  includes anthropic models → **PRIORITY CHECK: no-Claude filter (M5 user
  directive) may be unapplied — verify, fix, negative-space test, purge
  Claude from the ranking**. Logger test verified-red + two self-catches
  (LOG_LEVEL silent = a test that can only pass; over-strict regex =
  asserting unpromised detail). Chain-continuity check sent to B3 (if
  human_action is hash-chained, rename must prove continuity; if not,
  dissolve the caution on record).
- 2026-08-13 (0029 + born-tested card): 0028's rename REVERSED cleanly
  (append-only price paid); `proposal_decision` built per B1's shape at
  203 checks — kind as TEXT (core owns vocabulary), BOTH links SET NULL
  (0018 class caught in a new table pre-ship), read = call-readers +
  admins, **no echo_agent grant: "an agent reading the human's answer is
  how a decision becomes a prompt."** Steward practice adopted: send a
  one-line HOLD when a ruling might be superseded in-flight (a hold is
  cheaper than a migration). Chain question moot (name reversed). web/
  vitest IN: approval card born tested (10 promise-shaped tests;
  payload-never-sent-back; stale≠error, no retry; verified-red first);
  next-intl stub reads REAL fa.json (missing key fails visibly). 375px
  squeeze fixed minimally (absence of a bug, not a pattern — FE2's
  proposal unprejudiced). FE1 milestone items DONE. Remaining: B1
  confirm-wiring + Claude-filter check; FE2 picker + responsive audit.
- 2026-08-13 (BACKEND CORE OF MILESTONE 3 SHUT, 411 tests): live loop
  green with all notes as assertions; approval_recorded gone. My crossed
  message beaten by ask-the-catalogue TWICE — standing tiebreak: when
  messages and catalogue disagree, the catalogue is the record.
  One-transaction confirm ruled IMPOSSIBLE (decision on echo_app, write
  on echo_agent — different connections; both constraints right):
  **decision-FIRST ordering carries the guarantee** (replay refused
  before anything applies; residual = visible reconcilable audit line,
  never a doubled summary). B3 annotating 45_approvals (atomic form is
  schema-only). M19 postscript added: milestone 3's defects were ALL
  configuration/contract faults — suite answers "is the logic right",
  harness answers "is the system assembled". Remaining for milestone 3:
  B1's Claude-filter report, B2 dispatcher/purge close, FE2 picker +
  audit → push #3 → PIVOT (milestone 4).
- 2026-08-13 (FE2 audit round 1 accepted — AUDIT-responsive-dark.md):
  calls table CLIPPED not scrollable below 1024 (clip defeats page-level
  overflow checks — FE1 fix #1); inert ring-offset line (Tailwind utility
  written as a CSS property — FE1 one-liner); --info light contrast
  (FE1); **44px RULED**: dense visuals keep size, shared hit-area utility
  ≥44px below md, .btn's claim moves to where it becomes true (FE1
  mechanism; priority: scope toggles / revoke / play); --accent pair
  deliberately WAITS for m4 palette re-derivation. Vacuous-checker rule
  verbatim in rule 12 (INVALID-not-result, element counts,
  synthetic-failure-verified). FE2 continues: search/skills/profile/auth
  + en<1440.
- 2026-08-13 (NO-CLAUDE FILTER: never existed — now structural): live
  catalogue had been serving 28 anthropic/* models; fixed BOTH directions
  (serve + choose-by-name), exclusion applied BEFORE the allow-list ("a
  rule any later filter can undo is not a rule"), 4 negative-space tests
  with Claude deliberately IN the mock, ranking cleaned (gpt-5-mini +
  gemini-3.6-pro replace the two Claude entries). 304 served. Root cause:
  the user directive lived ONLY in the decision log — **SPEC.md now
  carries the exclusion explicitly** ("a product rule belongs in the
  product spec" — second discovery-site fix in two days). M19 gains the
  third question: suite = logic, harness = assembly, and NEITHER answers
  "does it obey the rules we already have" — running something proves it
  behaves, not that it should. 415 tests.
- 2026-08-13 (B1 SHUT CLEAN): D20 mechanized as loop stage 7 — attempt
  the widened write on the agent connection, require 42501 ("a comment
  cannot fail; this can"). Its first version reported the floor BROKEN
  (refusal aborts the transaction; rethrow passes an inside catch — the
  floor working, presented as a crash): red-lies-too caught on
  five-minute-old code, boundary-catch comment explains why the wrong
  version looks natural. B1 reads PLATFORM-BRIEF proactively. Milestone 3
  remaining: B2 dispatcher/purge, FE1 play-button .tap, FE2
  picker/revoke/.tap/coverage → push #3.
- 2026-08-13 (FE1 SHUT): play button already covered — .btn composes
  .tap, the CLASS was fixed, not instances ("stop the claim being
  local"); desktop suppression verified (content:none at 1280); two
  probe-was-wrong catches in one day by the same distrust habit.
  Milestone 3 remaining = exactly two: FE2 (measure-don't-assume revoke,
  picker, coverage) + B2 (dispatcher/purge close).
- 2026-08-13 (FE2 round 2): connectors acceptance MET (all five branches
  render); picker landed; revoke .tap inherited (hit-test proven, exact
  44 box). **BLOCKER found: AssistantPane default-OPEN at mobile** —
  opaque fixed inset-0, app unreachable at 375 while every box metric
  improved (proxy clause added to rule 12: "a proxy metric confirms the
  fix it was chosen for, not the property it was standing in for";
  hit-testing = audit default; elementFromPoint null-outside-viewport =
  red-side trap). One-liner endorsed to FE1: default-closed below md;
  pattern stays with the held proposal. **.tap silently inert on
  replaced elements** (select/checkbox render no ::after — ring-offset
  family, in our own utility): FE1 documents-or-fixes; FE2's workarounds
  interim canon. FE2 remaining: sign-up, pending, en<1440.
- 2026-08-13 (FE2 SHUT — audit FINAL): twelve screens, both themes, en
  RTL flip clean. Best finding: the auth mark fails contrast in BOTH
  themes (3.40/1.96 — --fg and --accent flip lightness TOGETHER, so the
  pair collides in every theme; "never passed, on the first screen a
  customer sees") → **--on-accent token directed to FE1** (systemic, m4
  hub-tile groundwork). Rule 12 gained the spectrum + closing line:
  "prefer the measurement that fails when the user would fail, not the
  one that describes the layout." FE1's closing list: pane one-liner
  (blocker), --on-accent, --info, .tap docs. Milestone 3 = FE1's four +
  B2's dispatcher/purge.
- 2026-08-13 (FRONTEND SIDE OF MILESTONE 3 SHUT): pane default-closed
  below md (hit-test verified both widths; deliberately decides nothing
  about the pattern); .tap limitation documented; **--on-accent
  self-catch**: FE1's first fix added the class WITHOUT the Tailwind
  config entry — inert, markup read as fixed, numbers got WORSE
  (3.40/1.96); registered → 5.93/8.33 on all four marks. Rule 12 gained
  the CSS-layer clause: "the artifact is present and reads as satisfied"
  — read the COMPUTED value, never the class list (3 instances, one
  session, one layer). FE1's reframing kept: "I chose the metric."
  **Milestone 3 waits on exactly one item: B2's dispatcher/purge.**
- 2026-08-13 (PIVOT GO + first contact): user delivered ALL items (key
  rotated/stored, 2-voice clip → spike/fixtures/persian-2voice-1.mp3,
  WER ref corrected to 123 words, brand files) + ruled UM: Add-user=BOTH,
  delete=BOTH (true-delete w/ confirm), roles=admin/OWNER/member. FE1
  swapping to the real engine: live+stable surfaces swap; missing-wire
  features stay on MARKED fixtures (ruling: erase mocks ≠ delete shipped
  features). web/.env.local written by steward (publishable key is
  public-by-design; service key never in web/). **Wire-gap m4 package for
  B1**: /v1/me (NOW — gates the shell), speakers route, org/admin-org,
  Call wire gains archived/deleted_at/parts/current_summary_version,
  agent-runs, directory. duration_ms NULL on live rows — possible
  queried-never-stored #2 (B1 verifying with B2). FE2 running m4 design
  (brand-derived dark tokens, hub, mobile-nav — proposals first).
- 2026-08-13 (sequencing finding — first PREVENTED casebook instance):
  FE1 stopped before swapping client.ts — every BFF route 401s without a
  session, so mock-erase before /api/auth/* = uniformly broken app whose
  metric ("mocks gone") reads as success. The pane's shape recognized
  BEFORE the mistake. Ratified sequence: auth → four identity states
  against seeded accounts → swap screen-by-screen. Types mirror the live
  wire (optional-not-deleted for missing-wire fields; null renders as
  its own word: «نامعلوم», «گویندهٔ نامشخص»). PROPOSAL-01 verdict
  delivered (one violet family; indigo tile = the mark's ground; Echo
  mark drawn from description — the Android asset is a self-declared
  placeholder; bottom-bar shell + "reachable on load, every width,
  dismissing nothing"). Brand files renamed to match contents; measured
  palette #A274FF/#130036 recorded.
- 2026-08-13 (PROPOSAL-02 ruled): computed palette + runnable verifier
  (verify-pairs.mjs, exits non-zero, verified-red — first run caught a
  4.48/4.5 near-miss, the shipped-4.42 class). Ratified: border splits
  into --border/--border-strong (one value can't be decorative AND a
  3:1 control boundary; Echo inherits via re-derivation); --accent-soft
  COMPUTED (12% tint — hand-picking produced 4.42); the role flip
  documented (accent = bright surface in dark, dark ink in light;
  --on-accent flips). Echo mark red RULED #FF6F59 — obvious reds sit
  ~35 from --danger (launcher would read as an ERROR); 77 away, 7.1:1.
  Hub calls ruled: mark-not-orb (idle glow does the orb's job, no second
  identity); caption = the scope promise («هرچه بپرسید در محدودهٔ دسترسی
  خودتان می‌ماند» — M3 as first-screen copy); NO invented app tiles (a
  fabricated roadmap is a claim we'd have to keep). Next: hub mocks both
  themes/locales → steward → user sees the whole design at once.
- 2026-08-13 (/v1/me live + third instance confirmed): /me shipped with
  LEFT-join foresight ("suspended must not collapse into does-not-exist,
  one layer up"). **call.duration_ms never written** — 3rd
  declared-served-never-written instance (last_seen_at, no-Claude
  filter); ASSIGNED B2: total = max(offset+duration_ms) NOT sum (gaps
  under-report, overlaps over-report — "whoever reaches for it will
  reach for sum"); fix 0004's comment. SCOPE CORRECTION: archive/delete/
  purge fields were NEVER missing from schema — the api SELECT was
  narrow, now widened (+source, archived_at, deleted_at, purge_after,
  current_summary_id) + speakers route live → FE1 swaps those READ paths
  off fixtures; only archive/restore WRITE routes remain absent (small
  package, held with org surfaces for the m4 IA rulings — build once
  against a decided shape).
- 2026-08-13 (HUB MOCK RENDERED — with the user for the design review):
  four panels (dark/fa primary, light/fa derived, dark/en mirrored by
  dir, dark/fa/375 bottom bar); tokens IMPORTED from verify-pairs.mjs
  ("a mock with hand-copied hex is a fifth place for the numbers to
  disagree" — ratified as the standard). Two self-corrections: rail was
  inline-END in both locales (the CSS matched the wrong sentence —
  uncatchable by re-reading; §6 catching its author) → inline-START; the
  verifier needed the pathToFileURL entrypoint guard (the trap fired in
  a NEW file by someone who had just read the rule). Steward verified
  the render in pixels (file:// blocked in Playwright — serve over a
  port). NOTHING BUILDS until the user's verdict.
- 2026-08-13 (the 2-voice clip earned its keep — M6 AMENDED): dual-mono
  bug — channels-are-speakers fired on identical channels (phone memos /
  screen recorders / re-encodes), transcribing every word TWICE with two
  invented speakers at DOUBLE Soniox cost, silently; fixed with
  channelsAreDistinct() (20 dB margin; clip sat 40 dB above) + 3-way
  regression. Honest status recorded: local sherpa diarizer over-splits
  real conversation (5→1, no threshold yields 2) — the multi-speaker gate
  passes via SONIOX; local = hedge, not production-quality. normalize()
  briefly DELETED speech beyond max_speakers (M21 inverted) — now a hint
  that is reported on, never a knife. ml/ 114, core/ 419. B2 remaining:
  storage leg + non-degenerate fixture → declaration → push #3.
- 2026-08-13 (duration_ms DONE, live-proven): recompute-not-accumulate;
  NULL≠0; proven on the ONE fixture where max and sum disagree (two-part
  gap: 660000 vs sum's 120000; preserved with a don't-simplify comment).
  0004's stale prose ("Total across all parts" = the sum-reading) can't
  be edited (checksummed) → B3 adds comment-on-column: the catalogue is
  the record. 42501 on fixture cleanup recorded as a load-bearing
  refusal. core/ 433.
- 2026-08-13 (M11 BREAK FOUND — owner soft-delete NEVER worked): member
  gets 42501 deleting their own call (post-image invisible under
  call_read's deleted-gate); admin succeeds. Fix = B3's, with Q2 guard:
  branch (1) check if RETURNING-driven (api-side fix, Q2 untouched);
  else narrow deleted_by-self visibility with a MARKED Q2 amendment.
  Rules gained: indistinguishability debt (deliberate two-states-one-
  answer owes an our-side discriminator — warn on the hidden branch);
  "a peer's status claim is not evidence"; rolbypassrls precondition on
  policy checks (superuser passes everything unconditionally). M11
  ledger: broken for members, fix in flight.
- 2026-08-13 (STORAGE LEG CLOSED — 28/28, both gates one run): real
  Supabase Storage via the rotated key + two DIFFERENT clips (the
  two-call behaviour finally distinguishable). B2's own vacuous check
  caught (kind==="supabase" asserts intention; evidence = segments exist
  + minted hosts on project host, hosts-never-URLs — a signed URL is a
  credential). Allow-list had NEVER been positively exercised (dev
  loopback stood where the guard does nothing); first real host refused
  an empty list CORRECTLY. **M20 gains the segmentation rule** (speaker
  change OR VAD speech-boundary + backstop — monologues were ONE
  segment: erased middle rung, whole-call search snippets, contract
  split unhonored; VAD boundary = fixture from reality). B1 sweeping
  harness residue off dev. B2 remaining: dispatcher live, purge live,
  WER number (reference corrected — told them to run it).
- 2026-08-13 (M11 FIXED via branch 3 — 33 migrations, 222 checks): named
  definer operations soft_delete_call/restore_call (0032) — Q2 preserved
  EXACTLY (no policy widening); direct deleted_at writes refused for ALL
  app roles incl. admins; my branch (1) empirically excluded
  (bare-write test + rolled-back-widening control). D8 amended: doors
  ENUMERATED-with-reasons (4). restore RAISES for non-admin (visible
  beats silent). 0033: refusal messages name the door, not the room.
  Rule 7 gains the authorization-matrix corollary ("the ordinary path is
  the product — walk the whole matrix"; D21). Self-restore RULED BY THE
  USER: **admin-only, final** — Q2's provenance upgraded from
  steward-inference to user ruling; restore_call correct as shipped, the
  one-line change stays unwritten.
- 2026-08-13 (PURGE LIVE 18/18 — the deadlock finding): the
  already-absent branch was DEAD CODE (Supabase spells absence as 400 +
  nested "404", not status 404) → every interrupted run would retry
  forever, never deleting — **the objects-first ordering had built the
  deadlock it exists to prevent** (its recovery state was the one input
  the purge couldn't survive). Fixed at the adapter (absence decided
  where the provider's spelling is known; boolean up; deleted vs
  already-absent counted separately). The covering test threw
  {status:404} — belief-about-the-provider, fixture and bug from one
  place; replaced with the transcribed live response, verified-red. Rule
  12 gains: recovery-created states are MANDATORY fixtures. Live run
  also proved the policy-IS-the-query design (SELECT_EXPIRED has no
  where clause). core/ 445. B2's last item + question incoming →
  milestone 3 shuts on it.
- 2026-08-13 (THIRD SEAM-BREAK — M15 was unreachable end to end):
  register_account existed since 0015, granted, commented — and NOTHING
  called it; signup was impossible, the pending queue could only hold
  seed rows, the product could not onboard a single user while every
  layer's tests were green. Built: POST /v1/signup (token-derived
  id/email, gateway keys refused; 201 proof with FE1's auth build).
  **Rule 13½ minted**: a producer with no consumer is a defect the
  producer's owner cannot see — granted-vs-called instrument assigned to
  B1. URGENT crossing relayed: 0032 broke B1's direct-UPDATE delete for
  everyone — api must switch to the named soft_delete/restore_call
  functions; schema-contract repro goes green on the switch.
- 2026-08-13 (DISPATCHER LIVE 10/10): the rebinding case proven —
  localtest.me (public name → 127.0.0.1) blocked AT CONNECT, non-
  retryable, classified blocked_address not transport (the distinction
  IS the security: retrying a "transport failure" that's really a block
  = a slow scan). Verified-red: without the control, all six literal
  checks stayed green — only the rebinding case discriminates. Positive
  control included ("a guard that blocks everything is indistinguishable
  from a guard that works"). **2xx leg RULED: our own receiver as a
  Supabase Edge Function on the dev project** (verify v1 {t}.{body} HMAC
  + tolerance; 200 valid / 401 invalid; harness includes the tamper
  case — a receiver that 200s everything is vacuous). B2's remaining:
  2xx leg + segmentation build + WER number → declaration → milestone 3
  SHUTS.
- 2026-08-13 (**PERSIAN WER: 2.1%** — in M6): 2 substitutions (loanword
  spelling), 1 insertion, **0 deletions** on the user-corrected
  reference; post-normalization; token-count delta pre-explained (ZWNJ
  +22 both sides). Instrument defect found running it: /health's
  `vad: true` was a CONSTANT (fallback unconditional → could never be
  false; model-less box = green health + silently degraded jobs
  forever). Fixed: health NAMES the engine + vad_degraded;
  report-don't-refuse (M21); test asserts the lying box. Earlier runs
  used energy VAD (assertions stand); segmentation builds against
  Silero. B2 remaining: segmentation + edge-function receiver →
  declaration.
- 2026-08-13 (B1 sweep + M11 live end-to-end): harness calls swept via
  the PRODUCT's own delete (0032's first real consumer: owner 204 /
  idempotent 204 / owner-restore 404 / admin-restore 200). Harness now
  sweeps in FINALLY ("tidies-only-on-pass leaves wreckage exactly when
  someone goes looking"). Precedent: reversible path satisfies both
  house standards; where it can't, safety wins and the human decides.
  Org-count discrepancy: altitudes differ — extra orgs likely
  signup-created (pending founders, invisible cross-org); FE1's auth
  tests the candidate creator; reconciling. 9 agent_runs hard-delete =
  USER yes/no (recommended yes). /v1/signup live; 401 taxonomy shipped.
  core/ 452.
- 2026-08-13 (SEGMENTATION BUILT: monologue 1→20, two-voice 28→38):
  compare-before-offset (else every part after the first misplaces
  boundaries — invisible single-part); degraded rung EXEMPT (splitting
  would assert precision we don't have); pinned old-behaviour test NAMES
  what broke. **Gate arc completed (3rd retreat, terminus)**: the
  OFFERED-tools check (from agent_run.request) IS the gate — wiring
  can't vary, separates declined-from-never-given; the behavioural half
  = loud observation + when the model declines, ASSERT the M21
  degradation marker fired (every branch asserts mechanism; nothing can
  flake; best-of-N declined — "launders variance with spend"). B1's 11
  residual calls are soft-deleted per M11 semantics (product-invisible,
  present till window) — altitudes again, both right. B2's last item:
  the Edge Function receiver → declaration.
- 2026-08-13 (restore-404 ratified; instrument's first find): my 403
  suggestion WITHDRAWN — the sympathetic 403 requires reading deleted_by
  through Q2's wall = a probe oracle over every deleted call ("one
  answer, in both directions"); on record: if Q2 relaxes, 403 becomes
  better. Granted-vs-called instrument LIVE (16 functions; corpus =
  policies + function bodies + core/src): first find =
  **echo.actor_in_org orphaned since 0003** (B3: wire or drop; check
  stays red till resolved). Rule 12 gained the mirror trap ("a checker
  that manufactures false positives gets muted within a week and is
  then worse than absent" — the draft excluded trigger functions from
  its own corpus) + rule 9 binds live harnesses (self-seed; "did not
  run, result unknown" beats a vacuous pass). Milestone 3 = B2's
  receiver alone.
- 2026-08-13 (org hypothesis killed + a live M15 hole pre-empted): the
  signup-created-orgs candidate died structurally (failed signups leave
  no org — transactional; a signup org requires a real auth identity
  nobody made; no probe reached the insert). B3 has the producer
  question + the owner-altitude read (org names/dates identify the
  creator). **Standing rule: read-before-sweep** — an unaccounted org ≠
  residue; sweeping destroys the evidence of which. **DIRECTIVE to FE1:
  register-on-first-sign-in REQUIRED** (email-confirmation ON → signup
  returns no session → /v1/signup never called → 401 unknown_actor
  forever, no pending row; the fallback makes the toggle irrelevant —
  seam closed structurally). Third seam instance caught BEFORE going
  live.
- 2026-08-13 (register-fallback RULED — FE1's shape over my phrasing):
  mandatory + automatic in the STUCK-PROOFNESS sense (401-driven,
  unskippable one-screen org choice), **never a guess** — auto-register
  would convert "join Acme" into "admin of a brand-new org", invisibly,
  irreversibly, into the key-minting role ("something helpful absorbing
  an absence and reporting success" wearing a recovery flow). My
  "registers them before retrying" was over-specified; owned. NEW USER
  STEP surfaced: the Supabase JWT secret must land in the store
  (echo_platform_jwt_secret) for core/'s verifier — auth four-state
  proofs blocked on it.
- 2026-08-13 (orgs accounted; actor_in_org DROPPED, 0034/222): all three
  orgs benign — two seed-dev (incl. the suspended org the steward
  requested), one B2 pending-fixture; no orphans. Principle recorded:
  "an auth.users row is NOT evidence a real sign-up ever succeeded"
  (seeds write it by hand) — pre-empting the next wrong explanation
  while FE1's 201 stays unproven. Drop-not-wire ratified ("two
  spellings of one rule, one unexercised, is the drift shape"). Rule 11
  gained the counting corollary: under RLS, "I counted N" ≠ "there are
  N" — inventory answers only at owner altitude. db/ idle, 34
  migrations.
- 2026-08-13 (receiver WRITTEN + de-risked; blocked on ONE credential):
  independent second implementation from the docs ("verifying our
  signature with our own verifier proves the signer agrees with itself"
  — the customer claim is a STRANGER validates it); WebCrypto-only → 8
  vitest tests BEFORE deploy (future-dated refused as firmly as stale;
  boundary second accepted; malformed named as malformed); UTF-8-text-
  vs-decoded-bytes key trap called out; --no-verify-jwt trap recorded
  pre-deploy. Blocker: Supabase PERSONAL ACCESS token (management API) —
  two tracks: user mints fresh (echo_platform_supabase_access_token) /
  B3 identifies the unprefixed candidate (if live: account-scoped = no
  project hazard → canonical-exception ruling pre-issued). B2 declares
  on the 2xx green → MILESTONE 3 SHUTS. core 461, ml 115.
- 2026-08-13 (stale key DELETED + fast track REOPENED): rotation
  verified with THREE controls (new key sees call-audio; old key
  403-wrapped-in-400 byte-identical to an invented key; no-key differs;
  fingerprints differ) → echo_platform_service_key deleted; store =
  exactly 7 platform names. Rule 12 gained probe discipline ("a probe
  whose result you did not predict has not yet told you anything").
  No sbp_ token in the store — BUT the CLI is authenticated via the OS
  keyring (B2 checked legacy ~/.supabase, drew the opposite
  conclusion): using the authenticated CLI = the established pattern →
  B2 verifying with projects list, deploying through it if it holds;
  the user's minted token stays the fallback track.
- 2026-08-13 (USER DIRECTIVE — PIVOT CAPTURED, NOT DISPATCHED): after
  milestone 3 closes, the product restructures into the **NeurAI
  platform**: first page = dark AI-assistant hub (LIX-style reference:
  icon rail, centered greeting+orb, prompt box, app cards); **Echo becomes
  an app inside NeurAI**; selecting it docks the assistant and opens a
  merged Record-top/Calls-below surface; skills+connectors move under
  management; platform-level surfaces (user mgmt, profile, server mgmt, …)
  added. Full brief + open questions: **docs/PLATFORM-BRIEF.md** (DRAFT —
  user has more changes coming; accumulate there). M18 will be [REVISED]
  at amendment time. FE2's mobile-NAV proposal is HELD (the shell is
  changing); the rest of their audit proceeds. Milestone 3 finishes
  unchanged first (user's own sequencing).
- 2026-08-13: **24/24 — MILESTONE 2 GATE GREEN, push #2 requested.** All
  three double-encode sites route through db/jsonb.ts (grep-clean). Gate
  design ratified: demand the BEHAVIOUR (either cross-call tool), never
  the model's particular choice among legitimate paths. Worker: everything
  session-closeable is closed; open legs are user-gated (storage rotation,
  2nd Persian clip). Next milestone (post-verdict): write tools +
  approval-card flow, SSRF-guarded dispatcher, purge job. ml/ 110 tests,
  core/ 298 + 24/24 live, dev project swept to deliberate fixtures only.
