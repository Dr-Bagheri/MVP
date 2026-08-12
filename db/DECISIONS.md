# `db/` — decisions taken with the code, for the steward

Per the session rules, new constraining choices get numbered M-decisions
before or with the code. These are the ones the schema commits us to. They are
written as **proposals**: the steward folds them into ARCHITECTURE.md (as
M19…, or as amendments to the M-decisions they refine). Nothing here
contradicts a ruling; where a ruling was silent, the reasoning is given so it
can be overruled cheaply.

Below the proposals are five questions the schema could not answer for itself.

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

**D4 — "Current summary" is derived, not a pointer column.**
Highest `version` wins, exposed as a view. A pointer on `echo.call` would have
forced the agent to hold UPDATE on `call` in order to replace a summary, which
would have handed it the ability to change scope or set `deleted_at`. Deriving
the pointer means the agent needs no grant on `call` at all. *(Refines M8.)*

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

**D10 — The 30-minute part rule is a check constraint.**
`call_part.duration_ms <= 31 minutes` (one minute of encoder slack). A longer
part means the splitter is broken, and we want that at write time rather than
at playback. *(Implements M7.)*

---

## Questions the schema could not settle

**Q1 — Who accepts the founding admin of a brand-new org?** *(blocking for
signup, not for the schema)*
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

**Q2 — May an owner restore their own soft-deleted call, or only an admin?**
M11 says the purge window is "visible to admins". As built, a soft-deleted call
is invisible to its owner, so only an admin can restore it. That may be exactly
right (deletion should feel like deletion) or may be a support burden.

**Q3 — Who may rename and merge entries in the org speaker directory?**
The directory is org-wide and SPEC does not restrict it, so any active member
may currently rename or merge. Linking a voice is separately restricted to the
call's owner (M11), which is the privacy-relevant act. If renaming should be
admin-only, it is a two-line policy change.

**Q4 — Should an admin be able to edit an org-scoped call they don't own?**
SPEC states the "reads everything, rewrites nothing" rule in the section about
the *agent*. I applied it to humans as well, so an admin cannot retitle or
re-scope another member's call, only archive/delete/restore it. If admins are
meant to curate org-scoped calls, the trigger in `0011` needs to say so.

**Q5 — pgmq queue creation is not in `db/`.** The extension and the queues
belong with the code that drives them (`core/worker`), so this package does not
create them. Confirm that split so nobody ships it twice.
