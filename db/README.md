# `db/` — the schema, the wall, and the tests that prove it

Hand-written SQL in numbered migrations (M8). Drizzle, in `core/`, is for
queries only — a generator cannot emit RLS policies, role grants or column
privileges, and would silently drop the entire security layer while appearing
to work.

## Running it

```bash
pnpm --filter @echo/db up        # local Postgres 17 in Docker, port 55432
pnpm --filter @echo/db migrate   # apply pending migrations
pnpm --filter @echo/db test      # reset, migrate, run the RLS/grant suite
```

`test` is the gate. It resets the database, applies every migration from
scratch, and runs each file in `test/` in its own transaction against a fixed
fixture of two orgs and five people.

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

Roles are created NOLOGIN and passwordless. `scripts/grant-login.mjs` grants
LOGIN from environment variables — passwords never enter the repo.

## How an identity reaches the database

`core/`'s connection factory is the only way to get a handle, and it always
attaches one of two things inside the transaction:

```sql
set local role echo_app;                       -- or echo_agent
select set_config('echo.actor_id', $1, true);  -- the acting user
```

`SET LOCAL`, never `SET`: on a pooled connection an identity that outlives its
transaction is somebody else's identity. Pipeline jobs run as the call's owner
(M3) — the worker builds the identity from the row and sets it the same way,
so there is no service-account path and no second code path to audit.

**Setting `echo.actor_id` is equivalent to authenticating.** Nothing stops a
caller that already executes arbitrary SQL from setting it — at that point the
game is over regardless. What the GUC buys is that every query, from every
process, resolves identity through one function, and RLS applies uniformly.

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
project (Supabase, Postgres 17.6): **8 files, 143 checks**, 16 tables, every
table with RLS enabled and forced.

- an org sees none of another org's calls, transcripts, members or search hits
- a member sees their own calls and org-scoped ones; an admin reads everything
  in the org, including soft-deleted calls inside the purge window
- a pending user (M15) sees nothing but their own row
- no identity → no rows, anywhere
- an admin may delete any recording but cannot retitle or re-scope one they
  do not own
- nobody changes their own role or status
- `echo_agent` holds no DELETE grant on any table in the database
- the agent cannot touch a `call` row at all, cannot read anyone's email, and
  cannot rewrite a line on a call its caller does not own — even when its
  caller is an admin who can read it
- a summary version is never edited; replacing one adds a version, and the
  pointer on the call moves by trigger — no caller holds a grant on `echo.call`
- an assistant session is invisible to the org's admin, while the `agent_run`
  audit trail stays visible to them
- a purge succeeds even when an assistant conversation referenced one of the
  runs being purged — the conversation survives with its link cut
- a pending account can read its own row and nothing else, and cannot write
  even that
- removing a skill means archiving it: the slug frees up, the retired
  definition stays attached to the runs that used it
- `echo_purge` cannot delete a call still inside its window
- the speaker directory can only be joined by the call's **owner** (M11) —
  not by an admin who can merely read the call
- a gateway API key resolves to a member, and stops resolving when that
  member is disabled
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
