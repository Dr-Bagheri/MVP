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

Append-only tables go further: `summary` and `admin_action` carry **no UPDATE
grant for any role**, core/ included. Running the suite is what surfaced this
— the immutability triggers were doing the work while the grants still said
UPDATE was fine, so the invariant held only as long as the trigger did. Both
layers now say the same thing, and the suite tests them separately.

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

**D12 — pgmq queues are created where pgmq exists, and skipped where it does
not.** The queues (`echo_transcode`, `echo_vad`, `echo_transcribe`,
`echo_diarize`, `echo_link_speakers`, `echo_summarize` — one per DAG step, M7)
ship in `0017`, but pgmq is a property of the server: Supabase has it, a stock
Postgres does not. The migration creates them when it can and emits a notice
when it cannot, so the schema and the security suite stay runnable against any
Postgres, as instructed. Only `echo_app` gets grants on the queue schema — the
agent is invoked *by* the DAG and has no business driving it.

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

**Q2 — RULED as built (steward): only an admin restores.** Deletion should feel
like deletion. Original question kept for the record:

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
