# Milestone 4 — front-end close declaration (web/)

Front-end 2, 2026-08-13. The screen side of the gate; B1's declaration is the
server side. Written to be checked rather than believed — every claim below
names how it was established, and the ones that were not established say so.

## How to re-run the verification

```bash
cd web && npm test        # suite + palette pairs + PRODUCTION BUILD, in that order
cd web && npx tsc --noEmit
```

`npm test` ends with `scripts/build-gate.mjs`. Do **not** run a bare
`npx next build` in `web/`: it writes `.next`, which the shared dev server is
using, and corrupts it for whoever has the app open. The gate builds into
`.next-gate` instead — verified by sentinel, not by assumption (§8).

Counts are deliberately not written into this document — a number in prose has
to be manually synced against a fact that changes every commit, and it rots
silently. The commands print the current ones.

**Recorded measurement, with its conditions** (a dated observation, not a
number that must stay true): on 2026-08-13, `npm test` reported 20 files /
128 tests passing, ALL PAIRS PASS, and BUILD GATE PASSED, with `tsc --noEmit`
clean — FE1's and FE3's work in the same tree.

---

## 1. Live end to end — client → BFF → core/

Five client methods reach a server. **This is the honest headline of the
front-end close**: the backend is far ahead of the screens, and almost every
surface below still renders fixtures even where core/ has a proven endpoint.

| Method | Route | Notes |
|---|---|---|
| `api.audit()` | `GET /v1/admin/audit` | FE3's surface. Live with **no fixture stage** — there was never a mock to erase. |
| `api.serverHealth()` | `GET /v1/admin/server` | FE3's surface. Per-metric `measured_at`; screen-verified (§3b). |
| `api.updateProfile()` | `PATCH /v1/me` | M24 round 1. Three-state `absent`/`null`/`string` preserved end to end. |
| `api.updatePreferences()` | `PATCH /v1/me` | Calendar, timezone, locale — delegates to `updateProfile`. **Save-then-adopt, never optimistic**: the store only holds a value the server accepted, so a refusal (`calendar_unknown` / `timezone_unknown`) leaves the control showing the old value — true — with a visible line saying it was not saved. **Write only — see §1a.** |
| `api.setLocale()` | `PATCH /v1/me` | Same route; language now follows the person rather than dying with the tab. |

Established by reading `src/api/client.ts` for calls to the `bff()` helper —
and the derivation was wrong **twice**, which is why the method is written down
rather than the answer alone:

1. A first pass classified **every** method as fixture, contradicting the
   file's own comments. Discarded rather than reported.
2. A second pass missed `updatePreferences` and `setLocale`, because they reach
   the wire **indirectly** — they delegate to `updateProfile` rather than
   calling `bff()` themselves. A grep for the helper cannot see one function
   calling another.

Both were caught the same way: the result contradicted something already known.
A third apparent contradiction resolved differently — `setArchived`'s comment
says "LIVE" while its body is a fixture, because **that comment describes the
SERVER**. Same words, two different subjects. That distinction is the whole of
section 2.

### 1a. Preferences write live and read from a fixture

**`api.me()` is still a fixture**, and preferences are fields on that response.
So today:

- a preference change is **saved on the server** — the write path is live and
  the store adopts the server's returned value;
- on the next page load the shell hydrates from `ME` in `mock-data.ts`, whose
  `calendar` and `timezone` are `"auto"` — so **a saved preference appears to
  reset**.

This is stated rather than buried because the previous implementation kept the
value in `localStorage`, where it *did* survive a reload. Deleting that was
still right — a device copy beside a server copy is two sources for one fact —
but the honest consequence is that the feature is **half-connected until
`api.me()` swaps**, not finished. It closes with the rest of category 2, and
the swap is one line in a file that is not mine.

The general form, and the reason this section exists at all: **"the write is
live" and "the feature works" are different claims**, and a write path can be
verified end to end while the round trip is still broken.

## 2. Server live and proven, client still on fixtures

The endpoint exists, core/ has verified it against the real database, and the
**client body has not swapped yet**. Nothing here is broken; the swap was
sequenced deliberately after auth (FE1's call, and the right one — swapping
before `/api/auth/*` would have produced a uniformly broken app whose metric,
"mocks gone", reads as success).

- calls: list, read, transcript, summaries, speakers
- archive / unarchive (`archived_at` null → timestamp → null verified on a real row)
- soft delete / restore (M11; owner 204, idempotent 204, read-back 404, owner-restore 404-and-raises)
- members, member stats, roles, statuses
- `me`, `org`

**What this means for the gate:** the screens in this section are proven as
*screens* and unproven as *integrations*. A reviewer should read them as "the
UI is right and the wire is untested from this side", which is a different
claim from either "done" or "mocked".

## 3. No server behind it yet

Fixture-backed because the endpoint does not exist:

- gateway: keys, webhooks, deliveries (`connectors`)
- skills, models (allow-list)
- directory, search
- agent runs

### 3a. Conversations — three different states, corrected

An earlier draft filed all of this under "no server", which was wrong and
disagreed with B1's declaration. The reconciliation, checked against the route
tree rather than remembered:

| Piece | Server (B1) | BFF route | Client |
|---|---|---|---|
| ask / stream | live-proven | **exists** — `/api/assistant/ask`, a real SSE passthrough to `/v1/assistant/ask` | **not swapped** — `api.ask` is still a scripted generator |
| proposals confirm/reject | live-proven | **exists** — `/api/assistant/proposals/[id]` | not swapped |
| sessions list | live-proven | **NO BFF ROUTE** | fixture |
| thread read (messages, `truncated`) | live-proven | **NO BFF ROUTE** | fixture |

So conversations are **not** "no server": the server is live for all four, the
BFF is built for two, and the client is swapped for none. "No BFF route" is the
precise claim for sessions and thread-read, and it is a smaller gap than "no
server" — two route files, not an endpoint.

That distinction is the reason the steward's cross-check mattered: two close
documents disagreeing about the same endpoint at the gate is exactly the drift
the rest of this file is written to prevent.

### 3b. Server health — LIVE, with its screen pass outstanding

`/management/server` was listed here as unwired. FE3 wired it against
`GET /v1/admin/server` while this file was being written, including the
per-metric `measured_at` rule (null = not measured; a real zero arrives WITH a
timestamp). The menu badge and the landing card were flipped to match.

**Now screen-verified too** — fa/RTL at 1280 and 375, with the discriminating
pair read off the rendered page: `فعال ۰` (a measured zero) beside «حجم
فایل‌های صوتی —» (not measured). Those two rendering differently, side by side,
is the whole rule made visible; a `value || "—"` implementation passes every
test written against the storage row and fails exactly there.

Kept in this document because FE3 held the three claims apart while they were
apart — unit-verified, fixture-proven, screen-verified are three statements, and
"I have not looked at it" is not "it works".

The assistant mock is deliberately not a happy path: it scripts a `denied` tool
outcome, a `created: false` continue-existing session, and a proposal — so the
branches that only appear in unusual runs are exercised rather than
hypothetical.

## 4. INTERIM markers, audited

Every marker in `web/src` carrying an expiry condition, and its current state:

| Marker | Where | State |
|---|---|---|
| Client-side member search | `management/users` | **RETIRED.** Search, filters and sort are server-side query params. |
| Preferences in `localStorage` | `lib/preferences.ts` | **RETIRED, with a caveat that is not a caveat about the marker.** B1 shipped the columns and `PATCH /v1/me`; FE1 landed the web plumbing; `localStorage` is **gone, not kept as a cache**. The write is live. The READ is not, because `api.me()` is still a fixture — see §1a. |
| `/echo` redirect | `app/[locale]/echo/page.tsx` | **OPEN by design.** A stand-in for the merged Record-top/Calls-below surface, at the address that surface will occupy. |
| `EchoAppShell` | `components/echo/` | **OPEN by design.** Interim home for the pre-pivot Echo routes. |
| `User.email` narrow read | `AvatarMenu` | **RETIRED.** FE1 landed `email: string`; the identity header reads the field. |
| `AgentMessage.truncated` narrow read | `ConversationThread` | **RETIRED.** FE1 landed `truncated?: boolean`; read as `=== true`. |

No INTERIM marker in the tree is unaccounted for.

### 3d. Settings · General org fields — BFF live, client still fixture

The org form landed (FE3's `OrgFields`, dropped into the Settings slot; the
amber notice and its two copy keys deleted). **The BFF route is now correct and
live** — `GET /api/admin/org` → `/v1/org`, `PATCH` → `/v1/admin/org`, dead model
branch removed. **The client is not**: `api.org()` and `api.updateOrg()` are
still fixtures, so the form reads and writes a mock.

So the form is **screen-verified against a fixture**, which is a real and useful
claim — the save button correctly disables on load, enables on an edit, and
**disables again when the value is reverted to the loaded one** (FE1's
difference-not-touched-ness rule, visible only in the rendered artifact; a
`touched` set leaves it enabled there and sends an identical value back). It is
not a claim that the org name reaches the database.

Worth separating from §3b: among FE3's four surfaces, **Audit Logs and
Management · Server have live client bodies; the org fields do not.** All four
are screen-verified. Those are different facts about different surfaces and the
gate should not average them.

### 3c. A misdiagnosis that stood for weeks, corrected

`GeneralSettings.tsx` recorded that "`/v1/org` and `/v1/admin/org` do not exist
— both 404 for an authenticated admin", and the org fields have been read-only
behind an amber notice on the strength of it.

**The 404 was real. The conclusion was wrong.** core/ registers `GET /v1/org`
and `PATCH /v1/admin/org`, and deliberately does *not* register
`GET /v1/admin/org` — its own comment says why. Our BFF asked for the one path
core never registered and got a truthful answer, which became "the feature is
not built" in a source comment nobody re-checked.

**"No such route" and "no such feature" are different nothings**, and a 404
from our own BFF looks identical whichever it is. Found by FE3 reading the
producer instead of the note. Two further defects in the same handler: it calls
`/v1/admin/models/{id}` (never registered — org model curation is the
`allowed_models` field on the org) and sends `default_call_scope`, which is on
**no** core wire — an invented field that this panel rendered confidently. The
field is now gone from the panel; the route and the form are FE3's.

## 5. Deliberate absences — named, not missing

- **`avatar_url` is KNOWN_ABSENT.** No upload path exists, so initials *are* v1.
- **Auth screens are not photographed or demoed** — the flow cannot complete end
  to end, and a sign-in screenshot would promise something that does not work.
- **Settings · SSO and Legal** are out of v1 scope and say so in the menu, not
  after a click.
- **Management · Server and Models** are named with a `notWired` badge. Models
  reads its list and cannot save a change; its own notice says exactly that.
- **No pending-proposals inbox, ever** (ruled): outside its conversation a
  proposal loses the sentence that made it approvable.

## 5a. Three levels of "verified", kept apart

The gate should read these as three claims, not one. FE3 held them apart on
their own surfaces and the distinction is worth the whole section:

1. **Fixture-proven** — the logic is asserted against a body captured from the
   producer, so the shape is real even though the call is not.
2. **Screen-verified** — someone loaded it in a browser and measured it: RTL,
   375, hit-tests. Catches what no unit test can (a save button that changes
   its mind; a control that reads as wired and does nothing).
3. **Live-token-verified** — exercised against the real server as a real
   identity.

**Nothing in web/ is level 3.** No surface has been driven end to end against a
live token, because the auth flow cannot complete yet. Every "live" claim in
section 1 means *the client calls the BFF which calls core/* — verified by
reading the call path and by the endpoints answering, not by a signed-in human
using the feature.

That is the honest ceiling of a front-end close taken before auth, and it is
the one distinction most likely to be flattened by a summary.

## 6. What was verified, and how

Claims here were established by measuring the rendered artifact, not by reading
the source that should have produced it.

- **Breadcrumb** — parsed out of each page's own `<nav>` via `DOMParser`, never
  substring-matched, because the dev bundle embeds the whole message catalogue
  in every document. The hub rendering *no* trail is the negative case that
  proves the probe can come back empty.
- **Theme is one state across two homes** — driven from the avatar menu and
  observed in Settings · General, then driven from Settings and observed in the
  menu. Both directions, because a one-way check passes against a component
  that only ever follows.
- **Calendar/timezone preferences** — a rendered date changing, not the store
  changing. The store-only version of this check passed while the screen showed
  the old value.
- **375 recount** — no horizontal overflow, panes stacking, table scrolling
  rather than clipping, and every new control **hit-tested** (`elementsFromPoint`,
  skipping the dev overlay) rather than measured as a box.
- **Chevron (FE1's fix)** — re-measured by me rather than accepted, on the
  principle that a fix's re-measurement belongs to someone who did not watch it
  land. `padding-inline-end: 36px` resolving left in `rtl` and right in `ltr`,
  six of six selects.
- **Contrast** — `verify-pairs.mjs` asserts every foreground/background PAIR and
  the `--fg-subtle` *relationship* (group labels must measure lower than items),
  so a future "improve the label contrast" fails loudly instead of silently
  restoring the flat menu a user rejected.

## 7. Not verified, and why

- **The avatar menu's email line has not been seen in a browser.** It typechecks
  and the suite is green, but the shared dev server was returning
  `Cannot find module './6793.js'` — a stale `.next` chunk under concurrent
  compiles — when I went to look. Tested, not eyeballed.
- **No end-to-end auth run.** Section 2's surfaces cannot be exercised against
  the real wire from the browser until the client bodies swap.

## 8. The production build now gates

`next build` had been failing on the hub — `useSearchParams()` without a
Suspense boundary — while **every instrument said the app was fine**: suite
green, `tsc --noEmit` clean on the file, dev server rendering the page
perfectly. Nothing in web/ ever ran a production build, so the class was
invisible.

Fixed (a boundary above `Hub`, `fallback={null}` so the approved idle state is
not approximated by a placeholder), and mechanized: `scripts/build-gate.mjs`
runs in `pnpm test`. **Verified red on its own bug** — with the boundary
removed the gate reports `Error occurred prerendering page "/fa"`. The first
attempt at that verification failed for the *wrong* reason (an unused import),
which does not count as a red; the import came out too, and then it failed for
the right one.

It builds into `.next-gate` rather than `.next`, because the gate and the
shared dev server writing one directory corrupts the running app — observed as
a wedged build and `Cannot find module './6793.js'` 500s on every route, at the
same time, from that collision.

web/'s equivalent of core/'s `test/api-boot.test.ts`, and the same sentence
holds: a green suite is not evidence the process starts.

## 9. Instruments guarding web/

These run in the suite and fail the build; each was verified to fail on the bug
it was written for before being trusted.

- **Route reachability** — every internal href the shell renders must resolve in
  the route tree. Models the locale-aware resolver; `#` is an explicit allow
  with a reason.
- **Breadcrumb coverage** — every servable route has a trail or a stated reason,
  derived from the filesystem. Carries a negative control: asked about a route
  nobody gave a crumb, it must report it.
- **Vocabulary coverage** — every closed vocabulary core/ publishes is guarded or
  excluded *with a reason*, so a new one fails the build until someone decides.
  Two exclusions are on the record because the type is imported rather than
  copied — the missing guard is the consequence of not having a mirror, and an
  assertion there would compare a type with itself and could never fail.
- **Message-key coverage** — every referenced key exists in **both** catalogues.
  Persian-first means the default path is the one that hides the bug.
- **Palette pairs** — `verify-pairs.mjs`, in `npm test`, exits non-zero.
- **Encoding sweep** — every tracked text file, at BYTE level, for a UTF-8 BOM
  and for the cp1252 mangling of an em-dash, en-dash or curly quote (U+00E2
  followed by U+20AC). Written after `.gitignore` — the repo's secrets guard —
  was found carrying both, minutes before a push. A rule already covered the
  hazard; what the rule could not do is run. It had been widened three times
  that afternoon and still missed the file, because the sweep in use was a text
  grep and **ripgrep skips dotfiles by default** — the corruption sat in an
  unswept file the whole time and the check could not return it. This walks
  `git ls-files` and reads bytes, so nothing is skipped for being hidden.
  Verified red against a staged file carrying both signatures.

  **It then failed its own second test, in the opposite direction.** The first
  version wrote the byte sequence literally — in the needle, in its comments and
  in its failure output — so it matched itself and could NEVER pass. The
  publisher caught it running the gate before a push. **A gate that always fails
  gets waved through, which is worse than no gate, because it still looks like
  coverage** — the exact mirror of the `.gitignore` check that could only ever
  pass. Fixed by building the needle from char codes so the tool no longer
  contains its own trigger, plus an opt-out marker (`sweep-allow-mojibake`) so a
  file that legitimately *discusses* the sequence declares itself instead of
  being added to a list — otherwise every future write-up of this incident
  breaks the build for whoever is documenting the fix. **A BOM is never exempt**,
  by marker or by list: the marker is a claim about prose, a BOM is a claim about
  bytes. This document carries the marker for exactly that reason.
- **Crumb-title provider** — using the hook outside its provider throws and names
  the fix. The previous default silently swallowed writes, which is how a real
  bug hid: the page believed it had published a title, the bar believed none was
  set, and both were right from where they stood.
- **Field name/description split** — the shared `Field` rendered its `hint`
  inside the `<label>`, so the accessible NAME of every hinted control in the
  product was label-plus-hint. Fixed (hint outside, `aria-describedby`), and the
  tests assert the *exact* name rather than the hint's presence — "the hint is on
  screen" passes against the broken version, which is the entire problem. Found
  by FE1 through a failing `getByLabelText` exact match; nothing that looks at
  the screen can see this class of defect.
