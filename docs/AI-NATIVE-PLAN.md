# NeurAI — the AI-native shift: plan & software architecture

**Status: PHASES A–D BUILT AND SHIPPED (2026-08-21, user directive "start
all phases, one by one"). M33–M36 are ratified in ARCHITECTURE.md.
Pending on production: migrations 0073/0074/0075 (owner-run; core
capability-detects and degrades loudly until they land).**

**Voice-first pass (2026-08-21, user directive, same day):** the assistant
menu is removed everywhere (presence replaces it); the dock's hotkey is
**Ctrl+E**; the orb sits inset from the corner; wake words «echo / hi
echo / salam echo / سلام اکو» open the dock and auto-send the spoken
command (Web Speech API, feature-detected — Chrome-class browsers only);
a voice ask is answered out loud in its own language; mic permission is
requested on landing and a denial is announced at the orb's head; ALL
platform notices ride one bus (`web/src/lib/notify.ts`) rendered as
toasts above the orb, with a bell menu at the top bar's end holding the
history + the agent's cards.

**Deferred from Phase D, deliberately and on the record (M21 — the
forfeit said out loud):**
- **Live catch-me-up + realtime translation lane**: both need a realtime
  STT/translation PROXY through core (the browser must never hold the
  Soniox key). That proxy is its own infrastructure piece — a websocket
  lane with the key server-side — and rushing it as a rider would have
  put a vendor credential in reach of the client. Next concrete step:
  `wss://api./v1/live` terminating in core, browser sends audio frames,
  core relays to Soniox realtime and streams tokens back.
- **Wake word**: ships only as explicit per-device opt-in with a visible
  listening indicator (M34's clause). Not built yet; push-to-talk and
  browser TTS shipped instead.
- **Act auto-applying SERVER proposals** (org allow-list of kinds):
  recorded in M36 as a separate future decision.
- **Model-composed briefs/digests**: v1 signal outputs are model-free
  (M35); upgrading them to composed briefs is a spend decision.

The user selected items **1–7, 10, 15–20** of the researched twenty, plus two
overarching directives:

> *"I want the AI to be able to use the whole system — when you ask it to
> start a recording named call 1, it starts doing it. I want the AI to be
> present somewhere all the time, in the newest way possible."*

This document turns that into an architecture. The frontier patterns it
adopts (verified 2026-08-20): **frontend actions with bidirectional state
sync** (the agent reads app state and calls tools the client itself
executes — the AG-UI/CopilotKit pattern), **generative UI** (typed
interactive blocks, not prose), **variable autonomy** (Watch/Assist/Act, not
on/off), **event-driven agent runs** (agents that act on signals), and
**persistent realtime voice sessions** (push-to-talk first; wake word as an
explicit opt-in). We implement the patterns, not the frameworks — everything
rides the existing SSE wire and the existing walls.

---

## 1. The one architectural idea

Everything the user asked for reduces to three new pillars on top of what
exists. Nothing bypasses a wall; every new power maps onto an existing
security mechanism.

```
┌────────────────────────────────────────────────────────────────────┐
│  PRESENCE (P2)         the agent is always there                   │
│  persistent dock, one continuous session, page context,           │
│  push-to-talk voice — mounted in the shell on every route          │
├────────────────────────────────────────────────────────────────────┤
│  PLATFORM TOOL SURFACE (P1)   the agent can use the whole system   │
│  server tools (data)  +  CLIENT tools (UI actions run in-browser   │
│  under the user's own session)  — governed by the AUTONOMY DIAL    │
├────────────────────────────────────────────────────────────────────┤
│  SIGNALS (P3)          the agent acts without being asked          │
│  event bus + scheduler → agent runs under the owner's identity     │
│  (worker job-identity precedent), surfaced via the proactivity     │
│  channel, all runs audited in agent_run as today                   │
└────────────────────────────────────────────────────────────────────┘
```

### Why this is safe in THIS architecture

- **Client tools run as the user.** A UI action ("start recording") executes
  in the user's browser with the user's own session cookie. The agent gains
  *reach*, never *authority* — invariant 3 (agent borrows the caller's
  authority and never more) is not just preserved, it is the mechanism.
- **Write-class tools keep propose→approve.** The autonomy dial's Act mode
  widens which action classes auto-apply, per org policy, with every
  application audited — it never widens the grant (M4's rule restated).
- **Signal-triggered runs use the worker's precedent**: a job runs as the
  affected row's owner (M3), never a service account. A scheduled digest is
  a job whose owner is the subscriber.

---

## 2. Pillar P1 — the Platform Tool Surface (proposed M33)

The agent's tools split into two planes:

**Server tools** (exist today: search_transcripts, read_window, get_call,
list_related_calls + write tools as proposals). Extended over time with more
domain reads (entities, decisions, commitments).

**Client tools** (NEW): tools whose executor is the *web client*. The
runtime streams a `client_tool_call` SSE event; the browser executes the
action with the user's live session and POSTs the result back to continue
the run.

```
user: «یک ضبط به نام call 1 شروع کن»
  └─ POST /v1/assistant/ask  (page context attached: route=/echo/record)
       └─ runtime picks client tool  start_recording{title:"call 1"}
            └─ SSE  client_tool_call {id, tool:"start_recording", args}
                 └─ BROWSER executes: navigates to the recorder if needed,
                    calls api.createCall + getUserMedia through the SAME
                    code path the human button uses
                 └─ POST /v1/assistant/runs/{id}/tool-result {id, ok, detail}
            └─ runtime continues: «ضبط «call 1» شروع شد — میکروفون فعال است.»
```

Design rules (each is a proposed M33 clause):

1. **One executor per tool, declared.** A tool is server-executed or
   client-executed, never both. The registry carries `executor: "server" |
   "client"`; the client advertises which client tools this surface
   supports in the ask body (`client_tools: [...]`) — an agent must never
   call a UI tool into a surface that cannot perform it (the gateway/API
   callers advertise none).
2. **Client tools reuse the human code path.** `start_recording` calls the
   same functions the button calls. No parallel implementation — a second
   path is the boundary-fixture trap as UI.
3. **Effect classes.** Every tool declares `effect: "read" | "ui" |
   "write" | "destructive"`. The autonomy dial maps classes to behavior
   (below). `destructive` (delete/archive/finish) is ALWAYS
   approval-carded, at every dial setting, for every caller.
4. **Timeout + refusal are results.** A client tool that the user's browser
   refuses (mic denied), or that times out (tab closed mid-run), returns a
   structured refusal — the run continues and says so (M21: forfeits are
   loud).
5. **Recorded like every step.** Client tool calls land in
   `agent_run.steps` exactly like server tools — the audit sees one run.

Initial client-tool registry (v1):

| tool | effect | does |
|---|---|---|
| `navigate` | ui | goes to a route/entity (calls, a call, settings…) |
| `start_recording` | write | recorder flow with a title; returns call_id |
| `pause_recording` / `resume_recording` | ui | the recorder's own controls |
| `finish_recording` | destructive | approval-carded always |
| `open_call` | ui | opens a call's detail |
| `set_search` | ui | runs a search in the UI |
| `attach_source` | ui | attaches a call to the current conversation |
| `start_upload` | ui | opens the upload panel (file pick stays human) |

## 3. Pillar P2 — Presence (proposed M34)

**The dock.** One persistent assistant surface mounted in the platform
shell (evolving today's AssistantPane), on every route, both locales:

- **One continuous session per day** ("today's thread"), auto-resumed —
  presence means the conversation doesn't reset because the URL changed.
  (Sessions already persist; this pins one as *current* per user+day.)
- **Page context injection.** Every ask carries `context: {route,
  entity: {kind, id}}` — the current call, member, or section. The agent
  answers "summarize this" correctly because it knows where you stand. The
  context is IDs only; the server re-reads content under RLS (nothing
  trusted from the client, as with call_ids today).
- **States**: collapsed orb (idle glow — the hub-mock ruling's idle glow,
  now literal) → docked panel → full hub. The approved hub anatomy is the
  maximized state of the same object, not a different product.
- **Voice, phased**: (a) push-to-talk in the dock (dictation hook exists);
  (b) spoken replies — Persian TTS (Soniox TTS API — same vendor); (c)
  opt-in wake word, EXPLICIT per-device consent, visible listening
  indicator whenever the mic is passively open — a platform whose ethic is
  "recording pauses when nobody is looking" does not ship an always-open
  mic as a default (the recorder's own doctrine applied to ourselves);
  (d) later: a realtime speech-to-speech lane (WebRTC) when latency
  matters more than the SSE round trip.

## 4. Pillar P3 — Signals: event-driven runs (proposed M35)

A small event bus + scheduler in core (pgmq — the transport already
running):

- **Events**: `call.processed` (exists as the pipeline's end state),
  `calendar.upcoming(connector)`, `cron.weekly`, `commitment.due` (later).
- **Subscriptions**: per-user/org rules — "on call.processed → post-call
  brief", "on cron.sunday → weekly digest". Seeded system rules +
  (later, item 8 of the ten) agent-authored ones via approval.
- **Execution**: a `run_agent` queue message {rule, ownerId} → the worker
  runs the agent AS the owner (job-identity precedent, M3), writes
  `agent_run` like any run, and delivers the output to the **proactivity
  channel**: agent-initiated cards in the dock/hub with per-kind frequency
  and mute controls (the researched "proactive without intrusive" pattern
  — the controls are what separate the two).
- **Governance**: every rule enumerable on the governance dashboard; every
  firing audited; the dial's Watch mode still receives briefs (reading is
  Watch's whole point) but nothing else.

## 5. The Autonomy Dial (proposed M36) — items 7, 15, 16

Per-user setting, org-cappable (an org may cap members at Assist):

| mode | read tools | ui tools | write tools | destructive |
|---|---|---|---|---|
| **Watch** | auto | refused (suggests instead) | refused | refused |
| **Assist** (default) | auto | auto | approval card | approval card |
| **Act** | auto | auto | auto for org-approved classes, audited | approval card |

- Act's "approved classes" are org configuration (admin-set allow-list of
  proposal kinds), never a model choice — the dial widens *policy*, the
  grant never moves (M4 restated).
- **Show-the-reasoning (16)**: every dock answer expands to its trace —
  tools called, sources read, refusals — rendered from `agent_run.steps`
  (stored today, surfaced tomorrow).
- **Governance dashboard (15)**: org admin surface over `agent_run` +
  rules + approvals: runs, spend (tokens_in/out exist), approval rates,
  per-member activity, per-kind mutes. Codes and counts, never content.
- **ROI telemetry (20)**: derived from the same tables — follow-ups
  completed, briefs read, actions approved; rendered for admins ("hours
  saved" stated as the honest proxy it is).

## 6. Item mapping

| # | item | lands on |
|---|---|---|
| 1 | own the follow-through | P3 rule on call.processed → brief + drafts (write-class → dial) |
| 2 | live translation lane | recorder + Soniox realtime translate; subtitle lane in the recorder UI; spoken later with TTS |
| 3 | bot-less capture doctrine | positioning + P2 orb copy; already true technically |
| 4 | ask-during-meeting | P2 dock open during recording; page context = the live call |
| 5 | catch-me-up | client tool `catch_me_up` over the live transcript buffer |
| 6 | generative UI answers | new SSE `block` event: typed components (timeline, table, checklist) rendered in-thread; checklist items → tracked via proposals |
| 7 | autonomy dial | M36 |
| 10 | ⌘K everywhere | thin launcher over the SAME ask wire + client tools; ⌘K = focus the dock with intent mode |
| 15 | governance dashboard | §5 |
| 16 | show-the-reasoning | §5 |
| 17 | event-driven runs | P3 / M35 |
| 18 | speech both directions | P2 voice phases (b)+(d) |
| 19 | one capture fabric | recorder (done: pause/resume model) + Echo Mobile + later tray app; presence dock is the shared brain |
| 20 | ROI telemetry | §5 |

## 7. Schema & wire additions (sketch — B-lane refines)

- `app_user.autonomy` (`watch|assist|act`, default assist) +
  `org.autonomy_ceiling` + `org.act_allowed_kinds jsonb` (0073+)
- `echo.agent_rule` (id, org_id, owner_id, event, config, enabled,
  created_by — the P3 subscriptions; composite FKs per D9)
- `echo.agent_card` (the proactivity channel's items: kind, run_id link,
  read_at, muted-kind prefs on app_user) — codes + refs, content stays in
  the run/session
- SSE union grows: `client_tool_call`, `block`, (`session` etc. unchanged)
- `POST /v1/assistant/runs/:id/tool-result` (client executor's return path)
- ask body grows: `client_tools: string[]`, `context: {route, entity}`
- pgmq: `echo_agent_rules` queue; scheduler tick in the worker

## 8. Build phases

**Phase A — the agent gets hands + a home (the demo: "start a recording
named call 1")**
1. M33 tool surface: registry with executor+effect; `client_tool_call`
   SSE + tool-result route; client executor in the dock.
2. Client tools v1: navigate, start/pause/resume_recording, open_call,
   set_search. Finish stays carded.
3. Presence dock v1: shell-mounted, continuous daily session, page
   context, collapsed orb ↔ panel. ⌘K focuses it.
4. Autonomy dial Watch/Assist (Act ships with governance in C).

**Phase B — the agent acts on signals**
5. M35 bus + scheduler; rules: post-call brief, weekly digest.
6. Proactivity cards + mute/frequency controls.
7. Follow-through pack: brief → draft follow-up → commitments as
   proposals.

**Phase C — trust made visible**
8. Reasoning trace expander (steps → UI).
9. Governance dashboard + ROI telemetry.
10. Act mode + org allow-list of kinds.

**Phase D — voice & the live meeting**
11. Persian TTS replies; push-to-talk polish.
12. Live transcript buffer in the recorder → catch-me-up + ask-during.
13. Soniox realtime translation subtitle lane.
14. Generative blocks (timeline/table/checklist).
15. (flagged, opt-in, per-device) wake word; realtime speech lane.

Each phase ends the repo's way: tests green, live-proven at acceptance,
runbook updated, pushed.

## 9. What this does NOT change

- RLS + grants stay the wall; the agent's DB role gains nothing.
- No pending-proposals inbox (M4): approval cards live in the
  conversation; the proactivity channel carries agent-INITIATED cards,
  never pending approvals.
- Content never in logs; cards/rules/telemetry are codes and counts.
- The vendor/platform-root planes are untouched; agent rules are org
  configuration.
