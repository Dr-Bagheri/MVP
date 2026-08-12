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

## Proposed core/ routes (please confirm or override)

| BFF handler | → core/ | Notes |
|---|---|---|
| `GET /api/calls?archived=` | `GET /v1/calls` | visibility is RLS's job, not a BFF filter |
| `GET /api/calls/:id` | `GET /v1/calls/:id` | |
| `PATCH /api/calls/:id` | `PATCH /v1/calls/:id` | `{scope?, archived?}` |
| `DELETE /api/calls/:id` | `DELETE /v1/calls/:id` | soft delete, 30-day window (M11) |
| `GET /api/calls/:id/transcript` | `GET /v1/calls/:id/transcript` | rows + `word_timestamps` flag (M6) |
| `PATCH /api/calls/:id/transcript/:rowId` | same | line correction keeps row identity |
| `GET /api/calls/:id/speakers` | `GET /v1/calls/:id/speakers` | |
| `PATCH /api/calls/:id/speakers/:speakerId` | same | rename / link — owner's deliberate act (M11) |
| `GET /api/calls/:id/summaries` | `GET /v1/calls/:id/summaries` | all versions; pointer is `current` |
| `POST /api/search` | `POST /v1/search` | returns offsets, not content (M8) |
| `GET /api/models` | `GET /v1/models` | catalogue ∩ org allow-list, tool-capable only |
| `GET/PATCH /api/admin/members` | `/v1/admin/members` | pending queue + role/status |
| `GET/PATCH /api/admin/org` | `/v1/admin/org` | |
| `GET /api/skills` | `GET /v1/skills` | resolved 3 levels, most specific wins |
| `GET/POST /api/gateway` | `/v1/gateway` | per-org key + webhook (M17) |
| `POST /api/assistant/ask` | `POST /v1/assistant/ask` | **SSE passthrough**, unbuffered |

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
