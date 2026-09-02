# NeurAI Platform (repo: MVP) — session guide

NeurAI is the commercial, Persian-first AI-assistant platform. It will host
multiple apps; **Echo** is the first: calls/meetings → transcripts → versioned
summaries → an org-scoped AI agent. Completeness and correctness over speed.
TypeScript everywhere.

**Naming convention (user-set, use everywhere):** **NeurAI Platform** means
the platform and its shared shell/surfaces; plain **Echo** means the
call-intelligence app inside it. The Android recorder app
(Desktop/Neurai-Echo repo) is always **Echo Mobile** — in conversation, docs,
commits, and UI copy.

## Sources of truth

1. **[docs/SPEC.md](docs/SPEC.md)** — WHAT Echo, NeurAI Platform's first app,
   does. Product behavior conflicts resolve here.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — HOW it's built; decisions M1–M29,
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
   not the one that failed. Count trap (B3, after three breaks of a
   literal `count(*) = N`, every one because the fixture gained an
   unrelated row and never because the rule changed): **a count is a
   fact about the fixture wearing the costume of a fact about the
   wall** — assert the property itself (the admin can see a specific
   colleague's run), never the census. Ground-truth corollary (B2:
   "persian-2voice-1.mp3" is a FOUR-person conversation — two systems
   independently agree; a day of recorded caveats scored a correct-ish
   clusterer against the filename): **a fixture's ground truth must
   come from the audio, never from its filename** — and generally, a
   caveat recorded from a measurement inherits every assumption that
   measurement made; it is not only fixtures that come from belief,
   it is the ground truth you score them against. Sibling trap, the altitude pattern: an invariant enforced at
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
   hand-written beliefs about the same wire. Relay corollary (the
   truncation finding: the steward relayed "assistant turn only written on
   delivery"; the actual rule was "only if the run produced TEXT" — one
   failure branch in the paraphrase, two on the wire, and FE2 found the
   second only because B1 sent the shape + fixture directly): **a contract
   survives being repeated and a paraphrase does not** — when a consumer
   is about to build against a shape, the producer sends shape + fixture;
   the steward relay is for routing and rulings, never the wire. The
   fixture is the part that survives: **a shape someone can run beats a
   shape someone can read, for the same reason a check beats a note.**
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
   hand at owner altitude. Catalog instance (the purge-edge check that
   nearly closed wrong): `information_schema.role_table_grants` shows
   only grants the CURRENT user can see — it returned "(none)" for a
   DELETE grant that existed, wearing the costume of a definitive
   negative; `pg_class.relacl` shows the ACL regardless. **"I cannot
   see any" is indistinguishable from "there are none" unless the
   instrument is chosen to tell them apart** — the catalog views are
   themselves permission-filtered, so even a look "at the actual
   database" can be a look from below the wall. Author-side corollary (the
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
   has children" (a partially-hydrated page satisfies that too). And the
   identification itself needs a **NEGATIVE CONTROL** (the en-sweep that
   was vacuous TWICE: first a pushState "navigation" that measured the
   hub seven times — a URL is not a subject; then positive-ID markers
   that all passed because Next's dev bundle embeds the whole message
   catalogue in every document, so every marker matched everywhere —
   caught only by asking a page for ANOTHER page's marker, which came
   back true three of three): **asserting the subject is present cannot
   distinguish "this page has my marker" from "every page has every
   marker" — only a marker that SHOULD fail can.** The second checker
   looked more rigorous than the first and was vacuous for a new
   reason; the control is the discriminating-probe rule applied to
   identification. FE1's sharper form, adopted: **a check that only
   ever asks "is the thing I expect present?" cannot fail for the
   right reason — it needs one question it should answer NO to.** Not
   just can-it-fail: can-it-DISTINGUISH. Temporal instance (the
   history_since tiles: `waitFor` on "—" passed IMMEDIATELY because
   every tile shows "—" while LOADING — the test asserted the loading
   state and reported it as the rule, passing forever against any
   implementation including one rendering invented zeroes): **an async
   assertion must be anchored to the state it is about, not merely
   awaited** — if the condition also holds in a state you didn't mean
   (loading, empty, pre-fetch), waitFor passes there and stops
   looking; anchor on a value that only exists after the state under
   test arrives, THEN assert. The vacuum can be a MOMENT, not just a
   missing subject. And the day's coinage, kept: **verify-red is the
   only thing that distinguishes a test from a test-shaped thing.**
   Arrival-state form (the theme probe: a runtime
   `dataset.theme='light'` flip measured one element in dark's colour
   while its ancestors all read light — the reading contradicted
   itself, which is what exposed the probe): **a runtime attribute
   flip is not a theme change; the only trustworthy theme measurement
   is the one the user gets — a persisted preference and a full
   load.** Verify the rendered artifact IN THE STATE THE USER
   ACTUALLY ARRIVES IN. And when a generated artifact is under test,
   RUN it, don't string-compare it — the two-theme-stores fix's test
   executes the inline script; text equality would have passed
   against the broken pair, since each half matched itself. State
   form (the calendar preference that changed the store and changed
   NOTHING on screen — a store nothing subscribes to re-renders
   nothing, and the unit tests called the formatter AFTER setting
   the preference, exercising the formatter and never the
   subscription): **a control that reads as wired and does nothing
   is only visible in the rendered artifact** — cover it with a test
   that renders inside the real shell and changes the preference
   from OUTSIDE; and React's bailout is part of the trap: same
   children reference = skipped subtree, a re-render is not a
   remount (the fix was a `key`, verified red by deleting it).
   Probe habit: when a probe drives state, drive ONE transition per
   load (compounded transitions race their own remounts; HMR can
   recompile between two probes on one page). Locale corollary (FE1): **Persian-first means the
   default path is the one that hides the bug** — a key present in
   fa.json and missing in en.json renders perfectly for whoever wrote
   it; sweep the locale you are structurally less likely to look at. Stated as
   the rule: **a checker that can pass vacuously must assert it had
   something to check** — return INVALID instead of a result when the
   subject didn't render, carry an element count with every pass, and
   verify the guard fires on a synthetic failure before trusting any
   result. The mirror trap (the orphan-checker's first draft excluded
   trigger functions from the very corpus it searched and reported a
   consumed function orphaned): **a checker that manufactures false
   positives gets muted within a week and is then worse than absent** —
   fails-when-it-shouldn't is the failure that kills adoption. Second
   instance (FE2's locale audit): a Jalali-month regex reported
   `jalaliMonths: true` on a page whose dates plainly read "14 Jun
   2026" — «دی» was matching inside «محمدی», a person's NAME. A
   substring match on short Persian month names, run over a corpus
   containing Persian names, is a false-positive factory; scope the
   probe to the cells that hold its subject. The catch, both times: the
   result contradicted what was plainly on screen. And rule
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
   0015 landed. Second instrument (fourth seam-break, /fa/echo — the
   first one a USER found, which is the detail that matters: our checks
   covered zero route-to-route reachability; every session verified its
   own screens and nobody verified the links between them): **every
   internal href the shell/nav/hub renders must resolve inside the route
   tree** (page or redirect) — a link is a promise, and the failure mode
   lives in the space between two individually-correct halves. Fifth
   instance, with a twist (Role drift: M23 added `owner`, web's union
   never learned it, and vocabulary.guard.ts covered every union EXCEPT
   the one that drifted): the instrument existed with a hole exactly
   where the break came — **a guard's coverage list is itself a seam;
   derive it from the producer's exports rather than hand-enumerating**.
   And the human half (FE2 wrote `String(u.role) === "owner"` twice to
   sidestep the stale type, self-reported): **a cast against a wire type
   is a drift report someone decided not to file** — every `as` /
   `String(...)` around a wire value reads as "the type and the server
   disagree here, and I chose not to say so." Corpus discipline (the
   column tripwire that stayed green when `truncated` landed: the check
   grepped for the column NAME, and the file already contained the word
   as a derived alias — **the name matched itself**, reporting "all
   consumed" about a column nothing read, in the instrument built that
   morning to catch exactly this): **a name-grep can be satisfied by
   the name's own presence in the code that fails to use it** —
   substring matching makes an alias, a comment, or a type
   indistinguishable from a read; match the form a real use must take
   (`m.<column>`, the qualified reference), and prove the tightened
   check fires before trusting it.
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
   written for before trusting it. Drift-direction form (the
   no-synthetic-message rule: a tidy "something went wrong" bubble READS
   AS POLISH and is only wrong on the axis nobody checks — in a
   persisted record it becomes indistinguishable from something the
   assistant said): **a negative rule needs a test that fails when
   someone makes the code NICER, because nicer is the direction code
   drifts** — FE2 turned the annotation into a bubble, watched
   `expected 2 to be 1`, restored. Docs form (B2, on the README that
   said "75 tests" long enough to be wrong by a third): **a count in
   prose is a fact that must be manually synced against a fact that
   changes every commit, with no mechanism available to catch it** —
   remove the number and point at the instrument (`npm test` prints
   the real one). A *measurement with its conditions attached* may
   stay: it is a recorded observation, not a number that silently
   rots. Type-level assertions included (the
   bar-ceiling check: `.filter()` widens `length` to `number`, making a
   compile-time count vacuously true or permanently false regardless of
   the actual count): **a check that cannot fail for its own reason is
   worse than none** — prove a static assertion can fail before trusting
   it, exactly as with any test. The symmetric duty (route-manifest
   finding: a tree-fragment parser reported eleven "missing" routes that
   exist): **verify a failure names a real defect before relaying it — red
   output lies exactly as fluently as green.** Trust corollary (the
   reachability check's first fire, a false positive relayed as
   "yours to resolve" without ten seconds of falsification): **a new
   instrument hasn't earned the trust you extend it — a first red
   deserves the same verification a first green does**, and an
   unverified red has the worse blast radius: it sends someone else to
   fix code that isn't broken. Timing form (the boot-test
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
  System.Text.UTF8Encoding($false)))`. **The READ side is the same
  bug pointed the other way**: PS 5.1 `Get-Content -Raw` reads a
  BOM-less UTF-8 file as ANSI — a read-modify-write round-trip
  mangles even when the write is correct; use
  `[System.IO.File]::ReadAllText($p)`. **After ANY encoding repair,
  GREP for the corruption signature — never inspect the strings**:
  `â€`, `Ã`, `Â«`, `Ù`, `Ø`, `ï»¿`, and a cp1252 non-breaking space
  (`Â` followed by U+00A0). The visual check is structurally
  blind to the residue that survives (FE1 verified the Persian and
  the ZWNJ — fine; five mojibake em-dashes sat in the ENGLISH prose
  beside them: the eye goes where damage is expected, the damage
  lands in the punctuation nobody re-reads). The nbsp one matters
  most because it RENDERS AS A SPACE — it survives the careful
  visual check too, and has no symptom until something downstream
  trims or splits on whitespace.
  Two notes that save a rediscovery:
  (a) the sweep must cover EVERY script in the file, not the one
  that motivated it — a Persian-shaped pattern (`Ø|Ù|Â«`) cannot
  return a mangled em-dash, so a clean result from it is not
  coverage, it is a question that could only ever have passed;
  (b) **this file matches its own sweep**, because the signature
  list is written out above. One expected hit in `CLAUDE.md` is
  the list itself, not a finding.
  (c) **Restrict it to TEXT.** Run with `-I` (or `--include='*.ts'`
  etc.). Unrestricted, the same pattern hit 27 binaries — fonts,
  ONNX models, PNGs, webpack `.pack` files — because arbitrary
  bytes contain these sequences by chance. A check that reports 27
  false hits is one nobody runs twice, which is how a rule dies
  without being repealed.
  (d) **The sweep must be byte-level over `git ls-files`, never a
  text grep with default filters** — ripgrep skips dotfiles by
  default, and `.gitignore` (the SECRETS GUARD) was corrupted (BOM
  + double-encoded em-dashes) while a whole-repo sweep reported
  clean: the corruption was present the entire time and the check
  could not return it. Hidden files and anything the tool skips by
  default are exactly where an unswept file hides. After repairing
  an ignore file, verify FUNCTIONALLY (git check-ignore on the
  critical patterns INCLUDING a negated control — "a negation is
  the thing that silently stops negating"), never visually.
- **Second PS hazard, ABSOLUTE for this repo: paths with brackets belong
  to the file tools, never to shell copy/move.** The route tree is full
  of `[locale]`, `[[...section]]`, `[id]` directories, and PowerShell
  wildcard-expands `[…]` as a character CLASS — FE1's backup of a route
  file silently never happened while the delete succeeded (restored via
  Write). The failure is silent in exactly the direction that destroys:
  the read matches nothing, the write still fires. `-LiteralPath` exists
  but remembering it per-call is the trap; the rule is tools-not-shell.
- **Third Windows hazard: never create two files differing only in
  casing** (FE2: `breadcrumbs.ts` beside `Breadcrumbs.tsx` — the
  case-insensitive filesystem resolved `./Breadcrumbs` to the OTHER
  file, and Linux would resolve it differently again). Same family:
  silent in the direction that looks like it worked. Pick names that
  differ by more than case (`trail.ts`).
- **Tooling note: the Bash and PowerShell tools share ONE working
  directory** — a `cd` in one moves the other. A typecheck run green
  from the wrong directory is a vacuous pass; invoke build/test
  commands with explicit paths or verify cwd first.
- `*.docx`, `docs/*.pdf`, `.env*`, keys and keystores never reach the repo.
- Reference codebases (read-only, do not modify): `Desktop\neurai-mvp`
  (on-prem predecessor), `Desktop\Neurai-Echo` (cloud recorder — the pgmq-style
  worker, RLS wall, harness lanes, and near-miss hygiene lessons live there).

## CURRENT STATE — read this first (2026-08-14, sessions closed for the
## night; the user resumes with FRESH sessions that onboard from THIS file
## + ARCHITECTURE.md + docs/PLATFORM-BRIEF.md)

**THE PLATFORM HAS ITS FIRST REAL MEMBER.** neurai.git.acc@gmail.com =
active OWNER of org "neurai" (vendor-accepted 2026-08-14 ~14:19, history
recorded, accepted_by NULL). The full chain is live-proven end to end:
dashboard Add-user -> sign-in -> register-on-first-sign-in (org-choice
screen) -> real pending screen -> vendor_accept_org -> active. The
sign-in's ES256 token was verified by the NEW JWKS branch live. The dev
db holds ONLY this member + seeded fixtures (residue swept).

**Deployment (Option C, chosen):** web on Vercel = production LIVE at
**mvp-web-beta.vercel.app** (project mvp-web, personal Hobby scope
"neurai", slug neurai2; auto-deploys on push to main; deployment
protection OFF; Next patched for the RSC CVE).
**[SUPERSEDED 2026-08-15 — backend moved OFF the PC, M12 amendment is
the record]**: api/worker/ml now run on **Hetzner neurai-core-1**
(178.105.251.216, systemd, deploy = git archive + ml/models +
scripts/deploy-secrets-to-server.ps1); public API =
**https://api.neurai.pt** via Cloudflare Tunnel on the server; domain
neurai.pt on Cloudflare DNS (one.com mailboxes preserved via MX copy).
start-platform.cmd is now LOCAL DEV ONLY; the PC serves nothing. The
old rule "one session runs the stack" applies to the SERVER now:
service control via systemd over SSH, key ~/.ssh/neurai_hetzner. Supabase facts a session must know:
project aqgpxnyuxukwgphrxslw; **tokens are ES256** (kid 4800f423...,
P-256; legacy HS256 rotated out — core verifies via JWKS, code in
core/src/api/jwt.ts, SUPABASE_URL env required); built-in email sender
rate-limits (~2-4/hr) — dashboard Add-user bypasses email; Site URL
should be the Vercel URL + localhost:3100 in additional redirects.

**Client-body swap ledger:** LIVE = auth forms (sign-up/sign-in REAL —
email-not-username, suspended screen exists, Google buttons removed),
me() (adapter, 401->null, 403s re-thrown), listCalls/getCall/setScope/
getTranscript/getSpeakers/getSummaries, audit(), serverHealth(),
updateProfile(), updatePreferences(), setLocale(). STILL FIXTURE =
members()/memberStats() (item 3, FE-next), org()/updateOrg(),
conversations client, write-path calls, restore/archive/delete (no
callers/routes — deliberate).

**IN FLIGHT AT SHUTDOWN (a fresh session picks these up from the brief
round 3 + this block):** (1) FE: password self-service — change-password
(signed-in) + forgot-password recovery page consuming Supabase's
recovery via server-side code exchange (M1: browser never holds
tokens); was mid-build when sessions closed — check the tree for
partial work before restarting it. (2) B: vendor-identity proposal owed
(how the product knows the signed-in person is the platform owner —
schema-grantable only, D27) -> then the APPROVALS CONSOLE (user
approves pending registrations in-product; round-3 directive). (3)
remaining swaps + the shell identity guard (direct-URL 403 for
pending/suspended). (4) publisher: final 2 README screenshots (Audit
Logs + Management-Server need a signed-in browser — now possible via a
dashboard-created test account, accepted via vendor op). (5) push #5
(epilogue commit) was requested at shutdown — VERIFY main==origin
before any new work; if the push didn't land, the evening's work
(auth forms, JWKS verifier, swaps) sits UNPUSHED in the tree.

**Roster at shutdown:** FE2, FE3, B2, B3 deleted earlier (lanes closed;
ownership: all web -> FE1-successor, db operator steps -> B1-successor,
ml dormant). ALL remaining sessions closed tonight by the user. Fresh
sessions onboard from this file; the casebook rules 1-13.5 + the
Windows/PS hazards below are the law of the repo; the day's ~50 minted
lessons live in the Status log below and in ARCHITECTURE's amendments.

## STEWARD HANDOVER (2026-08-14 — the steward session closed too;
## its successor reads this after CURRENT STATE)

**The role:** rulings, coordination, verification, release gate. The
steward builds nothing and hosts nothing (tonight's server-hosting was
an emergency exception, now retired to the user's dedicated server
session). Hard-won protocol, all proven today: relays are for routing
and rulings, NEVER the wire (producers send shape+fixture direct —
rule 10); a summary is testimony, not a record (approvals re-asked,
never adjudicated from memory); irreversible deletes take the user's
line IN THE EXECUTING SESSION; the catalogue/database outranks any
declaration including a session's account of itself; verify a red
before relaying it; sessions confess their own instrument failures
and the confessions become rules — that loop is the team's engine.

**The user's working style:** short directives, screenshots as
evidence, decisions theirs ("I decide") — present numbered options,
wait for the word. They delete sessions freely once lanes close;
everything must live in files, never in session context.

**Open on the ruling desk for the successor:**
1. Vendor-identity proposal (Backend owes it) -> user rules -> the
   APPROVALS CONSOLE gets built (round-3 directive #1).
2. Password self-service completion (was mid-build; round-3 #2).
3. Cloudflare Tunnel on the user's word -> CORE_API_URL in Vercel ->
   full Option C online.
4. GO-PUBLIC DECISION POINT (recorded, not urgent): git history holds
   core/supabase/.temp (dev project ref) since c791b3e — a decision,
   not an oversight, if the repo ever goes public.
5. Production Supabase project + paid Vercel tier when real customers
   arrive (deliberate step, user's call).
6. Neurai-Echo DEPLOY.md publish decision (hardcodes a live project
   URL; placeholder-vs-env — user's call).
7. Verify push #5 landed (main==origin) before ANY new work.
8. Supabase Site URL -> Vercel URL + localhost:3100 redirect (small,
   user does it in dashboard; improves confirm-email landing).

**Where the full story lives:** this file's Status log (the day's ~50
minted lessons in chronological order), ARCHITECTURE.md M1-M25 + amendments,
docs/PLATFORM-BRIEF.md rounds 1-3, docs/CLOSE-m4-frontend.md + core's close
declaration, and the steward's memory file (auto-memory, survives all
sessions) for the cross-session narrative.

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
- 2026-08-13 (MILESTONE 4 catch-up entry — dispatch through review round 1):
  hub design USER-APPROVED ("start it") → M22–M25 cut, all four lanes
  dispatched (FE2 shell+hub+Management LIVE on :3100, M22 law verified;
  B1 Audit Logs + org profile live, 490 tests, keyset-not-offset +
  org-status-not-settable ratified; B3 owner enum landed; FE1 auth
  four-state proof running on the stored JWT secret). **User review
  round 1** (on the live shell) → M24 amendment: username first-class +
  own column, display_name_en dual-name (fallback = fa name UNCHANGED
  and visibly the same string — absent, not derivable), locale-solid
  incl. dates/digits, identity-surfaces-ONLY scope (content names stay
  as authored), last-action column (null = "not seen yet"), back
  affordance everywhere, chevron spacing via the shared select.
  personName() single-resolver + search-matches-BOTH-names ratified
  (FE2). Tombstoned username freed-vs-reserved: B3 proposes inside the
  tombstone decision.
- 2026-08-13 (FOURTH SEAM-BREAK — /fa/echo, the first a USER found):
  hub card linked FE1's unlanded surface → bare 404 on the product's
  centrepiece. Fixed same-day (redirect at the RIGHT address — replaced
  in place by the merged surface, locale preserved, verified by
  clicking). Rule 13½ gained its second instrument: **every internal
  href the shell renders must resolve in the route tree — a link is a
  promise**; FE1 building it into web/'s suite (rule-13 discipline:
  make it fail for its own reason first). Stale pre-pivot routes ruled:
  skills/connectors → redirect into Management homes; capture/search
  resolve until absorbed → redirect to /echo; nothing deleted while a
  redirect is cheaper than a broken bookmark. Rule 12 gained the second
  false-positive-factory instance (FE2's «دی» inside «محمدی»). FE1's
  400→401 fold fixed (sign-up 400 = input rejected, NOT credentials —
  "one status standing in for two facts", the wrong one more
  plausible); Supabase validator rejects example.com/.local — auth
  proof's human step = a real deliverable mailbox signup (on the
  user's list; confirmation-ON path is the one that most needs
  proving, and register-on-first-sign-in makes it the row-creating
  path).
- 2026-08-13 (identity fields LIVE end-to-end, 519 core tests): B3's
  username/display_name_en migration landed and B1's armed tripwire
  caught it ON ARRIVAL (catalogue-vs-MEMBER_COLUMNS check, verified
  fireable first — second tripwire fire in one day; rule 13
  compounding). /v1/me + PATCH live; ratified: separate self-naming
  route ("names you call yourself vs. things done TO you"),
  case-normalize-not-reject, **null-clears/omit-leaves** via explicit
  supplied-flags (coalesce trap named — "save button does nothing" for
  exactly one interaction), constraint-is-the-enforcer (api regex
  mirrors it, 23514 backstop re-speaks the same sentence), 409 names
  the field. **avatar_url ruled KNOWN_ABSENT** (no upload path →
  consumer with no producer; initials ARE v1). Both FEs unblocked —
  personName() goes live on FE1's type regen; null-vs-omit relayed as
  the contract fact a form author gets wrong by reflex. FE1's
  touched-ness framing ratified: clear-vs-never-touched is a FORM-STATE
  distinction (an empty input looks identical for both) — kinds of
  nothing, one layer further out than usual.
- 2026-08-13 (reachability check's first fire = FALSE POSITIVE — caught
  before it drove work): the new route check reported TopBar's
  `href="/settings"` dead; steward verified THREE ways before anyone
  fixed anything (route renders; import is @/i18n/routing's
  locale-aware Link, which prefixes before the router sees the href;
  rendered menu item reads /fa/settings in the DOM). Correct code,
  wrong model in the checker — rule 13's symmetric-duty precedent
  exactly (the tree-fragment parser's eleven "missing" routes), and
  the skipped step was the one FE1 had just cited: verify a red names
  a real defect BEFORE relaying it (FE2 had been sent to fix a
  non-defect; stood down). Checker fix directed: model the resolver
  (or walk rendered output), allow-list `#` placeholders WITH reasons,
  then stage a true dead href and prove it still fires — its only
  real-world fire being false means it has never yet demonstrated a
  true catch. Suite-stays-red holds only while the red is TRUE; red on
  a false positive is the mute-within-a-week path.
- 2026-08-13 (members search/filter/sort LIVE, 530 core tests — and a
  steward misread corrected by a build): B1 read the dispatch right
  where my "nothing else pending" read it wrong, and built the last
  unblocked UM piece. Ratified: sort = closed KEYS mapped to SQL
  (key≠SQL test — "the gap IS the proof it was mapped"; column names
  must never become API contract), last_seen NULLS LAST ("someone
  never seen is not the most recent thing that happened"), search
  spans all four identity columns (server side of
  search-matches-BOTH-names — independent convergence with FE2's
  client rule), escaped-wildcard ilike (unescaped `%` = the filter
  silently stops filtering), filters validate against vocabulary
  constants (owner filterable the morning it was born; test named for
  it). FE2 pointed at query params, never client filtering (RLS
  counting corollary). All 18 granted functions consumed. Remaining
  UM blocks: B3's status-history (trends), tombstone/invite shapes.
- 2026-08-13 (reachability check CLOSED CLEAN — 22 tests): FE1 fixed
  the checker (resolver modelled — hand-written locale prefixes
  normalised; source-scan limits written INSIDE it; rendered-walk
  recorded as the stronger successor), `#` = explicit allow WITH
  reason ("a deliberate no-op is a different thing from a broken
  promise"), and TRUE POSITIVE PROVEN through the locale-aware path
  (staged dead href fired naming link + file; first /echo red
  retroactively confirmed true via the nav path — the check has now
  demonstrated true catches on both covered paths and its one false
  positive was exactly the unmodelled case). Rule 13 gained the trust
  corollary ("a new instrument hasn't earned the trust you extend it —
  a first red deserves the same verification a first green does").
  Second Windows rule minted from FE1's unforced confession:
  bracket-paths belong to the file tools — PS expanded `[locale]` as a
  character class, the backup silently never happened while the delete
  succeeded (restored via Write; read-matches-nothing/write-still-
  fires is the destroying direction).
- 2026-08-13 (Role drift found by ITS OWN victim — rule 13½ fifth
  instance, both halves minted): web's `Role` union never learned
  `owner` (M23), and vocabulary.guard.ts covered every union EXCEPT
  the drifted one — "a guard's coverage list is itself a seam;
  derive from the producer's exports" + FE2's self-reported casts →
  "a cast against a wire type is a drift report someone decided not
  to file." FE1 fixing union + guard line, derive-or-completeness-
  assert suggested. Ratified: `default` member sort STAYS default
  (pending-on-top — B1's comment and FE2's layout independently
  agree); FE2's client-search marked INTERIM in code with the reason
  (counting corollary + pagination: "the browser searches whatever
  was downloaded and reports a count for it") — tolerable only while
  Phase A returns all members in one response; swaps at client.ts
  params. FE2 also probe-verified FE1's resolver fix wasn't BLUNTED
  (staged dead href still flagged; deep settings path correctly
  passes — checked served, not reasoned) — the too-eager-true
  direction nobody re-measures, closed.
- 2026-08-13 (TABLE instrument's first run: one scheduling seam + one
  unbuilt FEATURE, 536 core tests): third 13½ instrument (functions →
  routes → tables: every echo table consumed by core/src or listed
  with a reason). Finding 1: user_status_history had ALREADY LANDED
  while B1 and steward both described it as pending ("nobody was
  wrong, the fact had nowhere to surface") → stat tiles BUILT same
  hour: counts from current state, movement from history, and
  **history_since null = "we were not recording" → render "—" never
  "0"** ("a fabricated delta arrived at by honest arithmetic";
  were-we-recording query deliberately unwindowed). B3 pinged to
  DECLARE package state — migrations landing faster than messages.
  Finding 2: **agent_session/agent_message = register_account at
  table scale** (designed 0018, Q5 purge semantics ruled, policies
  live, zero rows, zero api) → M4 AMENDMENT cut: neither missed nor
  deferred — designed-but-never-scheduled, NOW scheduled to B1
  (sessions + thread append by the agent loop; B1 shapes contract,
  steward ratifies; load-bearing for the pivot — "proposals live and
  die in their conversation" requires a conversation that persists).
- 2026-08-13 (B3 DECLARED: 0035–0042, 269 checks — and the tombstone
  ruling cut): username per-org-NOT-global (existence-oracle
  rationale), ASCII handles (bidi @mention has no unambiguous end),
  backfill tidied (0042 un-padded 0039's over-padding),
  display_name_en refuses blanks so the fallback fires.
  Status-history: INSERT held by NO role — record_status_change()
  refuses pg_trigger_depth()=0 ("the api can neither author a trend
  nor omit one"; refused attempts leave no line; B1 warned the
  instrument needs a reasoned entry, not a caller). **RESERVED
  ratified**: tombstoned handles never re-worn (freeing =
  impersonation-by-succession, "a small forgery machine" with
  retroactive damage; per-org tenancy defused the reservation-leak
  counter); explicit owner reclaim-op only-if-ever-needed, NOT built;
  full erasure = platform-level, outside v1. Invite + tombstone cut
  together next (reservation asserted in tombstone tests); B1 on M4
  conversations meanwhile — no lane idle.
- 2026-08-13 (B3 PACKAGE COMPLETE — 0043–0045, 292 checks, D23–D26):
  invitations (show-once token hash-only, one-live-per-email,
  terms-immutable → revoke-and-reissue) + tombstone (empties person,
  REPLACES email, deleter-attributed call soft-deletes ride M11;
  reservation ASSERTED — newcomer wearing the handle refused).
  **B3's deviation RATIFIED AS D25**: invited → ACTIVE; the inviter's
  role bounds what they may GRANT (owner→admin only, nobody→owner),
  never whether acceptance is needed ("a difference the invitee
  experiences and cannot explain"); steward's "pending row" phrasing
  was the weaker reading — corrected in the open, which is the
  standard. redeem_invitation requires ADDRESS MATCH ("a forwarded
  link must not turn a named invitation into a bearer token"),
  refusals indistinguishable (api told: don't helpfully
  differentiate). Casebook: **search_path='' resolves plpgsql bodies
  at EXECUTION, not creation — qualify everything not built in,
  extension types included** (0045 exists because ::citext passed
  every signature and failed inside a body); B3's vacuous-assertion
  catch (fixture person had no handle — set one first, both checks
  became real). Milestone 4 db/ lane: DONE.
- 2026-08-13 (CONVERSATIONS BUILT + contract ratified, 540 core
  tests; instruments closed the reporting gap THEMSELVES): lazy
  sessions announced by additive SSE `session {id,created}` sent
  first ("lazy creation only works if creation is announced");
  run-per-MESSAGE (nullable agent_run_id load-bearing — a human's
  turn has no run); titles from first question NEVER rewritten
  ("renames the entry someone is scanning for while they scan");
  resume is a READ; tool_calls codes-only in the thread (arguments
  quote transcripts — the trace lives on the narrower audit surface).
  Ordering ratified: user turn BEFORE stream (bad session = clean
  404; failed run leaves the question standing — the honest record);
  assistant turn BEFORE done (reload-on-done must find the message);
  persistence fault swallowed at the stream WITH steward rider:
  loud in observability (indistinguishability debt otherwise).
  Round-tripped live — first rows EVER written to that schema
  ("genuinely unknown rather than merely untested"). B1 learned
  B3's 0043–0045 from the INSTRUMENTS, minutes after landing, no
  message — the 13½ family reaching design intent; reds = worklist
  (invitation/tombstone routes next). KNOWN_UNREAD emptied by BUILD.
  UI dispatched: FE2 hub conversation UI, FE1 client.ts additions.
- 2026-08-13 (Management·Users DONE server-side + the negative-control
  clause minted): FE2's UM screen fully on query params, owner casts
  gone (Role fixed), 30 tests PAIRS green. Rule 12 extended from
  their double-vacuous en-sweep: pushState measured the hub seven
  times (a URL is not a subject), then positive-ID markers all
  matched because Next dev embeds the full catalogue in every
  document — caught ONLY by the control (another page's marker came
  back true 3/3; fixed by scoping to <main> via DOMParser). Minted:
  **a positive-identification check needs a negative control — only
  a marker that SHOULD fail can distinguish identification from
  ambience**; the second checker looked more rigorous and was
  vacuous for a new reason. FE1's locale corollary minted beside it:
  **Persian-first means the default path HIDES the bug** — sweep the
  locale you're structurally less likely to look at (ss01 shape).
  FE2's own meta stands: "the control is the version that isn't
  luck." Holds: 375 recount (chevron+back), memberStats,
  server-health reads — all on B1's queue.
- 2026-08-13 (a HOLD that was message latency, released same hour):
  B1's instruments found invitation/tombstone live while holding B3's
  "NOT started" declaration — but B3's OWN completion report (0043–
  0045) had superseded it and the steward relay crossed B1's message
  in flight. The catalogue was ahead of B1's INBOX, not of B3's
  reporting. B1's refusal to build against an unconfirmed shape was
  correct-by-their-information ("a shape visible before it was meant
  to be is what gets revised — I'd rather wait a round than build
  twice"). Standing reading ratified with amendment: instruments =
  record of fact, declarations = commentary, AND a missing
  declaration may be one in transit. Also: B1 ran the granted-vs-
  called instrument BEFORE writing the steward-suggested exemption
  for record_status_change — not needed (the corpus counts function
  bodies + policies; trigger-invoked = consumed); steward prediction
  wrong, "run it before you believe it" beat a plausible description
  twice in one day, both times the description was the one to be
  talked out of. **"Retired" not "taken"** ratified for the
  tombstoned-handle 409 ("taken implies a person currently has it —
  after a tombstone, precisely what is not true"). 542 core tests.
- 2026-08-13 (hub conversation RULED a STATE, not a redesign — M22
  amendment): FE2 asked instead of quietly reinterpreting the
  user-approved first screen; ruled their way BECAUSE it preserves
  the approval (idle = approved anatomy exactly; active = thread
  replaces centrepiece, prompt at foot; history = top bar, never
  permanent width — "chrome that costs a first impression to earn
  nothing"); permanent sidebar declined as it would alter what the
  user signed off — recorded reversible-by-user. Contract confirmed:
  session-capture is the load-bearing half (dropped id = "a client
  that starts a new conversation every message while looking like it
  remembers"); mock must honour persisted-before-done (rule 10 —
  FE2's ask); failed run = user message ALONE in the thread (B1 to
  confirm in their own wire + fixture — a branch that otherwise
  never renders).
- 2026-08-13 (ConversationThread BUILT frame-agnostic, 35 tests —
  two lines minted): FE2 built the half the pending ruling doesn't
  touch. **Annotation-not-bubble ratified into the M4 contract**: a
  failed run renders as a muted annotation on the user's message, no
  role — "the thread is the record, and our commentary on it must
  never be able to join it" (a persisted error bubble is, a week
  later, indistinguishable from something the assistant said); a
  question is unanswered only when the run is OVER ("an error state
  shown on the normal path is how users learn to ignore a warning").
  **Rule 13 gained the drift-direction form**: a negative rule needs
  a test that fails when someone makes the code NICER — FE2 made the
  annotation a bubble, watched `expected 2 to be 1`, restored. Both
  crossed answers re-sent (frame = state-of-hub; failed run = user
  message alone).
- 2026-08-13 (TRUNCATION RULED — the failed-run shape was incomplete
  on the wire): B1's persist condition is EMPTINESS not failure → two
  shapes. Shape A (failed saying nothing) = user message alone,
  unchanged. **Shape B (failed AFTER text): partial answer persisted
  UNMARKED — after reload it renders identically to a complete answer
  the model chose to give** («سه موضوع مطرح شد: نخست» acted on as
  whole — fabricated completeness arrived at by honest persistence;
  the worst member of the family in a product whose value is not
  re-listening). Ruled per FE2's recommendation: marker on the
  EXISTING assistant row (annotating how a real turn ended ≠
  fabricating one; "Shape A's reasoning doesn't reach B"), in
  messages(), rendered annotation-not-bubble; loudness rider extends.
  Rule 12 closing line adopted from FE1's compression: "a check that
  only ever asks 'is the thing I expect present?' cannot fail for
  the right reason — it needs one question it should answer NO to.
  Not just can-it-fail: can-it-DISTINGUISH." FE1's plain "NOT done"
  on two fixtures logged as the standard — a red you can trust beats
  a green you can't.
- 2026-08-13 (truncation amendment RATIFIED — derived-not-stored,
  576 core tests; rule 10 gained the relay corollary): B1's
  `truncated` = LEFT JOIN to agent_run.status (fact already in the
  db — no migration, no second copy that can disagree); `= true`
  never `!== 'ok'` ("a false 'cut off' on a complete answer is its
  own lie"; unreadable-run branch pinned). STEWARD QUESTION OPEN:
  does agent_run outlive agent_message? If a purge cuts the run link
  while the thread survives, the derived marker evaporates and the
  truncated-reads-complete lie RETURNS at purge time — B1 verifying
  against the actual purge path; materialize-at-link-cut is the fix
  if runs can predecease messages. Rule 10 relay corollary minted
  from B1's process note: **"a contract survives being repeated and
  a paraphrase does not"** — steward paraphrase had ONE failure
  branch, the wire had TWO; producer sends shape + fixture whenever
  a consumer builds; the relay is for routing and rulings, never
  the wire.
- 2026-08-13 (purge edge RULED materialize-at-death — B1 and steward
  found it independently, crossed in flight): B1 argued leave-it-
  derived ("purge fails toward the vaguer answer"); steward ruled
  against — vaguer is true of the SYSTEM's claim, false of the
  READER's experience (unmarked truncation IS the false answer; the
  ruling's own sentence), and **the record's honesty must not have
  an expiry date**. Neither stored-always (two spellings drift daily)
  nor derived-always (marker dies with its source): column stamped
  ONLY at link-cut, read = COALESCE(stored, derived), at most one
  authoritative source at any moment — the middle dissolves both
  objections. B3 dispatched (their record_status_change pattern);
  current behavior recorded as KNOWN LIMITATION in M4 until it
  lands. safe-null stays right for unreadable (transient) — purge
  is gone-forever, a different nothing.
- 2026-08-13 (purge edge CONFIRMED empirically by B1 — and a catalog
  near-miss minted): echo_purge holds DELETE on agent_run, nobody
  deletes agent_message, ON DELETE SET NULL — runs CAN predecease
  messages; materialize-at-death asks crossed (B1's and steward's to
  B3 — consistent, B3 reconciles, shape theirs). **Rule 11 catalog
  instance**: information_schema.role_table_grants returned "(none)"
  for a grant that EXISTS (view is permission-filtered) — first
  query was against the live db and still wrong; pg_class.relacl is
  the owner-altitude instrument. "'I cannot see any' is
  indistinguishable from 'there are none' unless the instrument is
  chosen to tell them apart" — retires "I checked the real database"
  as a sufficient claim. Rule 10 closes with B1's corollary: "a
  shape someone can run beats a shape someone can read, for the same
  reason a check beats a note."
- 2026-08-13 (trends WIRED "—"-never-zero + the temporal-vacuum
  clause, 39 FE2 tests): interim second-fetch retired on its stated
  expiry; all three tiles dash-with-tooltip, verified live. Rule 12
  minted FE2's catch: their waitFor("—") assertion PASSED DURING
  LOADING (every tile dashes pre-fetch) — asserting the loading
  state and reporting it as the rule, green forever against any
  implementation; caught ONLY by deleting the null-guard and
  demanding red (still green → anchored on post-data value → red →
  restored). "An async assertion must be anchored to the state it
  is about, not merely awaited — the vacuum can be a MOMENT."
  Coinage kept: "verify-red is the only thing that distinguishes a
  test from a test-shaped thing" (their own rule landed on them
  twice today; both reports became everyone's rule). Gate-mock
  misattribution logged (unmocked memberStats threw as "table never
  rendered" — scrollIntoView shape: a mid-render exception reads as
  whatever died, not the missing stub that killed it).
- 2026-08-13 (invitation/tombstone ROUTES LIVE — B1's lane closes
  modulo one discrepancy): echo_inv_ prefix distinct from echo_sk_
  (isApiKey can never claim one; raw-token-in-no-query-param
  tested), issuer-checked role ceiling, revoke-and-reissue 409,
  identical redeem refusals; DELETE members/:id = tombstone_user
  owner-only; retired-handle 409 fires for members, pending sees
  the vaguer fallback (B3 settled visibility empirically). B1's
  weighing self-correction kept: "grading my own honesty by what
  the api asserts rather than by what a person ends up believing."
  Stamp tripwire armed table-scoped (wider would cry wolf — the
  calibration is now a design input). STEWARD FLAG: FE2 still holds
  "B1's server-health reads" (M25 server-mgmt surface) while B1
  reports nothing queued — built-unannounced or not-started; B1 to
  declare; milestone close hangs on it.
- 2026-08-13 (marker LANDED 0046+0047 + truth-table seam; USER doc
  directive dispatched): B3's stamp = BEFORE DELETE on agent_run
  ("the database is where the fact stops being readable, so it is
  where the fact gets written down"; message-side trigger impossible
  — SET NULL fires after the run is gone). 0047 caught the
  running-state bug the steward's "more endings" hint exposed
  (stamping an abandoned run complete = the precise lie the marker
  prevents; trust only a clean finish). SEAM OPEN: stored (not-ok)
  vs live-derived ('error') truth tables diverge — abandoned runs
  read complete pre-purge; B1+B3 reconciling (steward suggested a
  stale-'running'→'error' sweeper: one table, honest at
  abandonment). Rule 9 gained B3's count trap ("a count is a fact
  about the fixture wearing the costume of a fact about the wall").
  USER DIRECTIVE dispatched: Documentation session →
  complete-blueprint docx (start-to-end diagram, all layers / tech /
  details, docx-js + Playwright-SVG + COM pipeline); Github session
  → MVP README refresh with screenshots, diagrams, launch methods
  (prep-now capture-last; exclusions + credential scan as always;
  push #4 still on steward ping).
- 2026-08-13 (milestone accounting SETTLED + the name-matched-itself
  instance): B1 declared server-health reads NOT started, straight
  ("miscount not claim") — their last m4 item, building now. B3's
  two narrowings ratified (both-outcomes stamp; no echo_app write on
  truncated — "never two writable copies" applied to its own
  proposer). Rule 13½ gained corpus discipline: B1's column tripwire
  stayed GREEN when truncated landed — the check grepped the NAME
  and the file contained it as the derived alias ("the name matched
  itself"); fixed to qualified `m.<column>`, proven red. Fourth
  vacuous-instrument instance today, first where the instrument was
  built THAT MORNING to catch its own class. FE2's resume tests:
  orphaned-thread case (follow-up after resume adopts the id or the
  user "talks to a fresh conversation while looking at an old one"
  — no symptom, verified red on the adopt-line deletion); FE1's
  fixture reversal made the branch coverable within the hour. FE2's
  self-summary recorded over the steward's compliment: the rules are
  downstream of a transferable habit — "break the code, demand red,
  disbelieve any result that contradicts something plainly
  visible."
- 2026-08-13 (USER REVIEW ROUND 2 — grouped-menu headers): group
  titles must read as LABELS not items (Settings sidebar exhibit:
  پیکربندی/اتصال‌ها/انطباق read as one flat menu). Spacing gap +
  theme-dependent receding color, ONE design-system pattern across
  ALL grouped menus. FE2 owns (folds into the same single 375
  recount as chevron+back — three reflow changes, one measurement);
  FE1 adopts where shaped alike. Recorded in PLATFORM-BRIEF round 2.
- 2026-08-13 (GitHub refresh LIVE — d5d1956, ahead of push #4):
  English README (M25 feature set), two mermaid diagrams (layer
  topology + pipeline with the M20 degrade branch — rendering
  VERIFIED on the live page), launch methods reproducible by a
  stranger (secret NAMES only; --no-verify-jwt documented with its
  reason), five screenshots (not captioned as finished; recapture
  rides the milestone-close ping). Only README+screenshots staged —
  in-flight m4 work untouched; private re-verified. Steward ruling:
  honest-state paragraph STAYS (visible-but-inactive entries are the
  M25 design, and a private engineering README should say so);
  revisit-at-public-audience recorded as a user decision for later.
  Playwright-writes-to-ITS-cwd trap noted (PNGs landed in
  neurai-mvp, moved; tree confirmed unpolluted).
- 2026-08-13 (0b2582d rulings + one more in-scope-unscheduled piece):
  screenshot swap RATIFIED — recorded rule: **"prose describes the
  discipline; photographs show finished surfaces"** (a shot that's
  half amber disclaimer documents a state, not a design; steward's
  honest-paragraph ruling and FE2's swap call compatible, both
  stand). Built-vs-designed table STANDS un-imminent ("a README that
  predicts is a README that lies on a delay"); updates ride the
  close pass. The table EXPOSED: **Audit Logs read surface —
  M25-committed, api live, in nobody's queue** (conversations
  discovery's smaller sibling) → dispatched to FE2 after their
  layout batch, with the contract facts (keyset cursor,
  unknown-source = rendered error, codes-not-content rows,
  drill-down DEFERRED until this UI demonstrates need).
- 2026-08-13 (USER: avatar-menu required set — brief round 2 item 5):
  identity header (name+email via personName), Account, Theme
  (ONE state with Settings·General پوسته), Time & calendar
  (timezone + Jalali/Gregorian pref — "Auto (follows language)"
  default preserves the locale-solid ruling, explicit choice
  overrides; wire field via FE2↔B1 shape+fixture if needed),
  Sign out (FE1's auth client, consumed not forked). Example's
  extra entries NOT required; five = the floor. FE2 dispatched.
- 2026-08-13 (USER: breadcrumb trail — REVISES the back affordance,
  LEADS the batch): asked twice ("still don't see the back option"),
  form specified (Supabase org/project bar): top-bar breadcrumb,
  ancestors clickable = the back navigation, deepest crumb =
  non-clickable page title, locale-aware direction. ONE mechanism —
  FE1's per-page back-button pattern RETIRED before shipping; FE2
  builds (TopBar theirs), FE1 feeds entity titles (call title =
  data, source settled FE1↔FE2 direct). 375: ancestors collapse
  sensibly, same single recount, but built FIRST — the user is
  watching for exactly this. Brief round 2 item 5 [REVISES r1 i7].
- 2026-08-13 (publisher housekeeping): swapped screenshot lives as a
  history blob (git show d5d1956:… is the retrieval path; no disk
  archive for an unreferenced file). Keeper minted to the log: **the
  Built-vs-designed table caught the unscheduled surface BECAUSE it
  forced a per-surface claim rather than a feature list** — a list
  lets "✓" mean anything; a row must say which half exists. 75f976d
  (call-detail + search shots) noted; re-shoot list held for the
  close ping, verify-not-assume on shots FE1 expects to survive.
- 2026-08-13 (BLUEPRINT DELIVERED — user directive task closes):
  docs/MVP-Architecture.docx rebuilt, 29pp, 16 sections + 5
  purpose-drawn diagrams (whole path; layers with what each may NOT
  hold; permission stack + definer doors; status-vs-transport +
  forfeit hierarchy; agent locks + proposal path), M1–M25 + D1–D26
  narrated with reasoning AND rejected alternatives, render-verified
  page-by-page (Word COM), gitignored. Its two verified-not-inferred
  corrections, both ruled DOCS-were-the-bug: **Drizzle was NEVER
  INSTALLED** (M8/M9 [CORRECTED] → postgres.js, ratified
  retroactively — the hand-written-SQL security reason is served
  BETTER without a builder; deviation had gone unflagged through
  every review — caught because a per-dependency claim forced the
  check, the per-surface-table lesson again); counts stale (48
  migrations not 47 — B3 to declare 0048; ml/README 75→~110 → B2).
  db/README Drizzle mention → B3 next touch.
- 2026-08-13 (SEAM CLOSED 0048–0050, 300 checks — and the sweeper
  DECLINED with better reasoning): one predicate both halves —
  not-ok AND (terminal OR stalled past window from started_at).
  Churn recorded untidied at B3's insistence (0049 removed the
  clock, 0050 restored it for the unsaid reason: started_at frees
  the read from the append ordering AT ALL — "I had removed the
  structure and kept the dependency"); all four steps reasoned in
  0050's header. **No sweeper — B3's ruling RATIFIED over the
  steward's suggestion**: stale running rows = hygiene not
  correctness; earns-its-place condition = when "runs in progress"
  becomes a number a person acts on → named operation, explicit
  actor, never a silent background writer (D12 discipline applied
  to the steward's own idea). db/README: no-ORM correction live
  ("if you are building from this file, do not install one"). db/
  50 migrations, 300 checks; one-arg signature removal awaits B1
  confirm.
- 2026-08-13 (B2's deviation RATIFIED — rule 13 docs form): told to
  fix "75 tests", they REMOVED the number with the reasoning left in
  the README ("a number a human has to remember to update is a
  number that will be wrong again; npm test prints the real one").
  Minted: prose counts get removed in favor of the instrument;
  measurements-with-conditions stay (RTF line = recorded
  observation, not a rotting number). Siblings checked (only claim
  of its kind); deviate-and-surface over comply-quietly, again the
  standard. ml/ 115 passing, package closed.
- 2026-08-13 (round-2 headers DONE + the two-theme-stores defect):
  root cause flat (titles and items BOTH --fg-muted); fix = one
  NavGroup pattern, --fg-subtle + spacing, verify-pairs asserts the
  RELATIONSHIP (subtle < muted — the future "contrast improvement"
  fails loudly), both themes measured on REAL LOADS. Sixth wrong
  probe self-caught (runtime dataset flip ≠ theme change; reading
  contradicted itself) → rule 12 arrival-state form + RUN-generated-
  artifacts-don't-string-compare. Real defect found: anti-flash
  script read echo-theme/light, toggle wrote neurai-theme/dark —
  "the script caused the flash it exists to prevent", chosen theme
  lost each first paint; fixed STRUCTURALLY (theme.ts generates the
  script; drift unrepresentable; tests RUN it, verified red against
  the old pair). **DEFAULT_THEME=dark RATIFIED** (one document one
  answer, M22 dark-first). web/ 46 tests; recount set grown
  (breadcrumb leads batch per crossing dispatch).
- 2026-08-13 (blueprint FINAL 32pp — the subset claim FAILED its own
  check, then closed): 9/62 topics missing from the "superset", FOUR
  covered only inside diagram images — minted: **"a picture is not
  coverage"** (content that exists only as pixels is invisible to
  Ctrl+F and every scripted search); restored 62/62, Word-COM dump +
  regex = the repeatable method, old heading list = the fixture.
  file:// caveat CORRECTED with evidence: not blocked for
  SELF-CONTAINED documents (five SVGs first-attempt); the
  http.server pattern applies when a document resolves PAST itself
  (sibling assets — the hub-mock case). Declined blind adoption of
  the workaround, with evidence — accepted. Documentation package
  CLOSED.
- 2026-08-13 (USER: full-board drive + FE3 ADDED): "fix all I asked
  step by step until the end, no FE/backend session without work."
  Board dealt: **FE3 (new, local_266c1320…)** = Audit Logs surface
  (B1's live api, shape+fixture direct) → Log Drains shell →
  Management·Server wiring (B1 pings THEM now) → org-fields form
  (last, claim w/ FE2). **FE2** = breadcrumb FIRST → Management
  two-pane → avatar menu → conversation UI → single recount (Audit
  Logs + server wiring offloaded to FE3). **FE1** = declare state on
  chevron/composer/client.ts, then profile form → stale-route
  redirects → wire-shape migration → merged surface. **B1** =
  server-health reads (consumer now FE3); owes B3 one-arg confirm.
  **B3** = vendor-accept path for pending orgs (D25's missing exit?
  verify-or-build as named definer op). **B2** = ml/ reopened:
  crosstalk case on the 2-voice clip + diarizer over-split
  investigation (measured bound = a deliverable). Blueprint build
  pipeline → docs/blueprint-src/ (gitignored) per steward
  instruction. User step unchanged: the gmail signup.
- 2026-08-13 (handover RAN + a steward conflation corrected + B1
  lane re-filled): blueprint-src on disk, gitignore-verified, and
  the handover FAILED its first run from the new home (.js parsed
  as ESM under root type:module → build.cjs; "it isn't done because
  it's in place, it's done because it ran"). Steward conflation
  owned and corrected with both sessions: "one-arg
  redeem_invitation" fused two functions — redeem always had ONE
  signature; the real item (run_is_truncated one-arg) was already
  dropped in 0051 and re-proven under a running caller. B1: ALL
  dispatched work built + live-verified (586) incl. server-health
  reads — FE3 delivery pending session recovery (user poked); 9
  agent_run rows: user approval ON RECORD pre-compaction —
  execute-if-same-rows, describe-if-different (an approval covers
  what was described, not whatever is there now). B1 assigned
  release-gate prep (re-run live lanes, regenerate contract, close
  declaration with live-proven vs schema-true-screen-unproven kept
  distinct).
- 2026-08-13 (BREADCRUMB LIVE — 61 web tests; declared-table
  RATIFIED): trail verified per-page via DOMParser (never substring
  — catalogue-in-every-document); hub renders NOTHING (one-crumb
  trail = label navigating nowhere, on the signed-off screen); 375 =
  chevron+parent RE-RENDER of the same trail, hit-tested through
  .tap's 44px (box metric would lie both ways). **Declared table
  not pathname split** (path-derived would teach an IA the rail/
  cards/pivot contradict) + coverage instrument (route-tree-derived,
  negative control, no-dynamic-parent) — first run caught
  /management/models reachable-and-unnamed EVERYWHERE (fixed with
  the page's own h1, both locales; index card falls to two-pane).
  Title contract: null=untitled ≠ undefined=not-loaded (FE2
  corrected FE1's proposal). Windows hazards 3+4 minted:
  case-only-differing filenames (FS resolves to the OTHER file);
  Bash/PS tools SHARE one cwd (green typecheck from wrong dir =
  vacuous). FE2 forwards B1's server shape to FE3 verbatim. Next:
  Management two-pane.
- 2026-08-13 (B1 REFUSED the sweep — twice right; steward lesson
  minted): the set shifted (11 rows, 2 minted BY the gate-prep
  itself — "an approval covers what was described" applied against
  the steward's own instruction), AND B1 caught the account's
  inconsistency: the "pre-compaction approval" came from a
  compressed summary while their continuous record lists it
  outstanding. **"A summary is testimony, not a record — when a
  compressed account and a session's continuous record disagree
  about an APPROVAL, re-ask, never adjudicate."** Question to the
  user with the 11-row read verbatim; sweep-after-gate recommended
  (live lanes keep adding rows; the proposal-loop harness now
  sweeps its own calls — residue generator closed). Also owned:
  "regenerate the contract" = third cross-repo conflation (this
  repo's contract = wire + vocabulary + route-manifest.test.ts,
  all source); route dump DECLINED (second spelling of one truth).
  B1 close declaration ACCEPTED: live-proven vs
  schema-true-screen-unproven, the gate's shape.
- 2026-08-13 (USER RULED, direct answer: **sweep at milestone
  close**): B1 re-audits whatever test residue exists at gate time
  (read-before-sweep, list in the close report), deletes in ONE
  pass. The approval's description — "test residue present at gate
  time, audited immediately before the sweep" — cannot shift the
  way "9 rows" did. Real user data (post-signup) out of scope; test
  residue only. Relayed to B1.
- 2026-08-13 (D27 MINTED + a kill authorized): B3 verified the
  vendor path EXISTS and is audited (vendor_accept_org /
  vendor_pending_orgs, echo_vendor-only, history via the guard,
  NULL=vendor) — framing corrected: the org is never pending,
  register_account creates it ACTIVE with a pending OWNER. Next
  door: **an admin could brick their own org permanently**
  (org_admin_update covered status; every reverse predicate
  required an active org — M25's "the grant stays" WAS the
  vulnerability). 0052: org status vendor-only at the GUARD +
  vendor_set_org_status both-directions-one-door; members' statuses
  untouched. **D27 as a class: any transition that removes the
  actor's power to reverse it needs its exit built with its
  entrance.** 0052 blocked by B1's orphaned idle-in-transaction
  connection (32min, THREAD_QUERY, max:1 nesting hang) — B3 held
  the line, steward AUTHORIZED the kill on their evidence
  (fresh-connection control proved abandonment); B1 to close the
  leak; idle_in_transaction_session_timeout on dev roles suggested
  as the mechanized guard. db/ 51 migrations + 0052 pending, 301
  checks.
- 2026-08-13 (STANDING PROTOCOL from B1's line-hold): **irreversible
  deletes take the user's approval line in the EXECUTING session** —
  a relayed approval is still relayed ("a summary is testimony"
  pointed at steward messages, correctly); the steward's structured
  prompt answer is real on the steward's side of the wall and
  unauditable from the executor's. At the gate: user drops one line
  in B1's session; ruling shape unchanged. B1 also flagged: org.ts's
  status-refusal gets re-checked alongside 0052 landing ("a refusal
  that predates a fix isn't evidence the fix needs nothing from
  you").
- 2026-08-13 (0052 LANDED + 0053 ratified — db/ 53 migrations, 310
  checks, lane clear): the kill went moot (B1 self-terminated —
  their own killed-foreground orphan, pid 6284, exactly what the
  control implied); recorded: "asking cost one message; being wrong
  about a debugger would have cost a diagnosis — the cheap side of
  an asymmetric bet is usually the one that also treats a colleague
  as a colleague." 0053 = idle_in_transaction_session_timeout,
  three ratified choices: 5min (clears the agent-loop-across-
  model-call legitimate gap, ~20× worst observed; visible-failure
  vs costs-nothing asymmetry), EVERYWHERE (longer = deliberate
  ALTER ROLE with stated reason, never a default nobody chose),
  owner/migration role EXCLUDED (reaping schema surgery is worse
  than the leak). Suite-asserted. D27's distilled form into the M25
  amendment: **"a decision enforced at a layer the write can be
  routed around is a preference, not a rule"** — third arrival of
  the altitude finding.
- 2026-08-13 (MANAGEMENT TWO-PANE LANDED — 61 web tests): ONE
  extracted TwoPane renders Settings AND Management ("the second
  copy is the one nobody makes"); real groups (افراد/دستیار/سرویس —
  "a grouped menu is only worth having if the groups answer
  different questions"); round-2 rules measured in the NEW sidebar,
  active-item-as-discriminator built into the probe (pushState
  lesson mechanized). Three decisions RATIFIED: landing-not-redirect
  (refusal card must not be Management's first face to a member),
  refusal-keeps-pane, no-back-inside-a-pane (breadcrumb = the way
  out). /management/models in menu+cards with honest notWired —
  closes the morning's reachable-and-unnamed find, full circle.
  Stub moved out one boundary and the reasoning got STRONGER
  (section menu = privileged links on the very screen asserting a
  member sees none). Next: avatar menu → conversation UI → recount.
- 2026-08-13 (0053-vs-B1 disagreement RULED — stands with
  assignment, not exemption): B1 (crossing 0053's landing) objected
  to the timeout on echo_app ("a long transaction is a bug I want
  to SEE, not have silently killed"). Ruled: 0053 stands — (1)
  idle-in-transaction ≠ running statement (mid-execution never
  killed; idle-between-statements in a supervised api = stuck
  handler, write never completing); (2) 5min cleared the
  legitimate-gap analysis; (3) the real risk (unexplained abort)
  closed by ASSIGNMENT: B1 recognizes the reap error explicitly in
  api error-mapping/logs so the net surfaces as a diagnosis —
  converts the objection into the visibility B1 wanted.
  Measured-case escape hatch = 0053's own deliberate-ALTER-ROLE
  path. Also logged: B1's stale-comment fix ("a comment whose job
  is to explain why a decision is the ONLY protection is exactly
  the one that misleads once it stops being"); D27 audit across api
  surfaces clean (remaining one-way doors all deliberately ruled;
  members.update refused self-demotion BEFORE the class was named —
  evidence D27 is a pattern, not a story about two incidents).
  Harness leak closed at source (30s local belt). FE3: fifth
  delivery failure; user poke still pending.
- 2026-08-13 (0053 recognition BUILT, 590 core tests — the
  disagreement banked as a win): 25P03/57P01 → loud diagnosis in
  LOGS ONLY, never the body (a caller learns nothing about our
  connection handling from a 500); MappedError gained `diagnosis`
  for SQLSTATEs with operational meaning; four pins incl. the
  negative — **"a diagnosis that attaches to everything explains
  nothing."** B1's own synthesis kept verbatim: no timeout = nobody
  learns anything for 30 minutes; timeout alone = unexplained 500;
  both = the stuck handler names itself within five minutes —
  "neither half is sufficient and I was arguing for zero of them."
  FE3 REACHABLE (user poked); onboarding delivered; B1 resending
  contracts.
- 2026-08-13 (FE3 address farce resolved — catalogue over
  declaration, funniest instance): FE3 self-reported a "new session
  id" that the REGISTRY NEVER CONTAINED; the original id was alive
  and running the whole time (early bounces = initialization, not
  death). All parties corrected to the original address; memory
  updated with the rule's new corollary: **trust the session list,
  not a session's account of its own id.** FE3's claim CONFIRMED
  (Audit Logs, home = Settings·COMPLIANCE — no fourth Management
  group), section-registry entry claims through FE2, TwoPane
  consumed never forked; B1's shapes+fixtures re-routed to the
  working id.
- 2026-08-13 (AVATAR MENU LANDED — the user's five, 70/71 web
  green): identity/Account/Theme/Time&calendar/Sign-out live,
  Settings kept (earns its place below md); one-store theme PROVEN
  both directions; **axes ratified: digits with the LANGUAGE,
  months with the CALENDAR**. Findings: (1) green suite + clean
  typecheck while every route 500'd (client/server boundary only
  the build enforces — rule 9 runtime family, new layer; fixed by
  store/hooks split); (2) THE catch: preference changed the store
  and NOTHING on screen (no subscriber; unit tests structurally
  blind — called formatter after set; only the rendered date showed
  it; React children-bailout → key remount, verified red) — rule 12
  state form minted; (3) one-transition-per-load probe habit.
  AUDIT_SOURCES coverage red correctly routed to FE3 (instrument
  forces the decision); /v1/me email drift filed-not-hidden to FE1
  (producer ahead of consumer this time). INTERIM localStorage
  prefs: RULED open the PATCH /v1/me preferences slot with B1 NOW
  (gate-staged idle; per-device prefs = half-feature). Next:
  conversation UI → recount.
- 2026-08-13 (ml/ REOPENED AND CLOSED — the caveat was wrong, 115
  tests): the "2-voice" clip is a FOUR-person conversation (Soniox
  + local diarizer independently agree; backchannel voice, named
  participant) — the over-split caveat scored the clusterer against
  the FILENAME; M6 corrected. Threshold 0.5→1.0 (single-speaker
  control flat across the range = the safety proof; NOT 1.05 —
  anti-overfit at n=2; errs toward the human-fixable direction);
  minDurationOn/Off rejected (deletes 17% of speech — M21 applied
  to a parameter sweep). CROSSTALK BOUND recorded: full overlap
  loses 30% of words while every indicator reads clean (confidence
  is not a detector — 4pt drop inside between-clip spread); overlap
  detector = pyannote model = NAMED backlog. Rule 9 gained the
  ground-truth corollary: "a fixture's ground truth must come from
  the audio, never from its filename — it is not only fixtures that
  come from belief, it is the ground truth you score them against."
  Stale README claim left UNASSERTED (provenance ambiguous —
  couldn't re-measure what it referred to).
- 2026-08-13 (FE2 BATCH COMPLETE — conversation UI + recount, 55
  tests green): Shape-B marker rendered as the ruled annotation,
  asserted BOTH directions ("a false 'cut off' is its own lie"
  mechanized; === true never truthiness); 375 recount covers all
  four reflow changes — M22 law holds (chevron slot open pending
  FE1). Probe corrections logged: NEXTJS-PORTAL trap
  (elementFromPoint returns the dev-overlay HOST — "ask the
  hit-test about the product, not the toolchain"; inverse of the
  AssistantPane shape), probe-state leak (own menu left open),
  500-mid-recompile + wrong-subject-name → two INVALIDs ("rather
  two INVALIDs than one confident wrong number"). FE3's red tree
  routed file-by-file (Audit Logs in flight, theirs). FE2 next:
  web CLOSE DECLARATION (gate-prep mirroring B1's) → preferences
  wire consumption (on B1's slot) → email into identity header (on
  FE1's types fix). FE1 CHASED: chevron blocks FE2's last
  re-measure; email/Role types, composer, client.ts, profile form,
  redirects, merged surface all undeclared. **"a duplicate of a
  contract reads as a correction — the reader goes looking for a
  difference that isn't there"**; delivered payloads of record get
  a one-line arrival check, never a resend. B1 gate-staged final:
  590 green, 22/22 granted functions consumed, three live lanes
  clean, close declaration written. Outstanding = the user's two:
  sign-up (converts schema-true→live-proven, unblocks FE1) + the
  one-line sweep approval in B1's session at the gate.
- 2026-08-13 (FE1 DECLARED — five done, four owned-open): chevron
  DONE with the one-character RTL lesson (**pe-9 not pr-9** — "pr
  would have looked right in English and pushed Persian off the
  wrong side"; both directions verified); User.email REQUIRED
  ("string? to spare three test files would put a lie in the type
  to dodge a compile error"); ROLE_MATCHES + USER_STATUS_MATCHES
  (the new coverage test found the second unguarded on first run —
  the instrument auditing the auditors); conversation client
  methods + unanswered-thread fixture; members/stats/truncated/
  session-event/crumb-leaf all in. OPEN, owned: composer (slipped —
  "kept losing to whatever arrived next"; NEXT before anything),
  profile form, redirects, merged surface (last, deliberately).
  13 shared-tree reds attributed across THREE sessions file-by-file
  ("web/ is red" would misread as one session's fault). Live
  handover: crumb leaf wired but not rendering on Echo detail —
  EchoAppShell-outside-CrumbTitleProvider hypothesis, sent as
  observation-not-diagnosis (FE2's provider). FE2 told: recount
  slot can close; email narrow-read retires.
- 2026-08-13 (FE2 BATCH FULLY CLOSED incl. recount, 88 tests green
  — and the crumb bug root-caused): FE1's hypothesis was WRONG and
  the discipline right — the cause was NESTING DIRECTION (the page
  rendered the shell, so the page was the provider's PARENT; a
  provider only receives writes from descendants; Management would
  have failed identically). Moved to [locale]/layout.tsx. Minted:
  **"a React context default that silently accepts writes is a
  missing floor"** (no-op setter = "no provider" indistinguishable
  from "nobody set a title", both sides correct from where they
  stood; default deleted, hook-outside-provider now THROWS naming
  the fix, verified red); **"a producer and a consumer with no
  common ancestor"** (13½'s newest shape — neither package wrong,
  failure only in the composition); **"a fix's re-measurement
  belongs to someone who didn't watch it land"** (independent
  chevron confirmation, 6/6 selects both locales). Prefs slot
  opened with B1 (auto-is-a-value flagged); server shape forwarded
  verbatim with paraphrase retracted. FE2's remaining active item:
  the web CLOSE DECLARATION (reminded — unmentioned in their
  report).
- 2026-08-13 (FE3 FIRST DELIVERY: Audit Logs renders real rows —
  and TWO structural finds): built against B1's CAPTURED body (the
  fixture immediately caught digits()-doesn't-group-thousands —
  "my hand-written fixtures all agreed with me, because I wrote
  both"); honest status ladder: schema-true / fixture-proven /
  screen-proven-to-the-auth-wall / NOT live-verified (3×401
  consistent). Address error owned (scratchpad dir read as session
  id — "I had the catalogue in hand and quoted myself instead").
  RULED: **admin_action has NO WRITER** (one third of the feed
  structurally empty — "true about the data and false about the
  world") → close the writer, NO copy (a caveat becomes a lie the
  day writers land) → B1 assigned (the writer-discipline line's
  write half, codes-not-content). Dead-letters copy DROPPED
  (labelling `retrying` as dead letters makes a correct number
  wrong). **next build FAILS** (Hub useSearchParams sans Suspense)
  under 91 green tests + clean typecheck + perfect dev render —
  web/ never runs a production build; FE2 assigned fix + the
  api-boot-sibling BUILD GATE ("a change that breaks the
  production build cannot stay green"). FE3 next: Server wiring →
  Drains shell → org fields.
- 2026-08-13 (FE1: server FIXED with evidence + composer + PROFILE
  FORM live, 100 web tests): corrupt webpack pack cache re-read
  every compile (never self-recovering; concurrent compiles the
  likely writer) — tree killed, .next cleared, all routes 200.
  Composer: dir EXPLICIT per locale (auto "would sit LTR on an
  empty box and jump on the first Persian keystroke"). Profile
  form: three-state patch preserved end-to-end (absent/null/string
  — derived by draft-vs-saved comparison); **BFF taxonomy hole
  fixed** (400/409 fell through as `upstream` — "a form keying off
  that would offer a RETRY for a taken username"); server's
  sentence verbatim (the rule and taken-vs-retired distinction are
  core/'s alone); 409→field with aria, outage NEVER pinned to the
  field; tests assert the PATCH BODY ("'the form submitted' is
  true in every broken version of this"). Shared-surface fixes:
  username string|null ("the type was denying the state the
  feature exists to create"); updateProfile SPLIT (core ignores
  unknown keys in silence = save reporting success while the
  setting never moved; setPreferredModel own route; setLocale
  client-only, flagged-not-invented). RULED: refusals get
  CODE+PARAMS (localize-at-source = wrong altitude; client
  translation = re-implementing the rule; params keep the
  localized sentence true; distinct codes for taken vs retired;
  English sentence = honest fallback) → B1, plus strict-body
  consideration + locale joins the prefs slot. FE1 next:
  redirects → Call-onto-wire → merged surface.
- 2026-08-13 (ADMIN_ACTION WRITERS LIVE — the feed's third closed,
  621 core tests; prefs slot closed too, 0054): seven operations
  via ONE helper taking a **tx not a Db** ("a log in its own
  transaction can record an action that failed or miss one that
  succeeded — an audit that disagrees with the world while looking
  authoritative"); **failure to record FAILS the operation** ("an
  unrecorded action is worse than a refused one: the refusal is
  visible, the gap is not"); recorded only-when-a-row-moved (four
  refusal pins); field NAMES never values; role never email
  (no-parameter test); TWO entries for a combined patch (log
  granularity ≥ operation's); live-verified OUT OF THE FEED.
  RULED: insert policy TIGHTENED at the wall (any-active-member →
  admin/owner actors via role_is_admin(); "integrity resting on
  callers" = the day's own distilled line, applied to a table born
  the same day; B3 cutting); ADMIN_ACTIONS one-file vocabulary
  accepted as the right trade (a new admin op shouldn't need a
  migration to name itself). FE3 told (ship-no-copy retroactively
  perfect); B1's next queue = refusal CODE+PARAMS, strict-body,
  locale-into-prefs.
- 2026-08-13 (0055 LANDED + the M11 gap ruled as ONE decision —
  db/ 55 migrations, 320 checks): admin_action insert policy
  tightened via role_is_admin() (both-ways asserted; orphaned
  camelCase check picked up). B3's two questions dissolved into
  one ruling: **member deletion events get their own metadata-only
  record surface — direction ruled, build DEFERRED** (proposal_
  decision precedent; severable link survives purge; "the row's
  content purges — the fact of a deletion is not content"; the
  purge-vs-append-only tension was never about the same thing).
  M11's "always logged" AMENDED to name today's honest state
  (deleted_by stamp only, purged with the row — the doc must not
  promise what doesn't exist; drizzle lesson pre-empted). Nothing
  enters milestone 4; the question has an answer waiting for a
  build slot instead of an absence waiting for a customer.
- 2026-08-13 (B1's THREE closed same-day, 627 tests — and locale
  EXISTED): refusal {code, params} shipped (**"the params are what
  keep a translation true when the rule changes — the whole reason
  this is not just a code"**; min/max from the regex's own
  constants; omit-not-null presence signal; taken/retired distinct;
  code-as-surfaced, no decorating unrendered paths). Strict body
  shipped (unknown_fields + names as param; written-out allow-list
  — a derived list grows a hole the moment someone adds a field
  and forgets the route). **app_user.locale EXISTS** — FE1's "core
  has no locale column" was the FOURTH stored-and-never-served
  (after last_seen_at, duration_ms, lifecycle fields); B1 read the
  catalogue before acting (the two truths need OPPOSITE fixes);
  habit named: **"core has no X" deserves a catalogue read every
  time — a column nobody reads and a column that doesn't exist are
  indistinguishable from outside.** Locale wire-live in the prefs
  slot; FE2's consumption = three prefs + coded refusals, fully
  unblocked. Gate record corrected per B1's own ask: conversations
  = "proven at the repo, unproven as an integration."
- 2026-08-13 (FE2 corrections + the sentinel experiment — 116 web
  tests): prefs consumption NOT unblocked — one layer over (FE1's
  types/client/BFF carry nothing; producer shape sent QUOTED with
  the null-must-not-be-nullable warning — the two-spellings problem
  must not reappear at the client; FE1 queue +1). MINTED: **"when
  a colleague asks whether you broke something, the useful answer
  is an experiment, not an assurance — and the experiment had to
  be able to convict me, or it would have been the vacuous kind"**
  (sentinel file survived a full gate build — the gate provably
  doesn't touch .next; earlier un-isolated build owned as a
  PARTIAL cause of the 500s). Field/hint a11y fix ruled+done (hint
  inside label = accessible NAME was label-plus-hint, announced
  whole on focus; aria-describedby + skip-rather-than-guess on
  multi-element children — "a describedby pointing at the wrong
  control is worse than none"); detection lesson: **asserting
  presence cannot distinguish a correct name from a name with the
  whole hint glued on** — it took an exact-name assertion (FE1's
  getByLabelText). Suite green while typecheck+build red = the
  split the gate exists to show, day one; FE1's two in-flight reds
  told-not-filed.
- 2026-08-13 (FE1: redirects MEASURED + Call on the wire, 116 web
  tests): 307s live (admin/skills/connectors/echo), capture/search
  200 by design. **Factor-of-1000 caught by the migration**:
  fixture duration_seconds vs wire duration_ms — a 30-minute part
  would have rendered as 1.8s, "a number that looks like data, not
  like an error"; audio_url DELETED not renamed (a client never
  addresses storage). MINTED: **Exact<> is blind to an extra
  OPTIONAL property — a guard that reads as satisfied, one level
  up** (key-set assertion added, three local-only fields named;
  temp_probe proved key-guard-red/Exact-green — both seen red
  before either trusted). status-as-string consequence TAKEN
  (narrow-constant membership; the cast alternative "compiles and
  asserts the server can only send what this file already knows").
  Browser-verified incl. the mixed call's per-part caveat. The
  13:57 .next/server deletion: likely FE3's pre-gate DISCOVERY
  build (the run that FOUND the Suspense failure — un-isolated by
  necessity, gate didn't exist); raw `next build` on the shared
  tree = named collision class, use the gate. FE1 reminded of
  crossed queue: BFF routes + prefs plumbing BEFORE/WITH merged
  surface.
- 2026-08-13 (FE3 items 2+3 SCREEN-VERIFIED — 120 web tests):
  Server page wired with the discriminating pair rendered right
  (verify-red on `value || "—"` — a REAL ZERO reported as
  unmeasured = the null-honesty rule inverted); amber-only-when-
  nonzero with a negative control; the dead-letters claim gone AND
  a second stale promise found by a NEGATIVE test one component
  away (**"a row that cannot be filled is a promise, not a
  metric"**). Drains shell honest-inactive with the claim
  distinction minted: **"'you have not configured any
  destinations' is a claim about the ORGANIZATION; 'destinations
  cannot be configured' is a claim about the PRODUCT — rendered,
  they are the same picture"**; null-component proof that the
  subject guard is load-bearing (both negative tests green against
  a deleted component). Zero-viewport trap logged for all: hidden
  browser pane lays out at width 0 ("overflows" true of every page
  ever written; explicit width/height, never the preset;
  INVALID-when-vw-0). The .next wipe CONFIRMED theirs (the
  pre-gate discovery build); gate needs nothing (already isolates
  via .next-gate — FE3 corrected). B1 asked for a real
  admin_action capture (the loosest contract deserves the realest
  fixture). FE3 next: org fields — the milestone's last screen.
- 2026-08-13 (the capture's free gift): B1's real audit capture
  (two admin_action rows from real mutations, rolled back — no dev
  residue) carried an IDENTICAL millisecond timestamp on both rows
  (one transaction, now() = transaction time) — the exact tie
  FE3 had argued was guaranteed-not-theoretical when they found
  the paging defect, appearing unprompted in the FIRST real
  capture of the feature that produces it. MINTED: **"a
  hand-written fixture would have had two tidy, distinct
  timestamps, because that is what a person writes"** — rule 10's
  whole argument in one sentence, delivered by the fixture itself.
  All three feed sources measured; nothing hand-derived remains in
  the audit surface.
- 2026-08-13 (FE2 LANE GATE-COMPLETE — 128 web tests, prefs
  consumed): localStorage DELETED not cached ("a device copy
  beside a server copy is two sources for one fact — the thing we
  removed at the column, reintroduced at the client");
  save-then-adopt, never optimistic (refusal leaves the projection
  unchanged WITH a visible not-saved line; success adopts the
  server's RETURNED value — if core normalised it, that is the
  value); wire-not-trusted (unknown calendar → auto, never a
  formatter nobody can render). MINTED: **"a green suite with an
  unhandled-rejection warning is not a green suite"** (null
  identity threw inside a promise while 128/128 passed — the
  failure would have surfaced as someone else's flake) and
  **"'no identity' is a real state, not the same as 'their
  preferences are the defaults'"**. INTERIM ledger empty except
  the two by-design merged-surface stand-ins. Remaining build:
  FE1 (sessions/thread BFF routes + merged surface), FE3 (org
  fields). Then: gate → user's line in B1 → re-shoot → push #4 →
  sweep.
- 2026-08-13 (the weeks-old org misdiagnosis — the day's opening
  ruling closes its own loop): the amber "not wired" org panel
  stood on a BFF asking **GET /v1/admin/org — the exact path M25
  deliberately never registered** ("two reads of one row can
  disagree"); the truthful 404 read as "feature not built". Plus
  two more in the same handler: /v1/admin/models/{id} never
  existed (the org's COST LEVER unreachable behind a 404 nobody
  could act on — curation is the allowed_models field), and
  default_call_scope INVENTED (on no core wire; rendered
  confidently). MINTED: **"'no such route' and 'no such feature'
  are different nothings — a 404 from our own BFF looks identical
  whichever it is"**; **"a local type is a claim about someone
  else's data, and nothing checks it until someone reads the
  producer"**; steward addendum: **"a deliberate absence recorded
  only at the site of the absence is invisible to the person about
  to ask for it"** (B1's comment correct and unread — KNOWN_ABSENT
  lived in the producer's source; its audience was the consumer).
  Structural fix in flight: web types → core's wire package (FE3
  via FE1's types.ts — boundary correctly routed), after which an
  invented field cannot typecheck and a deliberate absence is a
  missing method, not a runtime 404. FE2 fixed their panel
  immediately + replaced the false header with the correction.
- 2026-08-13 (FE1 LANE CLOSED — MERGED SURFACE LIVE at /echo, 134
  web tests): sessions/thread BFF routes (?archived FORWARDED not
  filtered — "an authorization call made by the layer holding no
  authority"; 401-not-404 as the probe target — an unwired route's
  404 is indistinguishable from working-while-fixtures-answer);
  prefs plumbing with **Me extends User** ("`??` cannot tell 'they
  chose auto' from 'the payload never carried it' — a preference
  that failed to load would render as a choice the person made");
  merged Record+Calls replaces its own promising redirect IN
  PLACE; /calls + /capture redirect; /calls/[id] untouched
  ("breakage a redirect makes look intentional"). Upload repair
  rather than re-homing a false claim (tooLong translated and
  UNREACHABLE — a 4-hour file accepted under a message promising
  examination; duration check now real; unknown duration ACCEPTS —
  "'we could not decode it' must not be reported as 'we looked and
  it was too long'"). MINTED: **"a test that is hard to write
  correctly against the DOM is an argument for extracting the
  decision, not for trusting it — I nearly filed a bug against
  working code on the strength of my own bad instrument"** (two
  false negatives before the code was wrong once). .next
  accounting closed straight by both sessions. Remaining build:
  FE3 org fields + FE2's one /echo recount pass. Then THE GATE.
  tests, BUILD GATE PASSED): Suspense fix with fallback={null} (a
  skeleton "would flash a second, wrong version of the screen the
  user signed off"); gate = web/scripts/build-gate.mjs in pnpm
  test, builds into .next-gate NOT .next (the earlier dev 500s
  were PARTLY FE2's OWN gate-build colliding with the shared dir —
  owned; stale-.next right about mechanism, sibling process the
  trigger); tsconfig include committed for idempotency (a gate
  that diffs a shared file every run gets stopped being run).
  Minted: **"a red that names a different defect is not a
  verify-red"** (first attempt tripped typecheck on an unused
  import before the prerender ran — symmetric duty applied to
  one's own verification). Gate caught FE3's deliberate
  mid-verify-red state within MINUTES of existing (noted in the
  script header). Category 3: **"NO BFF ROUTE" is the precise
  claim** — conversations server-live×4, BFF×2
  (ask/proposals), client×0; sessions-list + thread-read route
  files assigned to FE1 (the last plumbing between category 2 and
  1 for conversations). §3b live-corrected mid-write
  (/management/server went live under their pen — recorded, not
  silently wrong). B1 prefs decisions ratified: NOT NULL default
  'auto' REJECTING null (never two spellings); Intl-runtime
  timezone validation (never two lists). FE2's last item likely
  unblocked (0054 landed per B1 — told to confirm and consume).
  — and its headline is the gate's most important fact): **exactly
  TWO client methods reach a server** (audit, updateProfile);
  everything else renders fixtures EVEN WHERE core/ has a proven
  endpoint. Three-way split ratified as THE web gate format:
  live-e2e / server-proven-client-not-swapped / no-server-yet.
  Category 2 is the claim reviewers get wrong "in whichever
  direction flatters us" — proven as screens, unproven as
  integrations; FE1's swap-after-auth sequencing RATIFIED (swapping
  first = uniformly broken app whose "mocks gone" metric reads as
  success). Method note logged: the LIVE comments describe the
  SERVER, the client body is still a fixture — "same words, two
  different subjects." Cross-check ordered: category 3 lists
  "assistant stream, sessions" as no-server-yet while B1's close
  declaration lists conversations LIVE-PROVEN — the two close docs
  must not disagree about the same endpoint at the gate. Also:
  email header consumed (item 3 ✓); prefs half-closed (B1
  published CALENDAR_PREFERENCES adopting auto-is-not-a-null into
  the column shape; FE2 re-exports core's type, validates against
  the published set); coverage instrument: CALENDAR_PREFERENCES
  recorded as EXCLUSION-with-reason (an Exact line comparing a
  type with itself could never fail — worse than none). Dev server
  stale-chunk 500s → FE1 restart with drain warning ("tested, not
  eyeballed" stands until then). Loud-guard cost logged: a guard
  firing against a half-loaded bundle accuses the most recent
  author — worth knowing, not a reason to quiet it.
- 2026-08-13 (FE2 reopened their own close — the reload gap):
  preferences WRITE live, READ still fixture (api.me() mock) — "a
  saved preference appears to reset" on reload; recorded as §1a
  half-connected-until-swap, not a footnote. MINTED: **"'the write
  is live' and 'the feature works' are different claims — a write
  path can be verified end to end while the round trip is still
  broken"** (every test exercised the write and the projection,
  never the RELOAD — the temporal vacuum's bigger sibling). Method
  failures logged: **a grep for the helper cannot see one function
  calling another** (delegation understated the live count — FIVE
  methods not two: audit, serverHealth, updateProfile,
  updatePreferences, setLocale); "exactly two" rotted within TWO
  HOURS of the document's own paragraph about prose numbers
  rotting — irony on the record in the document. Re-run
  instructions now name the bare-next-build hazard. Lane still
  gate-complete: everything closeable closed, remainder named
  with its dependency.
- 2026-08-13 (/echo RECOUNT DONE — measurement ledger CLOSED, 134
  web tests): both locales at 375 clean (table scrolls in its own
  box; no fixed layer — checked EXPLICITLY on exactly the surface
  where a docked pane would return; eight "overflowing" elements
  correctly declined as inside-the-scroller design). THE FINDING:
  the trail still routed through the /calls redirect — a crumb
  naming a place that no longer exists, label disagreeing with
  destination. MINTED: **"a redirect is a change to the
  information architecture, not just to a URL — the routes still
  resolve, so every reachability check stays green while the trail
  quietly lies."** Not-the-author rule earned its keep: "they
  owned the change, I owned the claim it invalidated — neither
  could have caught it alone." Fixed (parent → /echo; redirect
  routes → NO_TRAIL with reasons); asserted as an ABSENCE (the
  wrong version renders perfectly). Board: FE3 org fields + their
  types.ts swap (FE1's ack) = the LAST build items. Gate sequence
  staged: close-doc final read → user's line in B1 → re-shoot →
  push #4 → sweep.
- 2026-08-13 (ORG FORM COMPOSED — the last "not wired" notice in
  the product is GONE; 146 web tests): three keepers, none FE2's
  own: (1) **"a caveat nobody deletes is how a fixed thing keeps
  apologising for itself"** — dead copy (orgNotWired*) invisible
  to keys.test BY DESIGN (referenced-must-exist is one-directional;
  dead copy needs a person). (2) FE1's null-rule inversion:
  **"same-shaped API, opposite answer, neither inferable from the
  other"** — org columns NOT NULL + coalesce → null already means
  leave-alone (a nullable param = a second spelling of omission);
  profile null genuinely clears ("no Latin name" is a real state);
  READ THE PRODUCER'S SQL; diff-based send ratified (type-and-
  revert sends nothing, no no-op audit writes, stale page can't
  clobber). (3) allowed_models LOST-UPDATE hazard recorded as a
  NAMED OPEN DECISION in the Models page itself ("the symptom
  arrives as 'this toggle doesn't stick'"; whole-array write =
  last-admin-wins; re-read/token/stated-risk — decision belongs to
  whoever wires Models, post-m4). GeneralSettings' own org fetch
  removed (two reads of one row on one screen). Awaiting FE3's
  composed-screen pass → GATE.
- 2026-08-13 (BUILD PHASE COMPLETE — THE GATE RUNS): FE3's composed
  pass in; FE2's correction recorded as 3d (org form = client to
  FIXTURE — the BFF route right, nothing through it yet; "averaging
  the four is how a reviewer concludes the org name reaches the
  database"). MINTED, FE3's three-level ladder as 5a of the
  declaration: fixture-proven / screen-verified / live-token-
  verified — NOTHING in web/ is level 3 ("the honest ceiling of a
  front-end close taken before auth, and the single distinction
  most likely to be flattened by a summary"). Save-button
  transition (revert makes it disable again) = diff-not-touched
  proven in the rendered artifact ("unit tests assert the patch
  shape; only the screen shows the button changing its mind").
  Trap minted: "a hit-test on a disabled control measures the
  DISABLING, not the reachability" (pointer-events:none answers a
  different question than the one asked). GATE SEQUENCE INITIATED:
  publisher pinged (re-shoot + push 4), user asked for the sweep
  line in B1's session + the signup, B1 holding for the line.
- 2026-08-13 (FE1 LANE CLOSED, gate green — and a direct rules
  edit accepted): FE1 completed the encoding rule in place (their
  edit, steward-reviewed-and-kept): cp1252 nbsp added to the
  signature list (RENDERS AS A SPACE — survives the careful check,
  symptomless until a downstream trim); sweep-every-script ("a
  Persian-shaped pattern cannot return a mangled em-dash — not a
  check that passed wrongly, A QUESTION THAT COULD ONLY EVER HAVE
  PASSED"); restrict-to-text with the expected self-hit named and
  the 27-binaries death mode ("a check that reports 27 false
  positives is one nobody runs twice, which is how a rule dies
  without being repealed"). Their closing ratio kept as the
  carry-forward: "two false negatives from my own instruments
  before the code was wrong even once." All lanes now CLOSED or
  gate-staged; the milestone waits on: publisher's re-shoot +
  push 4 (in flight), the user's sweep line in B1, and the
  signup.
- 2026-08-13 (FE3's disclosed post-stand-down fix — accepted, and
  the standard set): closing a confirmed defect in delivered scope
  is not new scope; unprompted disclosure is what makes the line
  hold. The defect: a select whose value matches no option renders
  a DIFFERENT one — an org legally stored as fa-IR (PATCH validates
  by SHAPE; B1 rightly declined to narrow a file with no opinion
  about languages) displayed as Persian. MINTED: "a silent
  substitution on screen is a lie about the record even when the
  record survives it." The other half of FE3's report was their
  own predicted data-loss defect DISPROVED by writing B1's
  proposed test first (expected red, got green — the diff-based
  patch already protected the data): "a hazard I reason my way to
  is a hypothesis, and relaying it as a finding is the
  red-lies-too failure pointed at my own analysis." B1's keeper:
  "the capture that agrees with your assumption is not a wasted
  capture." 149 web tests. ALL lanes now truly closed; gate
  outputs pending: publisher push 4 + the user's sweep line + the
  signup.
- 2026-08-13 (.GITIGNORE CORRUPTED — the secrets guard, caught
  BEFORE the push): BOM + double-encoded em-dashes baked into the
  bytes (the Set-Content -Encoding utf8 signature), found by FE2
  during the push window, repaired via the sanctioned
  ReadAllText/WriteAllText hatch, verified FUNCTIONALLY
  (check-ignore on every critical pattern + the .env.example
  NEGATED control — "a negation is the thing that silently stops
  negating"). Honest risk statement: BOM sat on a comment line,
  no leak evidence, but "the wrong file to reason about
  probabilistically" — publisher re-check made a GATE CONDITION.
  The instrument confession: FE2's whole-repo clean sweep NEVER
  LOOKED at .gitignore (ripgrep skips dotfiles by default) — the
  same could-only-ever-have-passed class FE1 confessed an hour
  earlier, committed within the hour of minting it (wrong script
  vs wrong files). Clause (d) added and RUN: byte-level over git
  ls-files, 316 tracked files, no BOM anywhere, no mojibake in any
  text file. Attribution: one question to Documentation (the only
  known .gitignore editor today); no guessing.
- 2026-08-13 (PUSH #4 LIVE — MILESTONE 4 CLOSED modulo the sweep):
  six commits, 192 files, private re-verified, exclusions
  individually verified AGAINST THE REPAIRED GUARD. Publisher's
  two findings ruled: (1) nested-anchor trap — supabase/.temp/
  anchored to root, never matched core/supabase/.temp/, the file
  TRACKED since c791b3e (dev ref + org identifiers); widen +
  untrack + NO history rewrite RATIFIED (private; a ref is an
  identifier, deliberately documented in three places);
  **go-public = a decision point, not an oversight — flagged to
  the user**; casebook: "a gitignore pattern containing a slash
  anchors to the ROOT — a guard that works by luck at one depth";
  publisher auditing remaining slash patterns. (2) Audit Logs +
  Server NOT photographed — 401 without a session; CORRECT refusal
  (photographing the error state would libel live surfaces; the
  README says why they're absent); the re-shoot list's
  signed-in-browser assumption was the STEWARD'S error, owned.
  Ten shots shipped, three-level ladder un-flattened in the
  README. Remaining: the user's sweep line in B1 + the signup
  (swap phase + final two shots). Task #25 CLOSED, #28 = epilogue.
- 2026-08-13 (the day's closing pair): Documentation cleared with
  BYTES (their line has no em-dash to double-encode; casualties
  pre-existing; no BOM tool in their path) — writer UNATTRIBUTED,
  closed, with the keeper: "any writer touching a file after a
  corrupting write carries the damage forward invisibly while
  looking like the last toucher" — which is why the question moved
  from who-edited-last to what-RUNS. FE2's answer:
  **web/scripts/encoding-sweep.mjs in npm test** — byte-level over
  git ls-files (415 text files, nothing skipped for being hidden),
  two signatures deliberately narrow ("trusted and narrow rather
  than broad and muted"), verified red on the REAL mangled bytes
  (probe removed, checked not assumed), ONE named exclusion with
  its reason (the answer to a false positive is a named entry,
  never a loosened pattern), BOM unforgivable even there. Third
  instrument in one day for a structurally-invisible class
  (boot → build gate → encoding): "what the rule could not do is
  RUN." MILESTONE 4 fully quiet; epilogue = the user's sweep line
  + the signup.
- 2026-08-13 (THE WRITER CONFESSED — gate satisfied, milestone
  closed on the publishing side): the corruption was the
  PUBLISHER's own anchor-fix commit — Get-Content (ANSI misread) +
  Set-Content -Encoding utf8 (BOM) inside the very commit
  hardening the guard; owned unprompted with both aggravating
  details: their own memory RECORDS this exact pitfall from Echo,
  and **git check-ignore passes happily on a corrupted file — the
  verification could not catch what it had just done** (functional
  checks prove the PATTERNS; only the byte sweep proves the FILE;
  the pair is now the guard-file standard). "A commit whose stated
  purpose was hardening the secrets guard is the commit that
  corrupted it" — the day's oldest theorem proven terminally:
  remembered prose protects nobody; the sweep in npm test does.
  Publisher checklist gains the encoding sweep at the push seam.
  Independent re-verification vs the REPAIRED file: 21/21 ignored,
  10/10 negation controls, pushed blob byte-identical, no leak by
  path. Push #4 final at 8d2a92d. Documentation's byte-evidence
  self-clearing stands vindicated. EPILOGUE ONLY: the user's sweep
  line in B1 + the signup.
- 2026-08-13 (VERCEL PRODUCTION LIVE — Option C's cloud half done):
  production at **mvp-web-beta.vercel.app** (project mvp-web,
  personal Hobby scope "neurai"; slug is neurai2), built from main
  at 829f509 = the React2Shell/RSC CVE patch PR (#1) MERGED — Next
  bumped to the advisory's fixed version. Publicly verified from
  outside: fa=«اکو» / en="Echo", sign-up/echo/management/settings/
  sign-in all 200. Deployment protection DISABLED (shareable).
  Road here recorded: team-scope Pro paywall (env vars are FREE —
  the TEAM was the paywall; personal Hobby scope is the home);
  stale pnpm-lock (ml gained sherpa-onnx-node without regen —
  frozen-lockfile refused; fixed via --lockfile-only + push
  302cf92); "Redeploy" REBUILDS THE SAME COMMIT (a new deployment
  is needed for a new commit); mvp-web.vercel.app is a STRANGER'S
  app ("Pollpick") — verify content, never status codes; the
  stray mvp-ml Vercel project deleted (serverless can't run the
  speech service). REMAINING for full Option C: CORE_API_URL env +
  Cloudflare Tunnel when the user is ready — until then Vercel
  screens show unreachable-api states honestly; the PC stack via
  scripts/start-platform.cmd is the working copy.
- 2026-08-14 (THE FIRST REAL MEMBER — the epilogue's summit): after
  the full gauntlet (mock forms exposed and rewired; ES256/JWKS
  verifier built and live-proven by the user's own token; email
  rate limit dodged via dashboard Add-user; the FK protecting a
  registration from deletion; the unwind executing on "reset me"
  before the steward's late hold — B1 corrected the premise), the
  user signed in: auth 14:17:48 → app_user 23s later →
  vendor_accept_org → **status active, role owner, org "neurai",
  accepted_by NULL, history recorded.** B1: "your account is now
  the only thing on that database that isn't test residue."
  Unwind order cancelled permanently. ROUND 3 DIRECTIVES dispatched:
  password self-service (change + recovery page — FE1, building) +
  the vendor approvals console (B1 owes the vendor-identity
  proposal; UI follows). Remaining epilogue: swaps 3-5 + shell
  guard, final 2 README screenshots (now possible via a
  dashboard-created test account), tunnel on user's word.

- 2026-08-27 (M42 + the workflow that never ran + two filters that
  read as satisfied): **the table rule** — ten rows then numbered
  pages, one pager in the theme (web/src/components/Pagination.tsx),
  built into DataTable so a table inherits it by BEING a table; the
  clamp is the load-bearing part (page 4 of a filtered list would
  otherwise render an empty table under a page number, which on
  screen is indistinguishable from "no results"). Two silent
  truncations died with it (.slice(0,10) drains, .slice(0,12) runs).
  Audit Logs keeps its cursor button BESIDE the pager, reasoned:
  a fetch triggered by navigation moves the last page under the
  person standing on it, and a server page shorter than ten leaves
  the rest with no door. **The workflow's "nothing happens"** was
  rule 13½ again, found by reproducing in the user's own browser:
  the launcher pushed at `/`, and `/` stopped being the hub when the
  dashboard took the landing page — the route still RESOLVED, so
  every reachability check stayed green while the click landed on a
  briefing screen that reads none of its params. The pipeline was
  never broken: driven at the right address it read the real email
  and drafted the reply. Second half ruled per Sana's model
  (fill inputs -> Run -> output in the chat): choosing the source IS
  the instruction, so the hub runs it unprompted with the SERVER's
  name for the workflow as the opening line, once per pick, never on
  a resumed thread, and `run` is spent on start so a reload is not a
  second run. Hub's own router.replace("/") had the same stale
  address. **NO-CLAUDE FAILED A SECOND TIME**: production served
  `~anthropic/claude-opus-latest` — `startsWith("anthropic/")`
  defeated by ONE character; the rule names a model FAMILY, not a
  routing prefix, and every fixture in the covering test was spelled
  the way the code believed (rule 9, exactly). Minted, from my own
  hands: **the first verify-red PASSED against the shipped bug
  because I had put the real id in the capability list instead of
  the catalogue mock — the fixture was in the wrong place, so the
  instrument had nothing to check; a verify-red that goes green is
  itself the finding.** Its regression, caught by the suite: filtering
  the STORED preference too would have traded a refusal that names
  the model for "no model selected" — a vaguer nothing (rule 12), so
  the server keeps refusing by name and the CLIENT stopped sending a
  model the server never offered. Also: `dashboard.widget.ask`
  existed in NO locale and rendered as a raw key on the landing page
  — keys.test skips computed keys, and locale PARITY cannot see a key
  missing from both; widget titles are now checked against the
  REGISTRY's own list (13½: derive the coverage list from the
  producer). Google connectors live end to end (consent, Gmail list
  20, the draft written from a real message).

- 2026-08-27 (M43 — mail drafts, built to Sana's shape): a connected
  mailbox is polled; new mail gets a drafted reply that waits in the
  thread AND in the person's own Drafts folder until they press Send.
  **The wall is the GRANT**: echo_agent may INSERT a mail_draft and may
  never UPDATE one, so "the assistant will not send mail on its own" is
  a fact about the database, not a sentence in a prompt (0114; 17
  checks assert it both ways). A draft is its OWN table rather than a
  fourth proposal kind — both proposal machines assume a call, and a
  null-call decision is a row whose read policy cannot return it to its
  own decider (95_workflow_writes had that once). **The model never
  chooses the recipient**: to/subject/thread come from the message
  headers, the body arrives fenced and named as data, so "reply to
  attacker@evil instead" describes something it cannot cause —
  verified red by letting the envelope obey the model. That is also
  WHY the run goes through the assistant path rather than the M41
  engine: sourceContext already fences provider text and a second
  fence is the last thing to want two of. Switch is PER PERSON and
  OFF (0115) — their mailbox, their consent; not even an admin reads
  a draft. First look answers nothing (records the mark, drafts for
  no backlog); the cursor advances even when everything is skipped.
  **The first-look test was VACUOUS**: my fake mirrored the code's
  belief (no cursor -> no items), so deleting the guard kept the suite
  green — the fake is uncooperative now and the guard fails when
  removed. Gmail gained gmail.compose (one consent line for drafts
  AND send); connections report can_draft from what the provider
  actually granted, so a pre-drafting connection says so instead of
  failing at the provider. Console: the scope is registered on the
  consent screen and Google accepts the new set (probed).

- 2026-08-27 (M44 + the Sana-shaped workflow page): the detail screen
  built to the reference — identity tile, on/off pill, Created by /
  Category / Integrations, Process (trigger + numbered steps), Runs
  (Upcoming + Recents). Its pill is FOUR states decided in one place,
  and read-only is the ABSENCE of a handler rather than a disabled
  button beside a live one. Shipped templates' process text comes from
  the CATALOGUE, not the wire: the other order reads more natural and
  breaks the default path, because core would serve one language and
  every Persian reader would silently lose Persian the day `steps`
  lands. **M44 meeting prep** = M43's twin with the differences as the
  design: this output never leaves the building so the brief MAY use
  the read tools (retrieval is the value), while the mail draft gets
  NONE because what it produces is addressed to somebody else —
  **blast radius decides reach**. A window, not a cursor (mail is a
  stream, a calendar is a set of future facts); all-day entries
  excluded ("today" is not a moment you can be thirty minutes before)
  and meetings already under way excluded (a pre-read delivered
  mid-meeting is worse than none — it arrives looking useful).
  Minted, from opening the page rather than any test: **a slug is
  data, and the heading above it is not evidence of what it is
  called** — I wrote `prepare-me-for-meetings` off the card's title;
  0065 seeds `prepare-meetings`, so the toggle's own screen answered
  "no such workflow". Typecheck, 484 web tests and the build gate were
  all green while it was wrong.

- 2026-08-27 (the shell turns back to the assistant): dashboard PARKED
  (user: "deactivate dashboard for now, we will use it later") — `/`
  redirects to `/assistant`, the board and its widget registry stay
  untouched, so bringing it back is one nav entry and one route file.
  **The orb stands down on the assistant's own surfaces** (assistant,
  conversations, workflows, integrations, agents): an orb there is a
  second door to the room you are standing in, and its panel covers
  the thing it duplicates. Extracted as ONE predicate
  (`orbIsSilentOn`) rather than a third early return nobody could see
  from outside; its test's load-bearing case is the CONTROL — a
  predicate that answers "silent" unconditionally satisfies every
  positive assertion and is completely wrong (verified red exactly
  there). The half that had to move with it, and would have been a
  silent regression: History rows and the sub-menu's recent
  conversations used `openAssistant()`, which now reaches nothing on
  those pages — they NAVIGATE to `/assistant?c=` instead. Also:
  answers lost their box ("just the text" — a border around every
  reply is a rectangle the eye crosses to reach the words), messages
  arrive with a 6px rise, an empty streaming answer shows a SPINNER
  rather than a caret (a blinking cursor claims words are arriving
  when none have), the composer's menus open UPWARD (a panel dropped
  below a page-foot composer opens into the viewport edge), and the
  hub took the table width — where the fix was the OUTER container:
  widening the composer alone changed nothing, because a child cannot
  exceed its parent. Minted from the thread test: **counting a style
  class is counting the wrong thing** — `div.rounded-2xl` meant "how
  many messages" until answers stopped being boxed; it counts
  `.message-arrives` now, one element per message.

- 2026-08-27 (M45 — the page rhythm, and the copy nobody could see):
  the user's "the margins and spaces everywhere is unset" had a
  precise cause. M26 derived radii, type and widths from
  scaffold/constants.ts but left SPACING as a COMMENT ("page top
  padding 48 = pt-12 · content inline padding 40 = px-10") — prose
  that was already two revisions stale — so the page column got
  COPIED into five surfaces, the copies froze at the value the
  original held before a one-line bump, and five screens sat 12px
  higher than the rest of the platform. **Nothing went red because
  nothing had ever asserted PageContainer's classes**: the divergence
  was true and invisible at the same time, which is the whole shape of
  it. Fixed by making the rhythm CONFIG (SCAFFOLD.page → named
  Tailwind steps → `pt-page`, not a number a screen picked), and the
  menu heading moves WITH the page title because **that pair is a
  relationship, not two numbers** — the test asserts the 12px a 17px
  pane title needs to share a 24px page title's line, so "just add
  some space" cannot leave one behind. Also collapsed the SECOND
  PageHeader (no hairline, one consumer — one screen's title block a
  different shape from every other), and brought the hub, the record
  document and the operations console onto the gutters; `max-w-6xl`,
  the one page width outside the two themed columns, is gone. The
  guard (`rhythm.guard.test.ts`) is the lasting part: named steps only
  inside the scaffold, the copied literals may never return, nobody
  re-implements the column, exceptions are entries WITH REASONS, and
  one assertion checks the exceptions still name real files — **an
  allow-list entry for a deleted file reads as coverage and is a
  hole**. Its FIRST FIRE caught a sixth copy written minutes earlier
  by its own author, which is the best evidence a guard can offer.

- 2026-08-27 (the no-Claude rule's THIRD failure, and the biggest):
  a user screenshot showed a workflow run ending on "model is not
  available on this product: ~anthropic/claude-opus-latest". Two
  causes. (1) The auto-run RACED the model catalogue — whichever
  answered first won; when models lost, the ask carried none, the
  server fell back to the stored preference and the run died on a
  refusal about a model nobody chose. **A run that starts itself must
  be at least as complete as one a person starts.** (2) Found while
  chasing it: **the M5 ladder was written out FOUR times in the worker
  — summarizer, workflow executor, mail poller, meeting prep — and not
  one copy applied the exclusion.** assertAskable guards the API path
  only, so the rule was never true for anything that ran unwatched;
  production had been routing background runs to Claude on a stale
  row. One `firstServable` now applies it at every rung INCLUDING the
  env fallback ("a misconfigured WORKER_SUMMARY_MODEL is exactly what
  serves one silently forever, because nobody reads it after the day
  it is set"). Minted: **a rule enforced on the path a person watches
  is not enforced** — count the copies of a ladder before believing
  any of them. And a RULING REVERSED BY PRODUCTION: a barred model in
  a stored preference is no longer refused by name (that rule is right
  about a caller NAMING a model, wrong about a stale row — nobody
  typed it, and the cost was every run in the thread ending with no
  answer); the by-name refusal is kept for the typed case and both now
  have their own test. Then, reading production after the fix: `list`
  still reported the barred preference while the ask ignored it —
  **two separate queries, one fact, and fixing one is how they come to
  disagree**; the picker would have shown a choice silently not in
  force. Live state after: preferred=null, four drafts pending, three
  of them written into the real Gmail Drafts folder now that the
  compose scope is granted.

- 2026-08-29 (THE REMOVAL: webhooks, and the others nothing was using):
  user directive — "i dont need the webhook, and the others that are
  not already being used as well". The webhook feature is GONE (M17
  amended, db/0132): both tables, six policies, the created_by
  trigger, `subscribed_webhooks` (D19), the pgmq queue, api/webhooks
  .ts, four worker modules, four routes, `net/address-guard.ts`,
  `WEBHOOK_EVENTS`, the drains surface, three BFF routes, four client
  methods, three wire types and 59 orphaned locale keys. **It was
  never reachable end to end and the catalogue said so**: 0 rows, 0
  rows, and `total_messages = 0` on the queue over its ENTIRE LIFE —
  the dispatcher was written, tested, line-reviewed, given an SSRF
  connect-time guard and a replay-protected signing scheme, and
  **never registered as a handler in runner.ts**. Rule 13½ at feature
  scale, and the three existing 13½ instruments each watch ONE seam;
  none asks whether a queue has a consumer. **That gap is the finding
  and it outlives the feature** → core/test/queue-handlers.test.ts
  (fourth instrument; ALL_QUEUES from the producer, handlers parsed
  from main.ts's createRunner argument because an import scan would
  call an imported-but-unregistered factory covered; verified red by
  unregistering createSignalStep — it named echo_agent_rules).
  `createRunner` already refused TWO handlers for one queue; **nobody
  had written the symmetric half, and the symmetric half is the one
  that ships silently**. The drains component turned out to have no
  consumer EITHER (audit-log-drains had already left
  SETTINGS_SECTIONS) — a producer with no consumer inside a feature
  that was one. 0132 recreates `platform_purge_org` minus its two
  webhook deletes in the same transaction as the drop ("a purge that
  raises is a purge that does not run, on the one path where failing
  to delete is the worst outcome") — **generated from
  pg_get_functiondef, not retyped**: the first hand-written attempt
  had a one-argument signature, the wrong guard and half the delete
  list missing, which `create or replace` installs as a SECOND
  OVERLOAD beside the real one rather than rejecting. Hence the
  self-checks at its foot, which fired twice on their own defects
  before passing and were then verified against a staged truncation
  and a staged overload — **a check whose only reds were its own has
  never failed for its reason**. Also removed: mock-data.ts (993
  lines, 0 importers — it surfaced by failing to typecheck),
  AssistantPane (558), NavGroup, ScopeChip, Progress, toJalali, and
  `recentSpokenText` — whose backing `spokenHistory` was still being
  WRITTEN on every utterance, **a write with no reader, the same
  defect one layer down**.
- 2026-08-29 (two instruments, two false-positive lessons, one
  deleted): **the encoding sweep had a hole a single byte could open**
  — `if (bytes.includes(0)) continue` meant a bare 0x08 was caught and
  the SAME 0x08 behind a NUL passed, with the tracked-file count
  silently dropping by one. Found by a lane writing a NUL into
  format.ts by accident, proven with a three-case control, closed (the
  heuristic now applies only where the extension does not say "text").
  The sweep also gained a **third signature: a C0 control byte**,
  which cost two migration runs and a wrong diagnosis — a non-raw
  Python string turned a backslash-b into BACKSPACE inside a SQL regex, so it
  matched nothing and 0132's self-check called an intact body broken.
  **Invisible to grep, to a diff and to the eye.** The first draft of
  that check wrote the class literally, putting a NUL into the checker
  — which would have made the sweep skip its own source as binary
  forever. And `core/scripts/unused-exports.mjs`, which needed two
  corrections and carries its own false-positive rate in its header:
  177 findings of which 165 were types that are not dead at all, then
  1 real out of 21 "dead values" (the other twenty used inside their
  own file). **A rate is what tells you how much to trust a line of
  output**, and a muted check still reads as coverage.
- 2026-08-29 (the model wall's fifth and sixth doors — and a checker
  thrown away): `/v1/calls/:id/translate` took `body.model` as free
  text with no assertAskable (five routes called it; this was not one)
  AND read `preferred_model` raw where list/preferred both read it
  through the ladder. Sixth door: **a skill PINS a model and that
  column was free text on create and patch** — a path no assertAskable
  can ever cover, because nobody types a model at run time. Fixed with
  the ruling that governs the whole class: **a model a caller NAMED is
  refused by name; a model nobody typed is not a rung**. And the shape
  underneath — `modelForRun` was `skill?.model ?? callerModel`, asking
  neither rung anything; it runs `firstServable` now, so it is a
  FUNNEL and a route that forgets the wall reaches the caller's next
  rung instead of a barred model. **The wrong state made
  unrepresentable rather than watched for.** The thrown-away part is
  the lesson: a source checker demanding a guard inside each route
  handler found four routes and **all four were false positives** —
  two guard in the repo, one validates at write time, and the fourth
  hit those words inside a COMMENT (the name-matching-itself trap, in
  a checker written to catch that trap). Deleted rather than tuned: **a
  guard living one layer down in a repo is correct design, and an
  instrument that calls the right shape wrong pushes code toward the
  wrong shape.**

- 2026-09-01 (the reference adoption ships whole — and the purge had
  never learned nineteen tables): tasks (0144) and meetings (0145) live
  end to end — schema walked through the matrix, core routes 401-wired
  on the server, web behind the auth wall on production; the dashboard
  recomposed to the reference (stat strip / week panel / upcoming /
  latest, layout store v4 so the stored old board yields to the
  arrangement that was asked for); an online meeting starts the
  recorder on the SYSTEM source and the recorder links call_id the
  moment the call exists ("a dying tab still leaves the meeting
  pointing at its partial record"). THE FINDING, rule 13½ at function
  scope: **platform_purge_org enumerates its deletes, and nothing ever
  made a new org-scoped table report for enumeration** — thirteen
  tables (the whole M41 workflow family, mail_draft, meeting_prep,
  role_capability, agent_workflow, and 0144's own six, added the day
  before by the same hands that then found them) carried NO ACTION FKs
  to echo.org, so the purge RAISED for any org that had used those
  features — 0132's exact sentence ("a purge that raises is a purge
  that does not run") proven again one wave later, in the function
  0132 itself regenerated. Fixed in 0145 (children first; the
  workflow↔version cycle broken by nulling the pointer) with the
  instrument that ends the class: coverage DERIVED from the catalogue
  (every org_id table deleted or excepted WITH a reason;
  deletion_record's cascade asserted so the exception cannot silently
  stop being true) as migration self-check + standing db test with a
  negative control. Its true positive was the finding itself — the
  probe that found the gap IS the check, promoted. Also kept: a drop
  on the task board writes {column_id, position} and the test pins the
  EXACT KEY SET (it caught the position stamp riding the drop on first
  run); the meetings grouping clause (a held meeting is past however
  early it was held) verified red by deleting it.

- 2026-09-01 (later — the meeting page, the board resized, and a
  20-agent review that earned its spend): the reference round's second
  half. /meetings/[id] is a PAGE now — stage stepper (پیش از جلسه /
  برگزاری with the recorder embedded / پس از جلسه with the six
  reference tabs), and the processing card is the CALL-STATUS LADDER
  wearing the reference's labels (recording→processing→linking→
  summarizing→ready = upload/transcribe/diarize/extract) — the screen
  cannot disagree with the pipeline because the status IS the steps.
  Tasks took the reference's measurements + a تقویم view; the week
  panel took full day names, nav, and the product's own meetings; the
  loud focus ring left the text boxes (checkbox/radio KEEP theirs —
  the reviewer caught the bare `input:` selector). THE REVIEW: four
  lenses, each finding adversarially verified — 16 raw, 15 confirmed,
  1 refuted (a defect I had already fixed mid-review; the refuter
  read the newer tree — reviewers race the author, cross-check
  timestamps before acting on their reds). The worst confirmed: **the
  meeting-link effect claimed whatever callId the module-level engine
  still held from an UNRELATED take** — the engine survives navigation
  by design, finish() keeps callId, so "there is a callId" was never
  evidence this meeting produced it; fixed with a baseline-at-adoption
  guard EXTRACTED to meetingLink.ts and pinned by its matrix (the
  hard-to-test-against-the-DOM rule applied at write time, not after a
  false red). Sibling: the meetingDetail catch fell back to
  adopt(prop) with no call_id — a failed READ disarmed the
  never-re-link guard; a failed read now prefills and links nothing.
  And the fix pass itself minted one: `t("recordGone")` in the WRONG
  NAMESPACE renders the raw key — a key that exists elsewhere in the
  catalogue satisfies every existence-grep; only same-namespace
  existence counts. Kept small: digits with the language at every
  count (five raw .length renders), Persian keyboard digits NORMALIZED
  not stripped, drafts survive refused writes, hover:bg-surface-3 was
  five inert hover states on an unregistered token.

- 2026-09-01 (THE BIG MILESTONE — the meeting flow goes native, Echo
  becomes the invisible engine): user consented to the length and got
  the whole reference, page by page. 0146 gives the MINUTES a
  lifecycle (approve→sign→close as EVENT patches; closed = the record
  of record, refused server-side); the meeting page runs the
  RECORDING ENGINE directly (no recorder screen — timer, whiteboard,
  quick actions; پایان و پردازش), the post tabs sit on real artifacts
  (transcript with seek-on-click, extraction sliced from the
  summary's OWN headings with the team template now shaping them,
  the minutes document with Word/PDF), and the dashboard is theirs
  exactly (greeting + click-moment quick start, four stat cards, the
  week as an HOUR GRID, board store v5, record/integrations/records
  off the default board). THE REVIEW EARNED ITS SPEND AGAIN: 22
  agents, 18 confirmed, 0 refuted — headline class: **"resolution is
  not success" at the engine seam** — startRecording/finish RESOLVE
  on refusal (denied mic, cancelled share, dirty settle) with the
  verdict in the snapshot, and a page that treats the resolved
  promise as success toasts «ضبط آغاز شد ✓» over a recording that
  never began; read the STATE after the call, not the promise. Its
  sibling: the one-take guard resolves too, so starting over an
  unrelated live take HIJACKED it (shown as this meeting's timer,
  finished by its end button, LINKED as its record) — busy-guard
  before, baseline-comparison after, the meetingLink lesson now
  enforced at both ends. Plus: raw-HTML document.write in the minutes
  export was stored XSS (esc() everything — model text included);
  signatures dedupe by USER ID because a display name changes with
  the locale; the upload-mode button was a mic recording wearing an
  upload label (now a real file picker through uploadAudioFile); the
  week chip's hour now uses the RESOLVED zone (browser-zone hours
  disagree with dayKeyOf's bucketing and formatTime's label — one
  fact, three clocks); signed audio URLs re-sign once on media error;
  same-value seeks need an object per click (Object.is bailout); and
  the hour rail shares the columns' exact geometry (one denominator,
  three renderings). Deployed whole: 0146 on prod, core on Hetzner,
  web on Vercel — 767 web + 1188 core green, the wall holds.

- 2026-09-01 (WALKED THEIR PRODUCT — the round that ends the guessing):
  user: "still you can not do it ... use the site that i gave you in
  browser, go create a new meeting and observe everything it has how
  many steps how many pop up windows, where is what". So I opened
  panel.arameet.ir in their Chrome, walked every screen, opened every
  popover and menu, created a meeting, walked its three stages, and
  deleted the test row. **The lesson is the method: a screenshot shows
  a state; the product shows the STATES** — the assignee popover's
  member search, the deadline picker's presets + Jalali grid, the
  column header's rename-in-place/tone/delete affordances, the ⋮ menus,
  the «تاریخچه ۲» tab, and the empty state that reads «صوت جلسه ضبط
  شد، ولی گفتاری تشخیص داده نشد» — none of which any screenshot
  carried. What that walk changed: 0147 (labels as ORG ENTITIES with a
  closed tone set — a text[] cannot express a rename that reaches every
  card, and two rows would disagree about a colour; an append-only
  task_event log, because "who moved this and when" is exactly what the
  current row has forgotten; eight column tones), the new-task dialog
  field for field, the detail modal with its live meta rail, the
  calendar with ماه/هفته/روز + امروز + range + «بدون مهلت» drawer, the
  list grouped by deadline bucket, the meetings list with its two
  filter axes, the live stage's layout (mine was MIRRORED), and the
  meeting-scoped assistant chat (our own assistant with the record
  attached — not a link out). Two honest declines recorded rather than
  faked: their video room and presentation modes (we run no
  conferencing, and the recorder stops the shared surface's video track
  the moment it has the audio — a chip for either could only ever show
  an absence), and their per-row DELETE (0145 keeps a meeting
  undeletable by every app role, so ours archives). Attachments remain
  the one observed feature not built — it needs its own storage
  vertical, and a dropzone that does nothing is the thing this repo
  refuses to ship. The confirm guard earned its keep again: retiring a
  label strips it from every card, so it asks first.

- 2026-09-02 (THE FRONT END STOPS BEING HAND-ROLLED — shadcn/ui adopted,
  126 files / 800 web tests green): the answer to "can we install a
  package so we don't do everything from zero". **shadcn/ui, chosen
  because it is NOT a dependency** — the CLI copies source into
  `web/src/components/ui/`, so nothing owns our buttons and a component
  that must behave differently is a file we edit, which matters more here
  than elsewhere in a codebase whose comments explain why each control
  does what it does. Overlay, ConfirmDialog, Select, DateField, TimeField,
  KebabMenu and ContextMenu now sit on Radix; `components/Popover.tsx` —
  the hand-rolled portal each had grown a private copy of — is DELETED.
  ~180 lines vanished from KebabMenu alone that had learned, one user
  report at a time, to portal past a table's overflow, to flip at the
  viewport edge, to step a flyout outward in the reading direction, and to
  close on outside-press/Escape/scroll/resize — every one a Radix default,
  plus the two it never reached (focus trap, arrow-key nav). ContextMenu
  is now the SAME menu anchored to a zero-size element at the pointer, so
  the right-click and the ⋯ cannot drift. Our rules stayed ours and stayed
  asserted: red rows sort to the bottom, the icon gutter is always spent.
  The argument settled itself mid-swap — **Radix marks everything outside
  an open dialog `pointer-events: none`, so the hand-portalled Select
  panel rendered perfectly inside a modal and could not be clicked**, the
  seventh instance of the bug the primitive existed to end.
  Three findings no suite could have raised. (1) **`accent` was registered
  FLAT, so shadcn's `focus:text-accent-foreground` named a colour Tailwind
  had never heard of and emitted NO CSS** — a focused menu row got the
  dark-green ground and kept the page's near-black ink; identical to the
  `text-on-accent` this repo already shipped once, arriving through a
  library instead of by hand. Now `ui/bridge.guard.test.ts`: every
  `*-foreground` class the ui/ components use must resolve in the theme,
  verified red by flattening `primary`. **A component library multiplies
  this class, because its classes were written by someone assuming a
  different config.** (2) **Radix reads direction from a React CONTEXT and
  defaults to LTR — it never looks at `<html dir>`.** Persian-first
  stopped at the component library: submenus flying out of the wrong edge,
  `align="end"` on the wrong side, arrows stepping the wrong way, nothing
  throwing. `DirectionProvider` now wraps the tree in `[locale]/layout.tsx`,
  guarded WITH the control that makes the test mean something (no provider
  really does give "ltr"). (3) my own: the edit retiring the floating-panel
  guard's stale assertion **never landed — `str.replace` says nothing when
  it matches nothing, and I printed a success line anyway**, twice in one
  day. The guard counted `<Popover` TAGS, which both implementations write
  identically, so it could not tell them apart and would have gone on
  passing if the hand-rolled one came back; it counts the IMPORT now.
  Its first verify-red was an import error — **"a red that names a
  different defect is not a verify-red"** — redone with a change that
  still compiles, failing on `expected 1 to be greater than 1`.
  Test-driver note for every future Radix swap: **a Radix trigger opens on
  POINTERDOWN, which `fireEvent.click` does not send** — sixteen tests were
  failing for a reason that had nothing to do with the product; menu tests
  use `userEvent` now. Also: 0152 fixed the platform console's 500 (a
  definer door's `RETURNS TABLE` is a CONTRACT — widening the SELECT inside
  it without widening the signature is a 42703 that only a platform root
  can reach, which is why no test saw it; DROP-then-CREATE, and the drop
  takes the grant with it), and the sign-in password eye is physically
  placed (`pr-11` + `right-2`) because the input is pinned `dir="ltr"`
  while the button resolves `end-*` against the PAGE — the logical forms
  are forbidden by a test, since they look correct in English.

- 2026-09-02 (THE UNIFICATION ROUND — the reference measured, not eyeballed;
  809 web tests): user directive, "the look of the platform is like 10
  different developers made it … open panel.arameet.ir and use it as
  template." So it was MEASURED — computed styles, signed in, at 1745px —
  and the numbers with their conditions live at the head of
  scaffold/constants.ts. **The headline finding, and the answer to "ours is
  too big": THEY HAVE NO LARGE PAGE HEADING.** A page's name is 15.5px in
  the top bar and the biggest thing on a list screen is a 14px card title;
  ours opened at 24 and forced everything under it wider. Moved at the
  tokens, where one edit reaches every screen: menu 256→248, top bar 48→62,
  column 1200→1240, page padding 48/40/64→26/28/40, radii 14→12 / 18→16,
  every type role down. Two needed a SHAPE change: the page and section
  titles rode `text-2xl`/`text-xl`, so **the two most structural sizes in
  the product were the only ones the blueprint did not own** — and
  scaffold.test.tsx PINNED that reliance; they are derived roles now and the
  test asserts the ORDERING (page > section > body), which is the invariant
  it was really about. **The leverage: 1095 size classes, 94% of them
  `text-sm`/`text-xs`** — relabelling headings file by file would have moved
  71 and left a thousand, "which is exactly how a product comes to look like
  ten people built it, because the exceptions get fixed and the default
  never does"; Tailwind's own steps are re-pointed at the measured scale.
  `.btn` was a PILL (`rounded-full`) — one class, and most of why our
  screens did not look like the reference at identical colours and copy.
  Inputs got the reference's own ground (`--field`, registered in the theme
  AND given its three contrast floors in verify-pairs: typed text,
  placeholder, control edge). **The last one was the UNIT, not the scale:**
  our root font-size scaled with the viewport (an earlier directive) at
  ~14px on a 1280 laptop while the reference is a fixed 16 — so at the width
  people actually work at we rendered the same design an eighth smaller than
  the thing we were copying, and no amount of adjusting the type scale could
  have found it. Baseline moved so 16px lands at 1440; measured after,
  button 38 / input 40 / radius 11, the reference's numbers exactly. Accent
  deliberately NOT taken: #018146 was already measured and nudged to #01743F
  because its own 12% chip sat at 4.22 — a recorded decision, not a drift.
  **Then the finding that only came from verifying the DEPLOYED screen:**
  the buttons still looked wrong, and measuring them said why — 47 controls
  had hand-rolled their geometry in ELEVEN shapes against 109 using `.btn`,
  because **`.btn` offered exactly one size, so every screen wanting a
  compact control had to invent one.** `.btn-sm`/`.btn-icon` added (measured),
  30 sites converted, the rest a WORKLIST in control.guard.test.ts that
  fails in BOTH directions — too many is a regression, too few is a stale
  entry, because "an allow-list nobody has to shrink is a backlog nobody can
  see". Its four required signals (height AND corner AND flex AND
  items-center) are the mirror-trap defence: `h-8` alone is spacing,
  `rounded-lg` alone is a card.
  Same round: sub-menu off Workflows/IntegrationDetail, Integrations into
  Settings + off the rail, Skills out of the Settings menu (rail learns both
  from SETTINGS_SECTIONS, never a second list). **Seeded English on a
  Persian screen** — the two flagship workflow cards rendered the wire
  straight since the feature existed, while every other list on the page went
  through the catalogue; locale files were CLEAN (full parity, no English in
  fa, no hardcoded JSX prose), so the whole gap was wire data, **a silent
  class by construction: the resolver falls back to the stored string ON
  PURPOSE, so a missing catalogue entry shows English and nothing goes red.**
  seededCopy.guard.test.ts closes it, both locales, verified red on both
  shapes (missing entry, and the worse half-entry where the title localizes
  and the sentence under it does not). **The notify guard had been enforcing
  NAMES, not the rule** — `startedToast` (a pill mid-page on a 4s timer)
  walked past a regex anchored at the identifier's start and a USER found it;
  it matches the MECHANISM now (state cleared to false by a timer), with one
  named exclusion (clipboard acks: nothing was written, the ack is on the
  button pressed). **The loading rule became a component**: `me: User | null`
  made "still loading" and "there is nobody" the same value, so the bell
  could only appear after the network — three states now, plus
  Skeleton/SkeletonLines and `loading` on DataTable, which keeps the header,
  borders and column widths (structure is known before the network) and puts
  skeleton cells where rows will be. Two consequences are the point: the
  layout stops moving when data lands, and **"loading" stops being
  indistinguishable from "empty"**.
  Probe lesson, twice in one session: **a Vercel deploy check that is not
  cache-busted measures the CDN, not the deployment** — 25 polls said "not
  deployed" about a build that had shipped (`X-Vercel-Cache: HIT`), and one
  `Cache-Control: no-cache` request returned a different CSS hash
  immediately. Earlier the same day the opposite: a marker chosen from the
  PREVIOUS commit reported "deployed" on the first attempt. Pick a marker
  that exists only in the commit under test, bust the cache, and assert the
  probe had a subject (an empty `css=` variable made twenty zeros mean
  nothing).

- 2026-09-02 (later — THE STRUCTURE ROUND: one page shell, one control set,
  the vendor places arrivals, and the room records itself): **every sub-menu
  is a top toolbar now.** Thirteen pages render through `TwoPane`, so the
  shape changed in ONE component and they all followed. The group TITLES went
  with the pane — a vertical menu needs them to break a long list into
  different questions; a horizontal row of eight buttons does not, and a
  heading above a toolbar reads as a label for the page. Groups survive as
  the separators between runs of buttons, the meetings toolbar's own device.
  **Page headers gone at `PageHeader` itself** (18 pages, no 18 edits that
  could each drop a button): a 24px title, a subtitle and a hairline — ~90px
  at the top of every screen restating a name the breadcrumb already showed.
  Asserted as an ABSENCE as well as a presence, "because the version that
  still renders a title looks perfectly fine and is only wrong beside every
  other page".
  **PENDING ARRIVALS MOVED TO THE PLATFORM CONSOLE** (0153–0157). The queue
  sat in Management·Users where an org admin approved their own arrivals —
  right for someone they invited, wrong for what actually produces those
  rows: a stranger signs up, lands in an org of their own naming, and only
  the vendor can decide where they belong. Placement is org + role +
  activation in ONE statement (two would leave a member ACTIVE in the org
  they invented if the second never happened). It needed a door in
  `tg_app_user_guard`, whose org-immutability is "true on every path,
  operator included" — the exception is written as **the condition that
  makes it true rather than as a permission**: `old.status='pending'` (the
  row has nothing hanging off its org — that is what pending MEANS) AND `not
  from_app` (echo_app cannot reach it by any UPDATE it writes; only a definer
  door can, and there is exactly one).
  Three corrections the checks forced, all worth keeping: (1) I asserted the
  status change "rides the history trigger" — **there is no such trigger**;
  `record_status_change` refuses every caller outside a trigger and the guard
  never calls it, so acceptance, suspension and placement all leave the trend
  table untouched. Recorded in the migration as a real gap; the check asserts
  what the operation DOES guarantee (`accepted_at` set, `accepted_by` NULL =
  M15's spelling of "the vendor did this"). (2) 0155 rebuilt the guard from
  **0036's text — where I had just been reading it — reverting 0038, 0040 and
  0044**; one assertion caught it (17_roles forbids any function outside
  `role_is_admin` comparing a literal role, which 0036's body does, four
  migrations before the rule existed). 0157 rebuilds on 0044's body, the true
  predecessor. 0132's lesson in the same shape: **`create or replace` accepts
  a stale body as cheerfully as a current one — it is not a diff.** (3) the
  probe could not walk the ordinary path until it BECAME the actor
  (`set_config('echo.actor_id', …)`), because `require_platform_root` demands
  the supplied actor equal the session's — a self-check that only asserts
  refusals is the authorization-matrix corollary's exact failure.
  **ELEVEN BUTTON SHAPES**, measured: 47 controls hand-rolled their geometry
  against 109 using `.btn` — because **`.btn` offered exactly one size**, so
  every screen wanting a compact control had to invent one. `.btn-sm` /
  `.btn-icon` added (measured off the reference), 30 sites converted, the
  rest a WORKLIST in `control.guard.test.ts` failing in BOTH directions.
  Same shape for the loading rule (`loading.guard.test.ts`): Skeleton /
  SkeletonLines / SkeletonCards + `loading` on DataTable, applied to search,
  speakers, integrations, conversations, agents, workflows and the dashboard
  tiles (whose loading state was an ellipsis — "reads as *this tile is
  broken*, not *this tile is coming*"). Several worklist entries are NOT
  defects (a modal flag, an error code, a picker's value) and stay listed
  rather than pattern-matched away, **because telling a list from a flag by
  its NAME is the false-positive factory that gets a check muted inside a
  week**.
  **THE ROOM RECORDS ITSELF** (LiveKit egress, audio-only, S3 out): the
  server already routes every participant's audio, so asking a laptop to
  re-capture what its speakers play was the long way round — and it cost a
  share dialog, a discarded video track, and the quality of a mic
  re-recording a loudspeaker. IN PERSON needs no second design: everyone
  opens the link on their own phone, so each voice arrives on its own track.
  The participant token does NOT carry `roomRecord` (verified red by adding
  it); `egressConfig()` reports absent unless every value is present, and the
  test drops each of the eight in turn — "a check that only removes the first
  proves nothing about the eighth". **Needs one credential to switch on:
  a Supabase Storage S3 access key (`EGRESS_S3_*` in core.env).**
  Deploy note re-learned twice: **an un-cache-busted Vercel check measures the
  CDN, not the deployment**; and core deploys are git-archive + restart, with
  the discriminating check being 401 (wired) vs 404 (absent) on the new route.

- 2026-09-02 (evening — ECHO STARTS FOLDING IN, and an outsider can finally
  join): **the pending queue, Echo's menu, and the guest door.**
  Two menus were broken by the previous round and both were found by the
  user: Integrations became a Settings section and the PAGE never learned
  it, so the one screen with no way back to its siblings was the one the
  menu had just been extended to include; and Audit Logs was the product's
  only caller of the WIDE column, so with the nav inside that container the
  same toolbar sat at 1240 on seven sections and 1600 on the eighth — **a
  control that changes place between siblings has to be re-found every
  time**, which is the one thing chrome may never do. One width everywhere
  now, and the nav renders in its own container so a future wide section
  cannot take the menu with it. Its dropdown carried FOUR overrides of
  `.input` (`h-11 min-h-0 py-0 text-sm md:h-10`) — four ways of re-answering
  the one question that class exists to answer, which is exactly why it was
  the one control on the page that did not match.
  **`window.prompt` is gone and guarded** (`nativeDialog.guard.test.ts`):
  three of them (task topic, call chapter, whiteboard text). The browser's
  dialog says "app.neurai.pt says", is unstyled in both themes, carries no
  RTL or Persian type, blocks the page, and cannot hold a second answer or a
  refusal — **the first requirement past "one short string" forces a rewrite
  anyway**. The topic became the inline composer the COLUMN beside it already
  used: the platform had solved it correctly ten pixels away.
  **ECHO**: search row gone (the top bar's field is the door on every screen;
  it had been pushing `/echo/search`, an address the route no longer serves,
  so the platform's one search box led nowhere), the three guided walks gone,
  **speakers moved to Management** (a voice print is a fact about a COLLEAGUE,
  not about a recording), and the side menu became a top toolbar like every
  other surface. Echo is on its way into the meeting; until then it should at
  least not be the one app with a different anatomy.
  **THE GUEST DOOR (0158)** — «کپی لینک» copied the meeting PAGE, which needs
  an account in the org, so **the invite link worked for exactly the people
  who did not need one**, and an external participant — the ordinary case for
  a meeting — was the one case the room could not serve. A code is a
  CAPABILITY, not an identity: CSPRNG, mintable and revocable by the
  meeting's own members, and what it buys is deliberately tiny. **The SQL
  function RETURNS THREE COLUMNS, so the security surface is a SHAPE rather
  than a filter somebody has to remember** — with a self-check on the column
  count for the day someone widens it. Unknown and revoked codes answer
  identically ("this used to work" tells a stranger there is something here).
  The token carries `guest:` in its subject precisely because the display
  name is theirs to type. The page renders outside the shell entirely: every
  shell element would be a door into a product they have no account in, and
  **offering doors that refuse is worse than offering none**.
  FOUR guards fired on that one page and every one was right — auth coverage
  (the platform's only anonymous capability endpoint), icon scale, the
  second viewport-height root, and trail coverage. Each got an ENTRY WITH ITS
  REASON, never a loosened rule; and `coreFetch` gained an explicit
  `anonymous` opt-in rather than a fallback, **so a missing session keeps
  meaning 401 and an auth bug cannot quietly become an anonymous call**.
  Dashboard, from the screenshots: the stat strip's `content-center` left a
  band of dead air under the cards (a gap that reads as a MISSING WIDGET
  rather than as spare room inside one); the hour lane was `auto`-width so
  the day columns crowded the digits — and an auto lane changes width with
  the digits, moving the whole grid sideways on a locale switch; the upcoming
  rows took the reference's shape (date block, title, time · mode, stage),
  with `formatDayMonth` added beside `formatDate` because **the calendar
  preference decides which month a date IS** — 11 Shahrivar and 2 September
  are the same instant with different month names, and two surfaces
  disagreeing about it is the two-spellings defect wearing a date.
  Meeting details: `justify-between` had thrown each label to one edge and
  its value to the other, so reading a field meant crossing empty space and
  hoping the thing on the far side belonged to the label you started from —
  a failure that gets worse the wider the card gets.
