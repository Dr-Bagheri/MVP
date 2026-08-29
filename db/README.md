# `db/` — the schema, the wall, and the tests that prove it

Hand-written SQL in numbered migrations (M8/M9, corrected). **There is no ORM
and no query builder anywhere in this system** — `core/` queries with
postgres.js, this package's runner with `pg`, and every statement is SQL
somebody wrote.

That is the security posture, not a preference. A schema generator cannot emit
RLS policies, role grants or column privileges, so adopting one would drop the
entire security layer while continuing to look like it worked — and the layer
it drops is the only one that survives a bug in the layers above.

*(M8/M9 named Drizzle until it was noticed that nothing had ever installed it.
Corrected rather than adopted: the reason for hand-written SQL is better served
without a builder in the way. If you are building from this file, do not
install one.)*

## Running it

```bash
pnpm --filter @echo/db up             # local Postgres 17 in Docker, port 55432
pnpm --filter @echo/db migrate        # apply pending migrations
pnpm --filter @echo/db test           # run the RLS/grant suite
node scripts/db.mjs test --fresh      # ...after rebuilding the schema from zero
```

`test` is the gate. It applies pending migrations and runs each file in `test/`
in its own transaction against a fixed fixture of two orgs and five people.

**It is safe to run against the shared dev project.** The suite touches only
its own fixture — two org ids nothing else uses — and clears them again on the
way out, so another session's work is neither read nor destroyed.

The cleanup runs **after** the migrations, not before, and skips tables that
are not there. A table rename is what taught us why: **cleaning before
migrating means naming tomorrow's schema against today's database.** The list
of fixture tables tracks the migrations, so it must never run ahead of them.

### `--fresh` is not "the thorough option"

`--fresh` drops and rebuilds the whole schema, which proves the migrations
apply from zero — and *will* take every other session's data with it. The two
goals genuinely conflict on one database, so they are separated in time rather
than traded off (steward ruling, mirroring the live-lane rule):

| | when | where |
|---|---|---|
| fixture-scoped (default) | every run, day to day | the shared dev project |
| `--fresh` | at release gates, before an installer or deploy milestone | a **disposable** target — local container or scratch project — steward-driven, result recorded |

Read that as a split, not a ranking. Reaching for `--fresh` on the shared
project because it sounds more rigorous is how you delete a colleague's
afternoon; the default proves everything about the wall, and `--fresh` proves
one additional thing about the migrations themselves.

### Which database it talks to

In order: `DATABASE_URL` from the environment; then the `echo_platform_db_url`
secret in the local DPAPI store; then the local container. `--local` forces the
container. The connection string carries the database password, so it lives in
the encrypted store like every other credential — never in the repo, never in
an env file, never in a log line.

Two safeguards, because `reset` is destructive and the remote target is a real
Supabase project:

- **`reset` refuses to run against a non-local database** unless
  `ECHO_ALLOW_REMOTE_RESET=1` is set.
- **It never drops the `auth` schema remotely.** Locally that schema is our own
  shim; on Supabase it *is* Supabase Auth, and dropping it would take
  authentication with it. Remotely, only the fixture's own `auth.users` rows
  are removed, by id.

The local container is initialised with Postgres 17 to match the dev project.

## The permission stack, and which file holds which layer

| Layer | Where |
|---|---|
| identity arrives (JWT or built from a row) | `0001` — `echo.actor_id()` |
| membership rules in one place | `0003` — `actor_org_id`, `actor_is_admin`, `actor_is_active` |
| which **rows** | `0013` — RLS policies |
| which **columns** of a row | `0011` — triggers (humans), `0014` — grants (the agent) |
| which **tables**, and no DELETE | `0014` — role grants |

Read `0013_rls_policies.sql` first; it is the shortest complete statement of
who may see what.

**But do not reason about current behaviour from a migration file.** Migrations
are append-only, so a later one silently supersedes an earlier one's policy
while both remain on disk looking authoritative — `0018` rewrote four of
`0013`'s, and anyone reading `0013` alone is now wrong about all four. This has
already cost one session a wrong diagnosis. Ask the live catalogue instead:

```sql
select policyname, cmd, qual, with_check
from pg_policies where schemaname = 'echo' and tablename = 'skill';
```

The same habit that everyone applies to columns — check `information_schema`
rather than trusting a type — applies to policies, triggers and constraints,
and is easier to forget there because the migration text reads like a
specification.

## Three roles, defined by what they cannot do

- **`echo_app`** — `core/` api and worker. Everything except DELETE: deletion
  in this product is soft, so the application cannot express a physical one.
- **`echo_agent`** — the agent runtime's tool calls. Reads what its caller
  reads; writes exactly three things (a transcript line's text, a speaker
  label or link, a new summary version), column by column. **No DELETE grant
  on any table.** This is what makes "the agent deletes nothing, ever" a
  property of the database rather than a claim about prompts.
- **`echo_purge`** — the 30-day hard purge, and nothing else. The only role
  holding DELETE, and its policies let it see and delete only rows whose
  window has already expired.

Roles are created NOLOGIN and passwordless, because a password is a secret and
secrets never appear in a migration (invariant 7).

### Deployment checklist: granting login

This is a real deployment step, not a dev chore — without it `core/` cannot
connect at all, and the failure looks like a configuration mystery rather than
a missing step.

```bash
node scripts/grant-login.mjs echo_app echo_agent
```

Generates a CSPRNG password per role, grants LOGIN, verifies the credential by
connecting with it, and writes a percent-encoded connection URL to the DPAPI
secret store. The password exists only inside that process: never printed,
never in argv, never in the repo. Consumers read the URL from the store by
name — `echo_platform_db_app_url`, `echo_platform_db_agent_url` — never from a
message or a file.

The verification step is not ceremony: it connects as the new role and asserts
that with **no identity attached it sees zero calls**, so a credential is only
stored once it has been shown to land inside the wall rather than beside it.

Two roles are deliberately excluded. `echo_purge` waits for the purge-job
package — a live credential with no consumer is pure liability. `echo_vendor`
never gets one at all: its procedure runs from the owner connection by design
(D13), and a login would turn a deliberate operator path into a reachable
service account. The script refuses it by name.

**Executed on the dev project (`aqgpxnyuxukwgphrxslw`) on 2026-08-12**, scope
`echo_app` + `echo_agent` only, steward-authorized. Note that `db.mjs reset`
(and therefore `test --fresh`) drops and recreates the roles, which invalidates
the stored URLs — re-run this script after any such rebuild.

### Deployment checklist: the audio bucket

```sql
-- as the owner connection
insert into storage.buckets (id, name, public)
values ('call-audio', 'call-audio', false)
on conflict (id) do nothing;
```

`call-audio` matches `call_part.storage_bucket`'s default, and **private** is
the whole point (M10: signed URLs for all audio, private buckets). Executed on
the dev project 2026-08-12.

Done through SQL on the owner connection rather than the Storage API. Echo
Mobile's `apply_migrations.py` warns that this insert fails in the hosted SQL
editor because the storage schema is owner-restricted there, and reaches for
the Storage API instead — but a direct owner connection has the privilege the
editor lacks, so no service key is needed for this step at all.

**`storage.objects` deliberately has zero RLS policies, and should stay that
way.** RLS is on, so with no policy nothing reaches an object except the
service key — which is precisely the model: `core/` mints short-lived signed
URLs server-side, and the browser never talks to storage under its own
authority. A policy added here to "make uploads work from the client" would
quietly replace signed-URL access with client-side access, which is a different
security model wearing the same clothes. If uploads seem to need one, the
missing piece is a signer, not a policy.

### Development identities (dev only — never production)

The suite's fixture cleans up after itself, so between runs the dev project has
**no `app_user` rows at all**. Every RLS-protected read from a hand-set actor
then returns empty — correctly, since there is nobody to be — but it presents
as "the schema is broken" rather than "the database is empty". So:

```bash
node scripts/seed-dev.mjs      # idempotent
```

seeds two orgs and four members, outside the fixture's UUID ranges so the suite
never touches them:

| | UUID | why |
|---|---|---|
| org, active | `0d000000-0000-4000-8000-00000000000d` | |
| org, **suspended** | `0d000000-0000-4000-8000-00000000000e` | |
| **owner**, active (`dev-admin@echo.local`) | `0d000000-0000-4000-8000-000000000001` | the org root: manages the admin tier, org-level irreversibles |
| **admin**, active (`dev-orgadmin@echo.local`) | `0d000000-0000-4000-8000-000000000005` | a plain admin — without a second account, "only the owner may change an admin" cannot be exercised |
| member, active | `0d000000-0000-4000-8000-000000000002` | the non-admin refusal, against real RLS rather than a fake |
| member, **pending** | `0d000000-0000-4000-8000-000000000003` | authenticates, then refused for being unaccepted (M15) |
| member, active in the **suspended** org | `0d000000-0000-4000-8000-000000000004` | an active person whose org is suspended |

The owner's address says `dev-admin@` for a reason worth knowing rather than
fixing: `0036`'s backfill promoted it (it was the dev org's first admin), its
email cannot be renamed because the app_user guard makes email immutable —
correctly, since the auth provider owns it — and by then 38 rows of other
sessions' work already pointed at the account. **The address is historical; the
role is the truth.**

The last two earn their place by being unreachable otherwise. With no users at
all, every token 401s and the M15 branch is never exercised end to end — an
identity has to authenticate *and then* be refused before `{kind: "pending"}`
can survive the BFF hop; seeding that row turned up a real bug within minutes
of landing. And the suspended member is deliberately **active**: they did
nothing wrong and are not pending, so "suspended" has to be a third answer
rather than a shade of either. Everything that distinguishes the three runs
through `echo.actor_is_active()`, which collapses user status and org status
into one boolean — so the only way to tell the callers apart is to have one of
each.

**This is a script, and it must never become a migration.** A numbered
migration ships to every deployment, and a fixed-UUID admin seeded into a
customer's production database is a backdoor with documentation — the account
identifiers are in a public repo, and nobody would question it because it looks
like part of the schema. The script refuses any host it does not recognise as
development for the same reason.

**Production has no seeded identities.** The first account in a real deployment
is created by `echo.register_account()` like every other, lands `pending`, and
is accepted by us (D13). There is no bootstrap account, and there should never
be one.

### Secret naming

Every Echo platform credential in the DPAPI store carries the
**`echo_platform_`** prefix (CLAUDE.md rule 3). Three products share that
store, and the store currently holds `supabase_url`, `supabase_service_key`,
`echo_supabase_url` and `echo_supabase_publishable` — all belonging to *other*
projects. A plausible-name guess there is unrecoverable: a session nearly
pointed a service key at the wrong project. Never read a `supabase_*` or
`echo_supabase_*` name from platform code.

| secret name | what it is |
|---|---|
| `echo_platform_supabase_url` | the dev project's URL |
| `echo_platform_supabase_secret_key` | Supabase secret key (storage signing, purge deletes) |
| `echo_platform_db_url` | owner connection — migrations, this tool |
| `echo_platform_db_app_url` | `echo_app` — api and worker |
| `echo_platform_db_agent_url` | `echo_agent` — agent tool calls |
| `echo_platform_db_purge_url` | `echo_purge` — the purge job, nothing else |
| `openrouter_key` | **cross-product canonical — deliberate exception to the prefix rule** |
| `soniox_key` | **cross-product canonical — deliberate exception to the prefix rule** |

The last two are the exception worth stating loudly, because it costs twenty
minutes every time it isn't: **model and STT provider keys are shared across
all three products and keep their bare names.** They are ours to read from
platform code, and they must **never** be duplicated under an
`echo_platform_*` alias — two names for one credential means one of them is
stale the day it rotates.

Nothing else without the prefix is ours. A `supabase_*` or `echo_supabase_*`
name belongs to another product, and reading one from platform code points a
key at the wrong project — the near-miss that produced the rule.

The failure this table exists to prevent is the quiet one: grepping
`echo_platform_` for the provider key, finding nothing, and concluding the
credential doesn't exist. Now the search lands on the pointer instead of on
silence.

**Rotation log.** `echo_platform_service_key` held the pre-rotation Supabase
secret key and was **deleted from the store on 2026-08-12**, after confirming
nothing in the tree consumed the name and that the credential itself was dead.
A dead credential under a plausible name, sitting beside a live one, is the
same failure class the prefix rule exists to prevent — so a rotation is not
finished when the new key is stored, only when the old name is gone.

**No Supabase management token (`sbp_…`) is in this store**, checked by format
across every unprefixed entry rather than by guessing at names.

Two different things follow, and conflating them costs a session either way:

- **There is no token value to read, pass to a script, or put in an env var.**
  Anything that needs to *hold* a management token needs one minted for it.
- **The Supabase CLI on this machine is logged in, and is usable as a tool.**
  Its credential lives in the OS credential manager, not in `~/.supabase` —
  which is empty, and looks exactly like "not logged in" to anyone who checks
  there. Verified by running it: `npx supabase projects list` returns the dev
  project. CLI-driven deploys work today; that is the established pattern from
  the Echo Mobile sessions.

So: the CLI's login is available, its token is not. If a task needs the
Management API through the CLI, it works now; if it needs the raw token, that
is a fresh mint.

## How an identity reaches the database

`core/`'s connection factory is the only way to get a handle, and it always
attaches one of two things inside the transaction:

```sql
set local role echo_app;                       -- or echo_agent
select set_config('echo.actor_id', $1, true);  -- the acting user
```

`SET LOCAL`, never `SET`: on a pooled connection an identity that outlives its
transaction is somebody else's identity.

**The two credentials hold no membership in each other.** Verified on the dev
project: `echo_app` and `echo_agent` can each `SET LOCAL ROLE` only to
themselves, and the cross attempt fails with **SQLSTATE 42501**, `permission
denied to set role "…"`.

> **Never "fix" a 42501 at `set local role` with a grant. Fix the URL.**

That absence of membership is deliberate and load-bearing — it is the alarm
wire, not a gap. A correctly-wired pool re-asserts the role it already holds,
which is legal and needs no membership; a mis-wired one dies before any
identity attaches. Granting cross-membership would convert that death into a
silent successful downgrade, and the misconfiguration would then run correctly
forever and never be found. Asserting the role at the top of
the transaction is therefore a *loud failure* mechanism, not a downgrade one:
if a pool is wired to the wrong URL, the transaction dies before any identity
is attached rather than running with authority it should not have. Expect
42501 and report it as a misconfiguration, not as a connection fault — it will
otherwise read like a network problem at the worst possible hour.

Do not rely on an over-privileged connection *downgrading* into these roles.
It happens to work on the dev project because the owner has been granted
membership so the test harness can `SET ROLE`; on a fresh deployment that
depends on `ADMIN OPTION` from role creation, which is not a property to build
on. Connect as the role you mean to be. Pipeline jobs run as the call's owner
(M3) — the worker builds the identity from the row and sets it the same way,
so there is no service-account path and no second code path to audit.

**Setting `echo.actor_id` is equivalent to authenticating.** Nothing stops a
caller that already executes arbitrary SQL from setting it — at that point the
game is over regardless. What the GUC buys is that every query, from every
process, resolves identity through one function, and RLS applies uniformly.

### RLS composes by intersection — a join can revoke a deliberate exception

Two policies that are each correct can combine into a rule nobody wrote. An
inner join across two protected tables shows only rows visible in **both**, so
joining a permissively-gated table to a strictly-gated one silently narrows the
permissive one to the stricter rule.

The case that cost a session an afternoon:

> **A pending actor may read their own `app_user` row and nothing else. Do not
> join it to anything.**

`app_user_read` deliberately lets a person read their own row whatever their
status — that is the only way the UI can say "awaiting approval" (M15).
`org_read` requires `actor_is_active()`. So a pending person sees themselves
and not their org, and an identity-resolution query that inner-joined the two
returned no rows at all: a valid token with a real account was reported as
**unauthenticated**, and the waiting-for-approval screen could never render.
The M15 state this schema goes out of its way to preserve was made unreachable
by a join in another package.

`LEFT JOIN`, and treat the absent side as its most restrictive value. More
generally: when resolving an identity, read `echo.app_user` alone, then decide.
Anything you join to it inherits its policy's gate, and the gates are not the
same.

**The same trap catches policy authors, and there it has a better fix.** An
`EXISTS` against another protected table inside a policy is evaluated as the
caller, so a guard like "this delivery must name a webhook in my org" — written
as a subquery against `echo.webhook`, which members cannot see — denies every
insert instead of the wrong ones. This was written, and caught by re-reading,
within hours of the paragraph above being added. *(The webhook tables were
removed in `0132`; the example is kept as it happened, because the trap is
about policies and joins, not about that feature.)*

So: **when a policy needs a fact about another protected table, reach for a
constraint, not a subquery.** The cross-org guard is a composite foreign key
(D9), which makes the bad row unrepresentable and never asks who is looking.
Structure does not have the intersection problem; predicates do.

### 42501 arrives from three different places, and they mean different things

A consumer mapping errors needs to tell them apart, because two are the product
answering correctly and one is a deployment fault. This is invisible from the
schema's side and cost the api session a debugging round.

| what happened | how it surfaces | what it means | what the consumer owes it |
|---|---|---|---|
| a policy filtered the rows | **no error at all**, zero rows affected | the caller may not reach that row | its own branch — nothing raises, so an error handler never sees it |
| the executor refused the row | 42501, routine `ExecWithCheckOptions` | a policy or a missing GRANT: **our misconfiguration** | stay loud — a 500 that wakes someone |
| this schema refused deliberately | 42501, routine `exec_stmt_raise` | a guard or named operation saying no on purpose | the product's refusal — 403/404, quiet |

Rows 1 and 3 are **answers**; row 2 is a **fault**. One SQLSTATE, three
obligations — which is why the api pins its branches on `routine` rather than
on the code.

The third is the one to get right. Every trigger guard and every named
operation in this schema refuses through `raise … using errcode =
'insufficient_privilege'`, so it carries `routine: exec_stmt_raise` and sails
straight past an RLS branch pinned to `ExecWithCheckOptions`. Left unhandled,
**every deliberate refusal becomes a 500 blaming us for our own correct
answer.** Map it to the product's refusal (403/404); keep the executor branch
for the genuine misconfiguration it was written to catch.

And note the first row is not an error path at all. Where a silent filter is
possible and a caller needs to distinguish "refused" from "already done" from
"never existed", that operation should be a named function returning a value,
not an `UPDATE` returning a count — which is why deletion is
`echo.soft_delete_call()` (D21).

### Percent-encode the password in the connection string

Read this before debugging a connection. Supabase generates database passwords
containing characters that are legal in a password but not in a URI — `/`, `?`,
`#`. Pasted in raw, a `/` silently terminates the URI's authority section, and
the driver ends up trying to resolve the **username** as a hostname:

```
getaddrinfo ENOTFOUND postgres
```

which reads exactly like a DNS or firewall problem and is neither. Encode the
password with `encodeURIComponent`, splitting on the **last** `@` so a password
containing `@` also survives — `normalizeDbUrl()` in `scripts/db.mjs` is a
working implementation to copy. Cost me a round of misdiagnosis; it should cost
core/ nothing.

## Accepting a new org (operator procedure)

M15 as amended: a person joining an **existing** org is accepted by that org's
admin, in the product. A person who registers a **new** org — including the
org-of-one founder — has nobody in their org to accept them, so **we** accept
them; acceptance is the commercial gate, and there is no trial.

That is an operator path, not a product path. `echo_vendor` holds no table
privileges at all — only EXECUTE on two functions — and `core/` connects as
`echo_app`, which has no EXECUTE on either. No request can reach it.

```sql
-- as echo_vendor
select * from echo.vendor_pending_orgs();      -- who is waiting
select echo.vendor_accept_org('<org-uuid>');   -- accept the founder
```

`vendor_accept_org` refuses an org that already has more than one member — that
org has an admin of its own. In the accepted row, `accepted_at` set with
`accepted_by` NULL is the record that the vendor accepted it rather than an org
admin. An internal surface can replace the psql step later; the rule lives in
the database either way.

## Persian text

Two layers, on purpose:

- `core/`'s `faNormalize()` — the TS port of neurai-mvp's `fa_normalize`:
  ZWNJ joining, punctuation spacing, character unification. Applied at ingest
  **and** to the query string (M8).
- `echo.fa_fold()` — a locale-independent fold applied by the database itself
  when it builds every `tsvector`. Letterforms, digits, diacritics, ZWNJ.

The database layer exists so the index and the query cannot drift apart if a
caller forgets to normalize. It deliberately uses no word-boundary regex:
Persian letters are not alphabetic under a C locale, so `\y` and `\m` would
misbehave silently. For the same reason the local container is initialised with
a UTF-8 ctype — under a C locale every `tsvector` comes out empty and only
search breaks.

## Facts the suite asserts

Not a summary of intentions — these run. Last verified green against the dev
project (Supabase, Postgres 17.6): **17 files, 309 checks**, 21 tables, every
table with RLS enabled and forced.

- an org sees none of another org's calls, transcripts, members or search hits
- a member sees their own calls and org-scoped ones; an admin reads everything
  in the org, including soft-deleted calls inside the purge window
- a pending user (M15) sees nothing but their own row
- no identity → no rows, anywhere
- a member deletes their own call and an admin deletes any, both through
  `echo.soft_delete_call()`; setting `deleted_at` directly is refused, because
  a write that hides its own result cannot be an UPDATE
- an org's own owner cannot suspend it — status is the vendor's, in both
  directions, because suspension was a door that opened one way with the org
  on the wrong side
- an admin may delete any recording but cannot retitle or re-scope one they
  do not own
- nobody changes their own role or status
- `echo_agent` holds no DELETE grant on any table in the database
- the agent cannot touch a `call` row at all, cannot read anyone's email, and
  cannot rewrite a line on a call its caller does not own — even when its
  caller is an admin who can read it
- a summary version is never edited; replacing one adds a version, and the
  pointer on the call moves by trigger — no caller holds a grant on `echo.call`
- a call that finished without a summary says why, stays `ready` rather than
  failed, and cannot still claim a skipped summary once one arrives
- an assistant session is invisible to the org's admin, while the `agent_run`
  audit trail stays visible to them
- a purge succeeds even when an assistant conversation referenced one of the
  runs being purged — the conversation survives with its link cut
- a pending account can read its own row and nothing else, and cannot write
  even that
- removing a skill means archiving it: the slug frees up, the retired
  definition stays attached to the runs that used it
- the work plane holds only queues that have consumers, and the agent cannot
  even enumerate them
- word-timing coverage lives per part and nowhere else: `echo.call` has no
  such column, and blanking a line's words demotes its part automatically
- `echo_purge` cannot delete a call still inside its window
- the speaker directory can only be joined by the call's **owner** (M11) —
  not by an admin who can merely read the call
- a gateway API key resolves to a member, and stops resolving when that
  member is disabled
- a gateway key cannot reach the assistant unless an admin opened it, and no
  key written before that feature existed acquired it
- the `call_current_summary` view respects the caller's RLS rather than its
  owner's

## Adding a migration

Numbered, append-only. The runner stores a checksum and refuses to start if an
already-applied file changed — two databases silently disagreeing about their
own shape is the failure this prevents.

A new table gets, in the same change: `org_id`, RLS enabled **and forced**, its
policies, its grants, and the tests for both. Nothing is granted by default in
this schema, so a table added without grants fails closed — `core/` gets a
permission error, which is the failure we want.
