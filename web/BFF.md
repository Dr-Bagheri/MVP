# web/ BFF — route contract (draft for the Backend session)

Per M1, `web/` is UI **and** BFF: the browser holds an httpOnly cookie, the
access token never leaves the server, and every call to `core/` is a
server-to-server hop with a bearer token. This file is the web-side half of
the swap point — **the paths below are a proposal against core/'s emerging
API; the Backend session owns the final shape.**

## Shape already in place

| File | Role |
|---|---|
| `src/server/session.ts` | the ONLY reader of the session cookie / access token (server-only) |
| `src/server/core.ts` | `coreFetch` / `coreStream` — attaches the bearer, maps core/'s auth errors, never decides authorization itself |
| `src/app/api/**/route.ts` | thin handlers; one per client method |
| `src/api/client.ts` | unchanged signatures — Phase-A bodies swap from fixtures to `fetch("/api/…")` |

Error mapping follows `core/src/api/auth.ts` exactly:

| core/ | HTTP | client meaning |
|---|---|---|
| `UnauthenticatedError` | 401 | bounce to `/sign-in` |
| `NotActivatedError` (pending) | 403 `kind:"pending"` | show the M15 waiting-for-approval wall |
| `NotActivatedError` (not admin) | 403 `kind:"forbidden"` | hide/deny the admin surface |

The pending case is deliberately distinguishable because the UI has a
dedicated screen for it — but only from `403 + detail`, so a member probing
an admin route still can't tell "not admin" from "no such route".

## Route map — every handler below is written and typechecked

The shapes were ruled by the Backend session (see next section); these handlers
exist against them, so bringing the UI up on the real engine is a one-file swap
in `src/api/client.ts` — nothing under `src/app/api/` should need to move.

Each handler is a thin authenticated hop: attach the session, forward, map
errors. **No handler makes an authorization decision** — that lives in core/ and
RLS, and a BFF that re-implemented it would only add a second, weaker copy.

| BFF handler | → core/ | Notes |
|---|---|---|
| `GET /api/calls?archived=` | `GET /v1/calls` | visibility is RLS's job, not a BFF filter |
| `GET /api/calls/:id` | `GET /v1/calls/:id` | |
| `PATCH /api/calls/:id` | `PATCH /v1/calls/:id` | `{scope?, archived?}` |
| `DELETE /api/calls/:id` | `DELETE /v1/calls/:id` | soft delete, 30-day window (M11) |
| `GET /api/calls/:id/transcript` | same, `?from_ms&to_ms&limit` | `{call_id, segments}`; window OVERLAPS, so a straddling utterance still returns |
| `PATCH /api/calls/:id/transcript/:segmentId` | same | line correction keeps segment identity |
| `GET /api/calls/:id/speakers` | `GET /v1/calls/:id/speakers` | |
| `PATCH /api/calls/:id/speakers/:speakerId` | same | rename / link — owner's deliberate act (M11) |
| `GET /api/calls/:id/summary` | `GET /v1/calls/:id/summary` | current version; 404 = no summary (call IS visible) |
| `GET /api/calls/:id/summaries` | `GET /v1/calls/:id/summaries` | `{summaries}`, **newest first**; regeneration never destroys |
| `GET /api/search?q=` | `GET /v1/search` | `{hits}`; GET — a read with no side effects. `q` < 2 chars → 400 |
| `GET /api/models` | `GET /v1/models` | `{models, preferred_model, curated, tool_capability_filtered}`. **Nothing filters on tool support** — see below |
| `PUT /api/models/preferred` | `PUT /v1/models/preferred` | `{model: string\|null}`; null = "has not chosen", a real state |
| `GET /api/admin/members` | `GET /v1/admin/members` | `{members}`, **pending first** — do not re-sort |
| `POST /api/admin/members/:id` | `POST /v1/admin/members/:id/accept` | separate from PATCH so activation has no side door |
| `PATCH /api/admin/members/:id` | same | `{role?, status?}`; can't set back to `pending`; self-demotion 409 |
| `GET/PATCH /api/admin/org` | `/v1/admin/org` | |
| `GET /api/skills` | `GET /v1/skills` | 3 levels, most specific wins. `{id, slug, name, description, level}` — **no `prompt`**: a skill's prompt is org config, and a member who could read it could quote it back at the model |
| `GET/POST /api/gateway/keys` | `/v1/gateway/keys` | `token` returned **once**, on create, and never again |
| `DELETE /api/gateway/keys/:keyId` | same | revoke, not delete — the record survives |
| `GET/POST /api/gateway/webhooks` | `/v1/gateway/webhooks` | `secret` once-only, same rule |
| `PATCH /api/gateway/webhooks/:webhookId` | same | `{enabled}` — pause keeps history |
| `GET /api/gateway/deliveries?webhook_id=` | same | did the endpoint actually receive it |
| `POST /api/assistant/ask` | `POST /v1/assistant/ask` | **SSE passthrough**, unbuffered |

### Three shape rules that are easy to get subtly wrong

1. **404 ≠ empty.** An invisible call is 404, never an empty segment list — an
   empty list would assert "this call exists and has no words". `GET .../summary`
   also 404s, but there it means "no summary yet" and the call itself IS
   visible. Both arrive as 404 by design (an invisible call must be
   indistinguishable from a missing one); what separates them is whether the
   call object itself loaded.
2. **Seek affordance keys off `start_ms !== null`, not off `kind`.** Summary
   hits carry null timing because a summary is about the whole call and a
   fabricated timestamp would be a lie. The null is the fact; `kind` is only
   its usual cause.
3. **`snippet` carries `<mark>` and is untrusted.** It derives from transcript
   text, so it renders through a tag whitelist (split on the tag pair, every
   other piece handed to React as a string child) and never via `innerHTML`.
   Marks are **present-or-absent**: matching is Persian-folded server-side, but
   folding deletes ZWNJ, so highlighting runs against the raw text and a
   fold-only match returns correct-but-unmarked. The UI must look right with
   zero marks. **Never re-fold client-side** to recover them — a second
   normalisation rule would drift from the index it mirrors, which is the exact
   failure that centralising `echo.fa_fold` prevents.

### Removed: the "tool-capable only" claim

Two screens told users the model list was filtered for tool support, and
filtered on an invented `tool_capable` field. **Nothing filters on tool
support.** The catalogue carries no such field; core/ returns
`tool_capability_filtered: false` rather than ship a heuristic that would look
like enforcement. So the UI was making a safety claim with nothing behind it —
and at swap time the filter would additionally have emptied the picker, since
it keyed on a field that will never arrive.

Both renders removed; the message string is kept for whenever the fact has a
real source, and must not be rendered until then. Where that fact should come
from sits with the steward.

Also gone: the `★` "suggested" marker. The wire's `reasoning` flag is not the
same claim, and relabelling one as the other would have been the same class of
invention.

### Known stale: the admin allow-list, and the connectors gateway card

`/v1/admin/models` does not exist, so the admin screen's model allow-list is
mock-fed. Its rows use `AdminModelRow`, deliberately a separate Phase-A
view-model, so that `provider` / `allowed` / `suggested` / `tool_capable`
cannot leak back into the wire type.

`src/app/[locale]/connectors/page.tsx` was built against an earlier single-key
gateway and **cannot work against the real one**. It offers to *reveal* a
stored key; core/ keeps only a sha256 and a six-char prefix, so there is no
reveal endpoint and there never will be. `GatewayConfig` in `types.ts` is
retained solely as that screen's Phase-A view-model — it is not a wire type,
and it is replaced rather than migrated.

The rebuild is real design work, so it is deferred to the post-verdict pass
rather than half-done now. The BFF handlers above are complete and waiting for
it. Scope, so nothing is rediscovered late:

1. A mint flow that is a genuine **one-way door** — show the token once, offer
   copy, make navigating away unmistakably lossy. No reveal exists to fall
   back on; the recovery path is revoke-and-mint.
2. A key list surfacing **acts-as**, so an admin removing an employee can see
   which integrations die with them.
3. An **assistant opt-in toggle, default OFF** (db/0022 `api_key.allow_assistant`,
   M17 amendment). Admin-granted per key, because an assistant-capable key
   spends model tokens at machine speed. Surface its state in the list beside
   acts-as — it is the difference between a key that reads and a key that bills.
4. Webhook CRUD with a **fixed event picker** (never free text — core/ 400s an
   unknown event and names it, precisely so a typo fails loudly).
5. A deliveries log: did the endpoint actually receive it.

**Canonical copy — steward-blessed, use verbatim:**

> **"this key can do what you can do"** — never "full API access", which is
> both false and dangerous.
>
> **"a doorbell, not a delivery"** — webhooks carry identifiers and status
> only, never transcript or summary text.

These are the two sentences that keep the gateway honest; M17's amendment now
says the same things in architecture language.

### Enum drift is now caught at build time — `src/api/vocabulary.guard.ts`

Every union in `types.ts` that mirrors a closed vocabulary is asserted against
core/'s `@echo/core/vocabulary`, the same `as const` arrays core/ checks
against `pg_enum` on a live connection. The chain is **database → core/ →
here**, so a drift at either link fails typecheck by name (rule 10: the
consumer asserts the producer).

It is **type-only by construction** — nothing imports it, nothing is emitted,
so `@echo/core` never reaches a browser bundle and Next needs no
`transpilePackages`. The link is a tsconfig `paths` mapping, not a workspace
dependency: it buys the check without touching install state. Add the real
dependency only if a *runtime* import of core/ is ever wanted.

Both directions are asserted, and they fail differently: one catches a value we
invented, the other a value core/ added that we never handled. Verified by
reintroducing `"transcribing"` — the guard failed by name, alongside the tone
map. Four of eight `CallStatus` values here never existed and rendered fine for
weeks because the fixtures were invented to match; one assertion closes that
class for every enum at once.

**Deliberately not written yet: `/api/auth/*`.** Per ruling 4 these wrap
**Supabase Auth**, not core/ — sign-in, Google OAuth (a redirect/PKCE round
trip), and setting the httpOnly session cookie. Unlike the table above, that is
not a shape I can get right by reading a contract: it needs a real Supabase
project to exercise, and an unverified auth flow is the one piece of this app
where "compiles and looks right" is worth nothing. It waits for credentials.

## Contract — RULED by the Backend session (2026-08-10)

1. **Path prefix `/v1/…`** — confirmed. Versioned from day one because M17
   exposes the same surface publicly; internal and public must not diverge.
2. **SSE vocabulary** — exact payloads, implemented in the mock generator so
   the swap is transport-only:
   - `text_delta {delta}` — append in order.
   - `tool_call {id, name, label, state, ms?}` where state is
     `started | ok | denied | blocked | error`. One `started` and exactly one
     terminal state per id. **`denied` ≠ `blocked`, and neither is an error**:
     denied = the tool's own scope check refused; blocked = central policy
     vetoed before execution. The UI renders both as refusals (neutral mark),
     only `error` reads as a fault.
   - `proposal {id, kind, summary, payload}` — the M4 approval card; accept /
     reject is a separate POST, never an SSE reply.
   - `done {runId, failed, error?}` — **always last, including on failure**
     (provider failures surface in-band). A stream that ends without `done`
     is a TRANSPORT failure and is rendered as such, never as success.
   - No heartbeat event; ask for SSE comments (`:ka`) if proxies need one.
3. **Upload** — confirmed signed-URL: the browser PUTs straight to Supabase
   storage with a URL core/ issues (core/ creates the part row in the same
   call, so a retried PUT is idempotent). Large bodies never enter Next.
4. **Sign-in** — web/ talks to **Supabase Auth directly** and hands core/ the
   JWT; core/ verifies and never mints. So `/api/auth/*` here wraps Supabase,
   not core/. M1 still holds: the session cookie lives in this BFF and the
   access token stays server-side.
5. **`word_timestamps`** — my assumption was wrong in a way that matters.
   Truth is **per part**, not per call: parts of one call can go down
   different lanes (Soniox returns word timings; the OpenRouter ASR fallback
   returns prose with no timestamps and no speakers), so a call can genuinely
   be half-seekable. core/ also exposes a derived `word_timestamps` on the
   call payload = true only when EVERY part has words, which is what the
   client reads today. **UI consequence, now implemented**: `rowSeekable()`
   in the call detail page gates the click and the cursor on real timing.

   **Ruled as M20** (steward, after this surfaced a collision between the M6
   wording and the backend ruling): the ladder is word → line → **span**,
   never "nothing". A prose-only transcription becomes one segment anchored
   to the audio it came from — first speech to last speech inside that part,
   measurably inset from the part boundaries — so a click seeks into real
   speech rather than into leading silence or, worse, to 0. web/ needed no
   change; the anchoring lives in the worker (Backend 2 since the package
   split), and zero-length rows are rejected at core/'s boundary
   (`InvalidTimingError`). The call-level «رونوشت با دقت کاهش‌یافته» chip is
   a quality signal and stays independent of seek mechanics.

Nothing here is wired to the UI yet: `src/api/client.ts` still serves
fixtures, so the app runs standalone until these routes exist.
