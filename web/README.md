# web/ — Echo UI + BFF (Phase A)

Next.js App Router + TypeScript strict, next-intl (**fa default** + en),
RTL-first, Vazirmatn, Persian digits and Jalali dates. Per M1, this package is
UI **and** BFF: the session lives server-side and the browser never holds a
token — so no upstream URL or key ever reaches the client bundle.

```bash
pnpm --filter @echo/web dev      # http://localhost:3000
pnpm --filter @echo/web build
pnpm --filter @echo/web typecheck
```

## Design system (ui-ux-pro-max — mandated)

Queried as a B2B SaaS / enterprise dashboard; the skill returned **"Soft UI
Evolution"** (subtle depth, clearer contrast than flat, WCAG AA+) with a
professional navy + blue-CTA palette. Applied as CSS variables in
`src/app/globals.css`, consumed through Tailwind tokens
(`tailwind.config.ts`) — so light and dark are one theme, not two.

Deliberate deviations, both documented in the files:

- **Typography**: the skill suggested Plus Jakarta Sans; we ship **Vazirmatn**
  (M9) because the product is Persian-first and Jakarta has no Persian
  coverage. Vazirmatn carries Latin too, so one family serves both scripts.
- **Dark mode is designed, not inverted**: surfaces step through the navy
  family and the accent is brightened so it keeps ≥4.5:1 on the dark
  background.

Component rules that come from the skill's checklist: 44px minimum touch
targets, focus rings restyled but never removed, status carried by a dot +
label (never color alone), 200ms transitions.

## The swap point

`src/api/client.ts` is the only place any screen gets data. Phase A serves
fixtures from `mock-data.ts`; when `core/` lands, each body becomes a fetch to
a BFF route and **no screen changes**. `src/api/types.ts` mirrors the SPEC
objects one-for-one (org · user with `pending|active|disabled` · call with
scope/status/parts · transcript rows with word timestamps, speaker, channel ·
versioned summaries · speaker directory · 3-level skills · agent runs).

The mock agent (`api.ask`) streams the way the real SSE endpoint will: tool
calls appear as they run, text arrives in chunks, and an **inferred write
comes back as a proposal** the user must approve — never applied silently.

## Screens

| Route | Notes |
|---|---|
| `/sign-in`, `/sign-up` | username+password and one-click Google |
| `/pending` | the account wall (M15) — no trial, nothing reachable |
| `/calls` | status · date · length · owner · scope, archive filter, scope toggles in place, soft-deleted rows show the 30-day purge countdown |
| `/capture` | browser recorder with live level meter + **30-minute part indicator** (M7); drag-in upload with size/duration checked **before** upload |
| `/calls/[id]` | player + speaker-labeled transcript (click-to-seek, edited marks, channel labels) + **versioned** summary above with provenance |
| `/search` | one box over transcripts and summaries |
| `/skills` | 3-level catalogue (system / org / user) with tools and `/slug` |
| `/admin` | pending-approval queue, members + roles, org settings, **model allow-list**, deleted-items restore |
| `/connectors` | gateway (v1, per-org key + webhook) above the preview catalogue |
| `/profile` | display name, avatar, interface language, personal model |

The **assistant pane** is in `AppShell`, so it is present on every screen: it
knows the page, takes call mentions as context, streams with visible tool
calls, and lists only allow-listed **tool-capable** models (no Claude in the
catalogue, per M5).

## Known Phase-A gaps (deliberate)

- Audio playback is a simulated playhead — real `<audio>` waits on signed URLs
  from `core/`.
- Sign-in does not authenticate; it routes. Auth lands with the BFF session.
- Transcript line correction and speaker linking have their UI affordances but
  post to the mock client only.
