# `db/` — decisions taken with the code, for the steward

Per the session rules, new constraining choices get numbered M-decisions
before or with the code. These are the ones the schema commits us to.

**Status: D1–D14 ratified wholesale by the steward as M19** (schema approved
unconditionally at migration 0018, 143 checks green against the dev project).
ARCHITECTURE.md carries the record; this file keeps the reasoning, so that a
decision can be revisited without re-deriving why it was taken. All five
questions below have been ruled.

---

## Proposed

**D1 — Product tables live in schema `echo`, not `public`.**
Supabase auto-exposes `public` through PostgREST. We never use PostgREST —
`core/` is the only client — so keeping tables out of `public` means a leaked
anon or service key has no REST surface to aim at. RLS would still hold; this
removes a wall we would otherwise have to defend. `0014` also revokes the
schema from `anon`/`authenticated` where those roles exist. *(Refines M8.)*

**D2 — Identity reaches the database as `SET LOCAL echo.actor_id`.**
One function, `echo.actor_id()`, resolves it, falling back to the Supabase JWT
claim. This is what lets M3's "identity can be built from a row as well as a
token" be true without a second code path: the worker running as a call's owner
and a browser request are indistinguishable to every policy. `SET LOCAL`, never
`SET` — on a pooled connection a leaked identity is somebody else's identity.
Consequence to state plainly: setting that GUC *is* authenticating, so the
connection factory really is the only door.

**D3 — Three roles, and only one of them can delete.**
`echo_app` (core/) holds no DELETE anywhere — deletion in this product is soft,
so the application cannot express a physical one. `echo_agent` holds no DELETE
either, plus column-level write grants. `echo_purge` is the only role with
DELETE, and its RLS policies let it see and delete only rows whose 30-day
window has already expired — a purge job with a bad `WHERE` clause still
cannot take a live call. *(Implements M3/M11.)*

Append-only tables go further: `summary`, `admin_action` and
`proposal_decision` carry **no UPDATE
grant for any role**, core/ included. Running the suite is what surfaced this
— the immutability triggers were doing the work while the grants still said
UPDATE was fine, so the invariant held only as long as the trigger did. Both
layers now say the same thing, and the suite tests them separately.

> **[AMENDED 2026-08-27]** D3 now carries exactly ONE named exception:
> `0079` grants `echo_app` DELETE on `echo.call_note` — a note is its
> author's own annotation, designed append-only delete-and-retype ("an
> edited note is a new note"), the RLS policy scopes the delete to
> `created_by = actor`, and core consumes it (`calls.ts` `deleteNote`). The
> record itself (calls, transcripts, summaries, runs) remains untouchable:
> the exception covers a person's own marginalia, never the org's data.
> A second grant of this class — `0101`'s `role_capability` DELETE — was
> the accident that proves the rule: it contradicted its own migration's
> keep-rows design, had no consumer, and is revoked in `0109`. The suite
> (`50_identity_search_gateway`) asserts the exception list EXACTLY, with a
> staged-grant negative control, so this class cannot grow silently. If the
> steward/user ever rules notes must keep rows instead (the 0106 flag
> pattern), the exception list shrinks to empty and 0079's delete converts.

**D4 — The current-summary pointer is a column on `echo.call`, moved only by
the database.**
As dispatched, `call.current_summary_id` exists. The complication worth naming:
if replacing a summary required the *caller* to update `echo.call`, the agent
would need UPDATE on that table — and the same grant would let it change a
call's scope or set `deleted_at`. The grant wall would have a hole in the shape
of a feature. So the pointer is moved by a SECURITY DEFINER trigger on summary
insert: the agent inserts a version, the database moves the pointer, and nobody
holds a grant on `echo.call`. A guard keeps the pointer honest (it can only
name one of that call's own versions) and it only ever moves forward, so a
replayed older version cannot drag it backwards. `echo.call_current_summary`
(highest version) remains as the read path and agrees by construction.
*(Refines M8.)*

**D5 — Column-level rules for humans are triggers, not policies.**
RLS chooses rows; it cannot choose columns. Three rulings are column-shaped —
an admin may delete any recording but not rewrite one they don't own; nobody
changes their own role or status; a corrected line keeps its identity and
timing — so they live in `BEFORE` triggers (`0011`). For the agent the same
rules are grants, which are stronger. *(Refines M3.)*

**D6 — A gateway API key acts as a member, not as "the org".**
`api_key.actor_id` names the person whose authority the key borrows, so a
gateway request arrives with a user identity and meets the same wall as a
browser request — invariant 2 keeps no exceptions. It also means disabling an
employee stops their integrations immediately, without a key rotation.
*(Refines M17.)*

**D7 — Persian normalization is two layers, and the database owns the index
one.** `core/`'s `faNormalize()` (the TS port) does the linguistic work at
ingest and query; `echo.fa_fold()` does a locale-independent fold inside every
generated `tsvector`, so index and query cannot drift if a caller forgets.
Operational consequence: **the database must be initialised with a UTF-8
ctype**. Under a C locale the default parser does not treat Persian letters as
word characters and every `tsvector` comes out empty — a failure that breaks
only search and nothing else. *(Refines M8.)*

**D8 — Exactly two SECURITY DEFINER doors.**
Registration and API-key resolution are the only operations that legitimately
run before an identity exists, so they are the only definer functions in the
product: `echo.register_account()` (which *cannot* produce an active user —
acceptance is a separate admin-only update) and `echo.resolve_api_key()`.
Anything else that wants to bypass the wall has to argue with this decision.

**D9 — Cross-org references are structurally impossible.**
Every table carries `org_id` (M2) and every foreign key between product tables
is composite — `(owner_id, org_id) → app_user (id, org_id)` and so on. A row in
org A cannot point at a row in org B even if RLS, the app and the policies were
all wrong at once.

**D11 — An assistant session is private to the person having it — including
from their admin.**
`agent_session` / `agent_message` are readable only by their owner. This is the
single place where "admins read everything in their org" does not apply, and it
is deliberate: an admin's audit surface is `agent_run` — what the agent did, on
which call, with which tools, replayable — not the text of a colleague's
conversations. Conflating the two would have quietly turned every private
question into an admin surface. If the steward wants admin visibility here, it
is one policy, but it should be a ruling rather than a side effect.

**D12 — Queues follow consumers, not the status ladder.** *(Revised by `0019`
under the M7 amendment of 2026-08-12.)*

`0017` created one queue per DAG step, mirroring the status ladder. That was
wrong: ml/'s `/process` performs transcode → vad → transcribe → diarize in one
approved call, so the worker walks a part through all four rungs from a single
message, and `echo_vad` / `echo_transcribe` / `echo_diarize` had no consumer at
all. `0019` drops them for one `echo_process_part`. A queue nothing reads is
worse than a missing one — it looks like a component, and the first person
debugging a stuck pipeline loses an afternoon proving it is empty on purpose.

What did **not** change is `echo.part_status`: every rung stays, because the
statuses are the progress positions the UI shows and the artifacts each step
checks itself against (M7). Only the transport collapsed. "One step per queue
message" now describes the per-call steps — `echo_link_speakers`,
`echo_summarize` — which genuinely are separate messages.

`0019` refuses to drop a queue that holds messages: those queues should be
empty because nothing ever wrote to them, and if that assumption is wrong the
messages are real work rather than something a migration may discard quietly.
`echo_transcode` outlived `0019` on purpose — the worker consumed it as a
stopgap, and a migration does not pull a queue out from under a running
consumer. Backend 2 confirmed the switch and `0021` retired it, so the per-part
plane is now exactly one queue. `0021` also records the message shape, because
one field of it is load-bearing for the security model rather than for
convenience: `{ callId, ownerId, partId }`, where `ownerId` is how M3's
"pipeline jobs run as the call's owner, never as a service account" survives
contact with a queue — the worker resolves identity from the payload, re-reads
the call as that owner, and fails closed if it is not visible. There is no
privileged lookup that would let a job proceed under an identity that does not
own the work, which is why the enqueuer must write the real owner while a
genuine caller is present.

pgmq itself is a property of the server (Supabase has it, a stock Postgres does
not), so both migrations create-or-notice rather than failing, keeping the
schema and the security suite runnable against any Postgres. Only `echo_app`
holds grants on the queue schema: the agent is invoked *by* the DAG and has no
business driving it — `90_queues.sql` asserts it cannot so much as enumerate
the queues.

One consequence to leave alone (Backend 2's finding): `echo_app` cannot call
`pgmq.purge_queue`, because it TRUNCATEs and TRUNCATE needs ownership. That is
not a broken permission. Draining with `read` + `delete` works and is what a
worker does anyway, so the correct response to hitting it is to drain, not to
grant the queue tables' ownership away to fix a convenience method.

**D13 — Vendor acceptance is an operator role, not a product feature.**
*(Implements the M15 amendment.)* A fourth role, `echo_vendor`, holds **no
table privileges at all** — only EXECUTE on `echo.vendor_pending_orgs()` and
`echo.vendor_accept_org()`. `core/` connects as `echo_app`, which has EXECUTE
on neither, so no request can accept a customer however wrong the code above
it is. The function refuses any org with more than one member (that org has an
admin of its own), and `accepted_by IS NULL` with `accepted_at` set is the
record that the vendor accepted rather than an org admin.

The seam this rides on, stated plainly because it is the one place the guards
relax: `0011`'s app_user trigger enforces its authority rules only when the
**effective role** (`current_user`) is `echo_app` or `echo_agent`. The database
owner is outside them by definition — a superuser can do anything a trigger
says regardless — and that is the path the SECURITY DEFINER acceptance
functions run through. Integrity rules (identity and org are immutable) still
apply on every path.

It has to be the effective role and not `pg_has_role(...)`: membership is
grantable and transitive, so a membership test would start calling the operator
"an app connection" the moment anyone granted `echo_app` to the owner — which
is precisely what a test harness does in order to `SET ROLE`. The suite caught
that; it would have been a silent hole otherwise. Relatedly,
`vendor_accept_org` records `accepted_by` as NULL by construction rather than
by relying on no identity being set on the connection.

For v1 this is a documented psql procedure; an internal surface can replace
the step later without moving the rule.

**D10 — The 30-minute part rule is a check constraint.**
`call_part.duration_ms <= 31 minutes` (one minute of encoder slack). A longer
part means the splitter is broken, and we want that at write time rather than
at playback. *(Implements M7.)*

---

**D14 — A skill is archived, never deleted.**
*(Answers the steward's review question.)* `skill.archived_at` retires a
definition and frees its slug — the three uniqueness indexes are partial on
`archived_at is null` — so `/recap` can be written again after a first attempt
is retired. No role holds DELETE on `echo.skill`, because past `agent_run` rows
name the skill that produced them and those runs must stay replayable
(invariant 5). This is the same shape as archiving a call: the product has no
destructive delete for a user-authored artifact.

`enabled` and `archived_at` are different acts. Backend 1's wording, which is
the one to quote: *disabled means not offered right now and falls through to
the layer beneath; archived means retired, frees the slug, and must not
resolve — but `getSkill(id)` filters neither, because `agent_run.skill_id` has
to stay explainable and invariant 5 is about what happened, not what's
currently offered.*

**D18 — A skill may carry its own tool-call ceiling.** *(`0025`, M4
amendment.)* `skill.max_tool_calls integer`, nullable, `> 0` enforced. Part of
what an admin configures, on the same logic as the model allow-list: a heavy
research skill and a two-call recap deserve different budgets, and the admin is
the cost lever. NULL means "inherit the runtime default" rather than
"unlimited" — a skill that says nothing should inherit a ceiling, not escape
one. Zero is refused, because "no tools" is already expressible as an empty
`tools` array and a second, worse spelling of it would eventually be written by
accident.

Worth recording how this arrived: `core/`'s `Skill` type carried
`maxToolCalls` before any ruling existed, and the column was declined until the
steward confirmed it. Adding schema to match a type that outran its decision is
how tables grow columns nobody owns.

**D15 — Word-timing coverage is recorded per part, and the data may only
demote it.** *(`0020`, from core/'s request via the steward.)*
`call_part.has_word_timestamps` lets the calls list stop running a correlated
sub-query over `transcript_segment.words` per row. Two constraints make it
safe:

*Per part only, and never mirrored onto `echo.call`.* A stored call-level flag
is the shape that tempts a consumer into using it as a per-row gate — the
frontend shipped exactly that bug, stripping click-a-word from perfectly-timed
rows because one *other* part of the call had degraded. Call level is a
derived summary (core/'s `transcript_timing: "full" | "mixed" | "none" | null`)
and belongs in a response, not a column. `35_word_timings.sql` asserts the
column's *absence*, so a future migration adding it fails the suite instead of
the product.

*One-way maintenance.* The column denormalizes the transcript, and the
transcript is the source of truth (invariant 1), so the two can disagree — and
a summary that quietly disagrees with what it summarizes is worse than none.
A trigger lets the data **demote** the flag (blanking a line's words clears its
part) but never promote it: asserting coverage stays the worker's job, done
once per part, so bulk inserts pay nothing. The agent, which holds UPDATE on
`(text, words)` and nothing on `call_part`, can therefore cost a part its
coverage through a correction but can never claim coverage it does not have.

The consequence, stated so nobody later files it as a bug (steward-ratified as
intended): **a correction that restores words does not re-promote the part.**
Only re-transcription does, because only the process that writes the whole part
knows whether *every* line in it is timed — one restored line does not. The
failure direction is the safe one: the UI degrades to line-level seeking on a
part that might have deserved better, rather than promising word seeking it
cannot honour. Asserted in `35_word_timings.sql`.

**D16 — A gateway key does not reach the assistant unless someone opened it.**
*(`0022`, M17 amendment.)* `api_key.allow_assistant boolean not null default
false`. A key borrows a member's authority (D6), and that member can talk to
the assistant — so until now a leaked key was unbounded model spend. The ruling
is scope, not throttle: per-key, admin-granted, off by default.

Default `false` rather than nullable-unknown, because "nobody decided" and "no"
must behave identically here; a three-state flag is eventually read as "not
configured, so allow".

The part that makes it enforceable rather than merely recorded: the flag is
returned by `echo.resolve_api_key()`, not looked up afterwards. At gateway auth
time there is no identity — that is what the function exists for — so `core/`
*cannot* read `echo.api_key` to find it: those policies require an active
admin, and the caller at that moment is nobody. A flag core/ couldn't reach
would have been decoration.

**D17 — A skipped summary is not a failed call, and its excuse expires
automatically.** *(`0023`, M5 amendment.)* `call.summary_skipped_reason text`
records why the summarize step completed without writing one — the ladder's
terminal rung, visible and retryable. It previously landed in
`failure_reason` on a `ready` row, which is a lie in the unusual direction:
not "this worked" about something broken, but "this failed" about something
that finished.

Clearing it lives in the `0008` pointer trigger rather than in worker
discipline, for D15's reason: the trigger already fires at exactly the moment
the claim stops being true, and the data clearing its own stale claim beats a
process remembering to. The reason clears whenever **any** version arrives, not
only when the pointer advances — a late-arriving older version still means a
summary exists, so the excuse is still false. A check constraint
(`current_summary_id is null or summary_skipped_reason is null`) makes the
trigger's job provable rather than merely intended; the pair is the pattern,
not either half.

The companion guard — `failure_reason is null or status = 'failed'` — was held
back until Backend 2 confirmed their write had moved, then landed as `0024`.
Holding it was the same call as leaving `echo_transcode` standing: a constraint
that is right does not become right *early* at the cost of breaking a running
consumer.

`0024` carries one thing their confirmation implied but did not mention.
M7 says a failed call is visibly failed **and resumable** — and resuming moves
status away from `failed`, so a reason left behind would have made the
constraint reject the recovery path itself, turning a retry into an error. The
trigger therefore clears `failure_reason` when a call leaves `failed`, by the
same principle as the skip reason: the data drops its own stale claim rather
than the worker remembering to. Keeping a history of past failures is an audit
question — `agent_run` and the admin action log are where history lives, not a
column on the live row.

**D19 — A subscription's existence is an org fact; its URL and secret are a
credential.** *(`0026`, M17.)*

> **[FEATURE REMOVED 2026-08-29 — `0132`.]** The webhook tables, the queue and
> `subscribed_webhooks` are dropped; the M17 amendment in ARCHITECTURE.md has
> the reasoning. D19 is kept rather than deleted because a decision log records
> what was decided and why, not only what currently exists — and the rule it
> carries is general: **the existence of a thing and the credential that
> operates it are two different visibility classes.** The next outbound
> integration inherits that, not the function name.

`echo.subscribed_webhooks(event)` returns
`{id, events, enabled}` for the caller's own org to active members, and never
`url` or `secret_sha256`. `echo.webhook` itself stays admin-only for every
command.

The line is drawn there because the two halves are different kinds of thing.
**That the org emits an event, and which events**, is something the org agreed
to; a member whose own call triggers one is already a party to it, and needs to
know in order to record that a delivery is due. **Where it points and what
signs it** is neither — it is the destination and the credential together, and
knowing them is the difference between "my call will be announced" and "I can
announce anything to that endpoint, signed". Members get the fact; admins keep
the credential.

The helper is the identity-helper class — self-scoped, secret-free, unable to
answer at all without an identity — not a pre-identity door in D8's sense. It
reveals strictly less than `echo.webhook`'s own admin policy, to strictly fewer
people. Disabled subscriptions are returned rather than filtered, so the
enqueuer can report "3 subscribed, 1 disabled" instead of silently emitting
less than the org expects (M21: forfeits are said out loud).

`0027` added `created_by` and `dispatchable` to the return, because `0026` had
made the ratified chain unbuildable: dispatch runs as the webhook's registrar,
that identity travels in the queue payload written at enqueue time, and the
enqueuer is a member who cannot read `echo.webhook` by any other route — so it
could create the delivery and not say who would send it, and the dispatcher
cannot resolve it afterwards, because reading `created_by` needs the very admin
identity it is trying to obtain. `created_by` is on the right side of the line:
a colleague already visible in the member list, not the destination and not the
credential.

`0030` closed the hole that made `created_by` load-bearing without being
bound: nothing had required it to be the acting admin, so admin A could
register a webhook that dispatches as admin B — handing B's outbound authority
to an endpoint B has never seen. Registration now requires
`created_by = actor`, and a trigger forbids reassigning it afterwards, because
binding creation is pointless if an edit can undo it.

The contrast with `api_key.actor_id`, which *may* name another member, is not
an inconsistency: **acts-as is that feature's explicit design**, chosen at mint
and surfaced as "runs as X". `created_by` is a **fact** — who registered this
— and a fact must not be supplyable. The seam is recorded here so the
distinction survives: if webhooks ever need acts-as, it arrives as an explicit
`actor_id` column chosen at creation, the way `api_key` did, never as an
accident of `created_by`. Editing and disabling stay any-admin, so a departed
creator strands nothing — recovery is another admin re-registering under their
own name, revoke-and-reissue in outbound form.

`dispatchable` — whether that registrar is *still* an active admin — is the
same forfeit-out-loud shape as returning disabled rows. The dispatcher already
fails closed on a demoted identity, correctly, but silently and late: queued,
attempted, refused by the wall. Saying it at enqueue time lets the decision to
emit be an informed one.

**The split that made this necessary:** enqueue is the call **owner**, a
member; dispatch is the webhook's **creator**, an admin, carrying identity in
the queue payload and failing closed if later demoted — the outbound twin of
D6. `0013`'s comment had claimed a member-run dispatcher, which its own
policies forbade (a member could insert a delivery but never select one, and
`echo.webhook` was admin-only). Nothing had been built yet, so nothing failed;
a comment describing a control nobody wrote is worse than no comment, because
it reads as evidence. `0026` makes comment and policy describe the same worker.

One consequence worth stating for consumers: a member **cannot read back what
it enqueued**, including through `RETURNING`, which Postgres subjects to the
select policy. An enqueuer therefore generates the delivery id itself rather
than expecting one back. And a delivery cannot name another org's webhook —
that is a composite foreign key (D9), not a policy predicate, because an
`EXISTS` against `echo.webhook` inside an INSERT policy is evaluated as the
member, who cannot see that table, and would deny every enqueue. Same
intersection trap as the pending-user 401.

**D20 — `agent_run` records what the agent did; a person's decision is a
different event that references it.** *(`0028`, corrected by `0029`.)*

A directive to record proposal approvals in `agent_run.steps` met `0011`'s "a
finished agent run is closed" and lost. That is the invariant working: an
approval is not something the agent did, and storing it there would have meant
reopening closed runs for every confirm — trading replayability (invariant 5)
for storage convenience.

`0028` put approvals on the human-action surface and renamed it
`human_action`, because a member approving a correction on their own call is
not an admin action. `0029` replaced that with `echo.proposal_decision`, a
dedicated table, and renamed `admin_action` **back** — with decisions on their
own surface, that name is true again. The rename had solved a problem the new
table stops creating. Reversing it cost a migration rather than an edit, which
is the price of append-only and worth paying to never disagree with ourselves
about our own shape.

Three things the dedicated table gets right that the shared one could not:

- **`proposal_id` is the primary key**, so replay refusal needs no partial
  index and no `decided` flag: a second decision is one INSERT and one `23505`,
  which the api maps to 409. Nothing to read before writing means nothing for
  two concurrent confirms to race over — the loser loses at the key.
- **A rejection is recorded as fully as an approval.** The interesting audit
  question is "was this ever put to someone, and what did they say", and an
  approval-only design answers it with silence for every refusal. One decision
  per proposal, final either way; a fresh proposal gets a fresh id.
- **Both links are severable.** `run_id` and `call_id` are `ON DELETE SET NULL`
  — the latter using PG15's column-list form, since `org_id` is `NOT NULL` and
  a whole-row null would fail. Without this the purge would stop dead on any
  call somebody had decided something on: `0018`'s lesson, which this table
  would otherwise have reintroduced in a new place.

`decided_by` is **stamped rather than supplied**: a row naming someone else is
corrected, not rejected, because the insert policy already refuses a forged
decider and rejecting would only make an honest caller's slip fatal. The agent
gets no grant at all — it proposes, it does not decide, and it does not read
the verdict, because an agent reading the human's answer is how a decision
becomes a prompt.

`45_approvals.sql` asserts, in both directions, that the decision row and the
product write share a fate — but that is a **schema capability, not the product
guarantee**, and the annotation there says so. In `core/` the decision inserts
on `echo_app` while the approved write applies on `echo_agent`, and different
roles are different connections: no transaction spans them. The product
guarantee is **decision-first ordering** (M4 as corrected) — the primary key
refuses a replay before anything applies, and the residual (decision recorded,
write failed) is visible and reconcilable rather than silent.

The two roles are not an inefficiency to remove. Applying the write as
`echo_app` would restore atomicity *and* let an approved proposal touch columns
the agent can never touch — `echo_app` may write a segment's `confidence` and
`provenance`; `echo_agent` may write only `text` and `words`. Giving up
atomicity is what keeps an approved write confined to the agent's grants. That
trade is the entry worth remembering: **an approval widens who consented, never
what may be written.**

**Neither audit table carries a hash chain, and that is deliberate.** Checked
against the migrations rather than recalled: the only `sha256` columns in this
schema are API-key and webhook-secret hashes and an audio checksum — there is
no `prev_hash`, no entry digest, nothing chained. `admin_action` and
`proposal_decision` are append-only by **grant and trigger** (no role holds
UPDATE or DELETE), which resists the application and the agent but not someone
with owner access to the database.

That is the right v1 posture — tamper-evidence belongs to the compliance suite,
which SPEC excludes — but it is a genuinely different property from
append-only, so it is written down here rather than assumed either way. The
predecessor's `adminlog` (neurai-mvp D12) *did* chain, and that memory has
already prompted one session to ask; the answer is that Echo's does not, by
choice, and adding one is a future seam. If it is ever added, note that a
rename or a rebuild re-anchors the chain — a re-anchored chain verifies
cleanly from its new genesis, which is exactly the gap a verification pass
cannot see.

**D21 — Deletion and restoration are named operations, because a write that
hides its own result cannot be an UPDATE.** *(`0032`, from a bug the api
session found.)*

An owner could not soft-delete their own call. Every term of `call_update`'s
`WITH CHECK` was true, the same row accepted `archived_at` in the same
transaction, and an admin succeeded on the identical statement — but the owner
got 42501. The discriminator was in `call_read`, not `call_update`:
`(deleted_at is null or echo.actor_is_admin())`. Setting `deleted_at` moves the
row outside the actor's **own SELECT policy**, and Postgres refuses an UPDATE
whose result the actor could not see. An admin's read clause has no
`deleted_at` condition, so an admin never met it.

**The rejected fix matters as much as the chosen one.** Widening `call_read`
with `or deleted_by = echo.actor_id()` is the smaller diff and makes the delete
work — it was confirmed by experiment — but it would overturn Q2, which the
user has since confirmed as final: a deleted call is gone for its owner,
"deletion should feel like deletion". It
would make every call an owner ever deleted permanently visible to them, and
the ruled behaviour would survive only in whatever `WHERE` clause `core/`
remembered to write. A product rule living in the app's filters instead of the
wall is what this schema exists to avoid. So the read stays as ruled and
deletion becomes `echo.soft_delete_call()` / `echo.restore_call()`.

Direct `deleted_at` writes are now refused for application roles, so there is
one door rather than two. That is the part worth generalising: **the UPDATE
path worked for admins and failed for owners, which is how the bug survived —
a path that succeeds for the privileged caller looks correct from wherever it
was tested.**

The class, checked rather than assumed: **`call_read` is the only SELECT policy
in the schema that tests a column an application role can write.** Every other
read policy turns on identity and org, so no other table has a write that can
hide its own result. Verified against `pg_policies` and
`information_schema.column_privileges` on the live catalogue.

And the reason the suite missed it, which is the more useful finding: M11 has
two halves — admins delete any, members delete their own — and the suite tested
the admin half and the members-cannot-touch-others half, never the plain case.
**Asserting the privileged path and the refused path can leave the ordinary
path unproven, and the ordinary path is the product.**

**D22 — An owner is an admin with more, and "admin" is decided in one place.**
*(`0035`–`0038`, M23.)*

The change that mattered was not adding the label. Every policy in this schema
asks `actor_is_admin()`; if `'owner'` were a role *beside* `'admin'` rather than
above it, promoting the founder would have stripped them of the product one
policy at a time — org settings, gateway keys, reading the org's calls — each
failure looking like an unrelated permissions bug. So `actor_is_admin()` means
**admin-or-owner**, and no policy needed rewriting.

Adding the label then invalidated every other `role = 'admin'` in the schema.
There were four. Three were anticipated (the central helper, and the two vendor
functions, because founders were on my mind); **the fourth — `dispatchable` in
`subscribed_webhooks` — was missed and caught by the suite**, where it would
have reported every owner-registered webhook as undeliverable and emitted
nothing, quietly. Fixing it was not the lesson: the rule had been written out
four times, so it could drift in four places. `echo.role_is_admin(role)` is now
the only place it is decided, and `17_roles.sql` asserts in negative space that
no function restates it.

That assertion immediately went red on the app_user guard, which used the same
literal to ask a *different* question — "is the target in the admin tier",
with `'owner'` handled by an earlier clause. Exempting the guard by name would
have worked and would have been a lie of omission: an exemption list is where
the next literal hides. Since neither side can be `'owner'` by the time control
reaches that line, the two tests are identical there, so the literal simply
went. **A rule that is hard to state without exceptions is usually two rules;
this one was one rule stated twice.**

Other decisions, each stated because it could reasonably have gone the other
way:

- **Backfill = the org's earliest-created admin**, not "earliest *accepted*
  admin". Acceptance gates access, not identity: a founder still waiting on
  vendor acceptance is nonetheless the org's root, and the accepted-only rule
  would leave such an org ownerless. Ties break on id, so a replay is
  deterministic.
- **At most one owner per org** as a partial unique index. "Exactly one" is not
  a table constraint — an org exists for an instant before its founder row
  does — so the structural half is at-most-one and `register_account` maintains
  the other half.
- **Nobody becomes owner by an UPDATE.** Transfer is an explicit action and is
  unbuilt in v1; until it exists, the label cannot be handed over by a column
  write, which is the same posture as deletion (D21). Attempting it is refused
  even above the wall, because the unique index does not care who is asking.
- **An admin may not mint an admin.** M23 gives the owner the admin tier, and
  an admin who could create a peer would create someone they then cannot
  manage — which is not "managing members".
- **Nobody changes their own role or status**, generalised rather than
  excepted: the rule that used to say "an admin may not change their own" now
  says it of everyone, including the owner.

**D23 — Identity fields: a handle is the org's, a Latin name is optional.**
*(`0039`, `0042`.)* `username` is unique **per org, never globally**: global
uniqueness would make "that handle is taken" an existence oracle over every
other customer's organization, turning a signup form into a cross-tenant probe
— and per-org is all a mention needs, since mentions resolve among people you
can already see. Format `^[a-z][a-z0-9_]{2,31}$`, which is a bidi decision
rather than a stylistic one: an `@mention` sits inline in running text, and a
Persian handle inside an LTR-embedded run leaves the *end* of the handle
genuinely ambiguous. The person's real name is `display_name` and is
unconstrained. `display_name_en` refuses blank strings so the fallback to the
Persian name actually fires instead of rendering empty; it is never
auto-transliterated, because a machine-guessed spelling of someone's name is a
wrong name. NULL username stays legal — forcing one at insert would mean
inventing a handle for someone who has not chosen it.

**D24 — Membership history is written by the database and reachable by nobody.**
*(`0040`, `0041`.)* Trends must never be faked, so `user_status_history` is
written by the `app_user` guard rather than by the api. Getting that right
needed one non-obvious step: the guard runs as the caller, so it needs EXECUTE
on the recorder — but granting that would let the api author any history it
liked, and making the guard SECURITY DEFINER would have silently disabled the
whole authorization block, since `from_app` is computed from `current_user`.
The recorder is granted and refuses any call where `pg_trigger_depth() = 0`.
**The api can neither author a trend nor omit one.** The write sits after the
authorization checks, so a refused attempt leaves no line — a history that
logged attempts would answer "what happened to this account" with things that
did not.

**D25 — An invitation is the acceptance.** *(`0043`, M24.)* Three arrival
paths, stated together so the gate stays coherent: **invited → active**
(someone vouched, by name); **self-signup into an existing org → pending**
(nobody vouched); **self-signup creating an org → pending until the vendor
accepts** (D13). Requiring an accept step after an explicit, named invitation
is a gate with no decision behind it, and a queue of pending people nobody
remembers inviting is how a real gate gets rubber-stamped. This is M24's own
"admin vouching = acceptance built in", applied to the door that involves
strictly more deliberation.

Deliberate deviation from the dispatch: the inviter's role decides **what role
they may grant**, not whether acceptance is needed — "accepted-or-pending per
the inviter's role" would mean an admin's invitee waits while an owner's does
not, a difference the invitee experiences and cannot explain. Only the owner
may invite an admin, for D22's reason. Nobody invites an owner.

The **address must match** on redemption. The link is delivered out of band, so
a forwarded one would otherwise let an unintended person join under someone
else's invitation — a bearer token where a named invitation was meant. Expired,
revoked, already-used, unknown and wrong-address all refuse **identically**, so
the endpoint is not a probe for valid tokens.

**D26 — True delete is a tombstone, and the handle is reserved.** *(`0044`,
`0045`, M24; steward-ratified.)* The row stays and is emptied: `admin_action`,
`proposal_decision`, `agent_run`, `summary.created_by` and every corrected
transcript line point at it, and an audit trail with holes where the
interesting people used to be is worse than none. Email is *replaced* rather
than cleared (NOT NULL and unique); status goes disabled; owned calls are
soft-deleted attributed to whoever did the deleting, so M11's window and the
audio purge apply exactly as they would to any other deletion. Owner-only —
this is the most irreversible thing in the product.

**The username is kept.** Freeing it would let a newcomer wear a departed
colleague's handle, and every historical reference to `@sara` would silently
resolve to someone else — in a product whose purpose is an accurate record of
who said what, a handle that changes owner is a small forgery machine, and the
damage lands retroactively on records already written. The objection that
reserving leaks the handle existed is bounded by D23: per-org uniqueness scopes
the leak to future members of the organization where that person actually
worked, who could learn as much from any transcript they appear in. References
resolve to "a deleted person, formerly @x". Full erasure is a platform-level
request, outside v1; an explicit owner reclaim operation stays available as a
future named action, **not** as a default and not until there is demonstrated
need.

**D27 — An organization's status belongs to the vendor, in both directions.**
*(`0052`.)* Asked to verify that a vendor-accept path exists for pending orgs,
I found it present and audited — and found the real one-way door beside it.

Measured before anything was written:

```
owner suspends their OWN org:  1 row  — ALLOWED
same owner tries to undo it:   0 rows — LOCKED OUT
```

`org_admin_update` let any admin write any column of their own org, `status`
included. Suspending took one UPDATE, and every predicate that would authorise
the reverse — `actor_is_admin`, `actor_is_active` — requires the org to be
active, so the reverse was unreachable from inside the product. An admin could
brick their own organization for everyone, permanently, with the only exit
being an operator holding raw SQL.

Two rules that were each correct: *admins manage their org*, and *a suspended
org grants nobody anything*. Together they built a door that opens one way with
the org itself on the wrong side of it. That is the same shape as the M11
soft-delete bug (D21) — a write that moves the writer outside their own
authority — and it is worth naming as a class: **any state transition that
removes the actor's power to make the reverse transition needs its exit built
at the same time as its entrance.**

So org status is not an application capability at all — not for an admin, not
for an owner. `echo.vendor_set_org_status(org, status)` is the named operator
path, vendor-only, and deliberately **both directions through one door**: an
operation that could only suspend would rebuild the one-way street it exists to
remove. `status_changed_at` answers "since when". Members' own statuses are
untouched, because a suspended org changes what its people can reach, not who
they are — writing "disabled" across a customer's staff over a late invoice
would be a lie the status history would then carry forever.

On the question as asked: the vendor-accept path **does** exist
(`vendor_accept_org`, `vendor_pending_orgs`, `echo_vendor` only) and is audited
— it writes a `user_status_history` line with `changed_by = NULL`, the
established vendor convention, alongside `accepted_at` with `accepted_by =
NULL`. One correction to the framing it was asked in: **the org is never
pending.** `register_account` creates it *active* with a *pending owner*; it is
the founder who waits, not the organization.

**D28 — Deletion events get their own metadata-only surface.**
*(Direction ruled; **build deferred to backlog**. Nothing implements this
today.)*

`0055` tightened `admin_action`'s insert to admins, which made an older gap
visible: M11 says human deletions are "always logged", members delete their own
calls, and **a member's deletion is recorded nowhere**. `soft_delete_call`
stamps `deleted_by` on the row and writes no audit line; that was already true
before `0055` and remains true now.

The ruled exit is the one `proposal_decision` established: **a member-visible
record surface of its own**, rather than widening `admin_action` back to any
member — which is what let that table keep an honest name in the first place.

It also dissolves a tension I had recorded separately. `call.deleted_by` is the
only trace a deletion happened, and it lives on the row the purge eventually
deletes, so after the window there is no record that anyone deleted anything —
"purge removes the content" and "the trail is append-only" appearing to point
in opposite directions. They never were about the same thing. **A deletion
event is metadata — actor, call id, timestamp; codes, never content — so it is
not what a purge exists to remove.** Its record survives with a severable link,
exactly as `proposal_decision` outlives the runs and calls it references
(D26/`0018`'s `ON DELETE SET NULL` family).

And unlike the truncation marker, nothing needs rescuing at purge time: the
event is written when it happens, so there is no moment where the fact stops
being readable and has to be materialised first.

**Status is the load-bearing part of this entry.** M11's "always logged" is
being amended to describe today's honest state — `deleted_by` on the row, event
record committed-but-unbuilt — rather than continuing to promise something no
code provides. That is the Drizzle lesson applied before it costs anyone: a
document asserting a capability the system does not have is worse than a
document that admits the gap, because only one of them can be believed.

**D29 — A connector token is a credential, while its connection row is
product metadata.** *(M30, `0065`.)* A connection row may reveal provider,
capability, account label, expiry and connection state to its owner; it may
never reveal an OAuth access or refresh token. The encrypted credential stays
in a separate table, is readable only by the server path that acts as the
same connected user, and has no agent grant. This keeps the normal product UI
from accidentally becoming a credential API, while still making a disconnected
or expired state observable and actionable.

The record is scoped by `(owner_id, org_id)` and provider. A connector is not
an organization-wide back door: a member chooses the connection that supplies
their own calendar/mail context, and RLS refuses another member's row even to
an administrator. This follows the assistant-session privacy posture (D11):
admin visibility of operational data is not a reason to expose another
person's conversational or external-account data.

---

## Questions the schema could not settle

**Q1 — RULED (steward): vendor acceptance.** A joiner is accepted by their
org's admin; a brand-new org — org-of-one founder included — is accepted by us.
Built as **D13** below. The original question is kept for the record:


M15 says every account is pending until an admin accepts it. A self-registering
individual (M2's org-of-one, a first-class customer) creates a new org and is
its only member — so there is no admin to accept them, and as written they can
never become active. `echo.register_account()` currently leaves them
`pending`, on the assumption that **we, the vendor, accept new orgs** — which
is consistent with "no trial" and with acceptance being a commercial gate. If
that is right, we need an internal acceptance surface (a vendor-side admin, or
a documented SQL step) before signup can work end to end. If it is wrong, the
alternative is that a founder is auto-accepted and only *joiners* wait. **A
ruling changes one line of `0015`, and nothing else.**

**Q2 — RULED as built: only an admin restores. Deletion should feel like
deletion.**

*Provenance, because it changed and the difference matters:* originally a
steward ruling that the user could override. When `0032` made owner-restore a
one-line change rather than a policy widening, the question was put to the user
directly and **confirmed by them as final** — admin-only stands. The line stays
unwritten, and it stays unwritten by decision rather than by nobody having
asked. Original question kept for the record:

**Q3 — RULED as built (steward):** renaming is org-wide, linking stays
owner-only. The privacy-relevant act is the link.

**Q4 — RULED (steward):** "reads everything, rewrites nothing" binds human
admins exactly as it binds the agent. An admin cannot retitle, re-scope, or
re-point the summary of a call they do not own — only archive, delete or
restore it.

**Q5 — RULED (steward): the conversation survives, for v1.** An assistant
conversation is the asker's own record — like notes taken in a meeting they
legitimately attended — so it outlives the purge of a call it discussed, with
the run link cut to NULL as `0018` does.

Recorded with its upgrade path, because the residual is real: message *text*
can quote transcript content, so M11's "audio, transcript and derived data
purge together" is satisfied for the artifacts and not for quotations of them.
The stricter option — purging messages whose run pointed at the purged call,
in-transaction before the FK nulls — stays expressible in this schema and
belongs to the compliance suite, which SPEC excludes from v1. It defers with
it. `core/` is to be told this before assistant persistence is written.

*(Q5, on where pgmq lives, was answered by the steward: it is this package's.
See D12.)*
