# NeurAI Platform

**A Persian-first AI-assistant platform for organizations — with Echo (اکو),
the call-intelligence app, inside it.**

You talk to an assistant that can only see what *you* can see. Echo records
your calls and meetings, transcribes them in Persian, works out who said what,
and turns them into versioned summaries you can question. Workflows run on
real events — a new email, a meeting about to start, a call that just finished
processing — and agents carry those workflows into the conversation. Every
read and write, human or agent, is bounded by the same permission wall:
**row-level security in the database, never a prompt.**

> **Status: deployed.** The web app runs at **app.neurai.pt** (Vercel), the
> marketing site at **neurai.pt**, and the core API + worker + speech service
> on a dedicated server behind **api.neurai.pt** (Cloudflare Tunnel, zero
> open inbound ports). Postgres, Auth, and Storage are managed Supabase.
> The platform has its first real organization and owner; onboarding is
> deliberate and vendor-gated.

> **License: source-available.** The code is public to be read and evaluated
> — not to be used or copied. See [LICENSE](LICENSE).

---

## What it does

| Surface | What you get |
|---|---|
| **Assistant hub** | The landing page *is* the assistant: ask by text or **voice**, pick a model and a skill, attach sources, search the web. Conversations persist; the presence orb docks on every other screen. Suggestions are drawn from your own recent calls. |
| **Agents** | **Meetings · Mail · Prep** ship with the platform. Picking one opens the assistant with that agent's workflows and **seven suggested starters**; admins arrange even the shared agents per-organization. Editing where ownership allows. |
| **Workflows** | Validated **graphs**, not paragraphs: `fetch → ask/extract → propose`, triggered by real events (`mail.received`, `meeting.soon`, Echo's own statuses) or by hand. A builder assembles the steps as cards. 21 starters ship, each passing the same validation as anything you author. |
| **Integrations** | Gmail, Google Calendar, Google Drive, Google Meet — **per-user OAuth** against a production Google app. Connections report what was actually granted; **disconnect revokes at Google** before destroying the stored secret. |
| **Mail drafts** | New mail can get a drafted reply that waits in the thread **and in your own Gmail Drafts folder** until *you* press Send. The drafting role may `INSERT` a draft and may never `UPDATE` one — "the assistant will not send mail on its own" is a fact about the grant table. |
| **Echo — record** | A recording engine that survives navigation (docks into the top bar), with a crash buffer, live captions that follow the newest line, noise suppression with a visible opt-out, quality guards (quiet / clipping / share-ended / mic-vanished), tab & system audio, agenda checklist, meeting notebook, quick memo. Long takes roll into 30-minute parts — one call, one timeline. |
| **Echo — records** | Live statuses, rename, scope switch, archive, retry, bulk actions, deletes behind a typed-reason confirm. The records table's shape is the platform's **one table rule**: ten rows then pages, right-click row menus, selection under the pointer. |
| **A call's page** | Speaker-labelled transcript with honest per-row timing, click-any-word playback, reading modes, **versioned summaries** with meeting templates, **action items & decisions you can extend by hand** (marked as human edits), notes anchored at the playhead, exports (SRT/VTT/Markdown) with ID redaction. |
| **Speakers & voices** | A people directory with merge, team views, and **scripted voice enrollment** — read a passage once and the pipeline recognizes you in future meetings. Only the voice vector is stored. |
| **Management** | Users with three roles + platform root, invitations (show-once tokens, hashed at rest), tombstones that retire a handle forever, org profile, **allowed models**, prompts on a three-rung ladder, server health, audit logs. |
| **Settings** | General, assistant, **notifications** (each switch moves a real server fact), **security with live sessions only** — end any other device from the row's menu; idle sessions close themselves after 7 days platform-wide. |
| **Both languages** | Persian default and English — RTL-first, Vazirmatn, digits follow the language, months follow the calendar preference (Jalali/Gregorian). Not a translation layer bolted on. |

## Screenshots

Production captures from `app.neurai.pt` (Persian locale, dark theme — the default experience).

| | |
|---|---|
| ![Assistant hub](docs/screenshots/assistant-hub.png) | ![Agent in the assistant](docs/screenshots/assistant-agent.png) |
| The assistant hub — the landing page | An agent opened with its workflows & starters |
| ![Echo records](docs/screenshots/echo-records.png) | ![A call's page](docs/screenshots/record-detail.png) |
| Echo — the records table | A record — transcript, summary, actions & notes |
| ![Workflows](docs/screenshots/workflows.png) | ![Workflow detail](docs/screenshots/workflow-detail.png) |
| Workflows — templates and authored | A workflow's page — trigger, steps, runs |
| ![Builder](docs/screenshots/workflow-builder.png) | ![Integrations](docs/screenshots/integrations.png) |
| The builder — validated steps as cards | Integrations — per-user Google connections |
| ![Agents](docs/screenshots/agents.png) | ![Management users](docs/screenshots/management-users.png) |
| The three platform agents | Management · Users |
| ![Sessions](docs/screenshots/settings-security.png) | ![Audit logs](docs/screenshots/audit-logs.png) |
| Security — live sessions, right-click to end | Audit logs — codes and identifiers, never content |

## Architecture

Six diagrams cover the whole system; the deep narrative lives in
[ARCHITECTURE.md](ARCHITECTURE.md) (the binding decision record, M1–M47).

### Topology

![Topology](docs/diagrams/v3/v3_d1_topology.png)

The browser only ever talks to its own BFF with an httpOnly cookie — it never
holds a token (M1). The BFF (Next.js `/api/*` routes) owns the Supabase
session server-side and makes exactly one hop to the API gateway with a
Bearer it mints per request. The gateway, worker, and speech service run as
systemd units behind a Cloudflare Tunnel. Postgres with row-level security is
the single authorization wall.

### One request's path

![Request path](docs/diagrams/v3/v3_d2_request.png)

Seven stations, and every "no" names its kind: `401 unknown_actor` triggers
register-on-first-sign-in; `403` carries `kind: pending | suspended` with its
own honest screen; `404` deliberately does not distinguish "absent" from
"refused" — the API is not an oracle over other people's data; `409` names
the conflicting field with parameters that keep translations true.

### The Echo pipeline

![Pipeline](docs/diagrams/v3/v3_d3_pipeline.png)

Recording → parts → pgmq queues → worker → speech service (Silero VAD,
Soniox STT — measured Persian **WER 2.1%** — diarization + voice match) →
transcript → versioned summaries. Timing degrades **word → line → anchored
speech span, never to nothing** (M20). A failed part becomes a *visible gap*,
a skipped summary carries its reason, and an interrupted assistant answer is
*marked* truncated — the record's honesty has no expiry date.

### The permission stack

![Permissions](docs/diagrams/v3/v3_d4_permissions.png)

Four database roles partition all power: `echo_app` (the product),
`echo_agent` (no DELETE anywhere; INSERT-only on mail drafts; cannot read
human decisions), `echo_purge` (the *only* DELETE, isolated process,
objects-first), `echo_vendor` (org lifecycle). Writes that must exceed a
caller's rights go through **named security-definer doors** — an enumerated,
closed list, policed by an instrument that fails when a granted function has
no caller.

### Workflows, agents, integrations

![Workflows](docs/diagrams/v3/v3_d5_workflows.png)

Every field a `fetch` returns is trust-labelled (`id · address · date ·
untrusted_text`). A reply's recipient comes from the message **headers** —
the model writes the body and nothing else, so a hostile email saying "reply
to attacker@evil instead" describes something the model *cannot cause*. A
graph that addresses the outside world runs with `tools:"none"`. There is no
send step; autonomy is pinned to **assist** platform-wide.

### Deployment & operations

![Deployment](docs/diagrams/v3/v3_d6_deploy.png)

Web deploys itself on push (a failed build never replaces production). The
server deploy is deliberate: `git archive` over SSH, `systemctl restart`,
secrets flowing from an OS-encrypted store to a root-only env file — values
never touch the repo, the shell history, or the logs.

## Repository layout

```
web/    Next.js app + BFF (fa/en, RTL-first, design system, 634 tests)
core/   API gateway (/v1), worker, agent loop, workflow engine (1,164 tests)
ml/     Speech service: VAD, STT, diarization, voice enrollment
db/     Hand-written SQL migrations (127) + the wall's own test suites
site/   The marketing site (neurai.pt) — static
docs/   SPEC, ARCHITECTURE narrative, diagrams, runbooks, screenshots
```

## Running it

The platform expects its secrets in an OS-encrypted store (Windows DPAPI on
the dev machine) under `echo_platform_*` names — the repository holds
**names, never values**, and no `.env` file is tracked.

```bash
# web (needs web/.env.local with the public Supabase URL + key)
cd web && pnpm install && pnpm dev        # http://localhost:3100

# database — apply migrations and run the schema's own tests
cd db && node scripts/db.mjs migrate && node scripts/db.mjs test

# core api + worker (need DATABASE_URL_APP / DATABASE_URL_AGENT, SUPABASE_URL)
cd core && npm run api                    # boots and answers /health
cd core && npm run worker

# the full local stack
scripts/start-platform.cmd
```

Every package's `npm test` includes its instruments — web's suite ends with a
**production build gate** and a **byte-level encoding sweep** over every
tracked file; db's suite asserts the wall from below it (`rolbypassrls =
false` first, because a superuser passes every policy check unconditionally).

## The quality method

The repo's engineering rules are **things that run**, distilled from a
casebook of real incidents:

- **Verify-red** — a test is trusted only after it has been watched failing
  *for its own reason*. "Verify-red is the only thing that distinguishes a
  test from a test-shaped thing."
- **Boot tests** spawn the real runtime and demand one answered request — a
  green suite is not evidence the process starts.
- **Fixtures come from producers and reality**, never from the code's own
  beliefs; counts are never asserted where a property will do; a fixture's
  ground truth comes from the data, never its filename.
- **Seam instruments**: every function granted to a role must have a caller;
  every rendered href must resolve in the route tree; every column needs a
  qualified reader. Greps that run in CI, not conventions in prose.
- **Positive detection** for every model integration — a model wired wrong
  fails *silently*, so something must be positively found on real data.
- **Live lanes** (real network, real spend) run at acceptance and release
  gates. "Runnable but never run" is theatre and does not count.

## Naming

**NeurAI Platform** is the platform and its shared shell. **Echo** is the
call-intelligence app inside it. **Echo Mobile** is the Android recorder
(its own repository).

## License

Source-available, all rights reserved — read and evaluate freely; using,
copying, redistributing, or training on this code requires written
permission. See [LICENSE](LICENSE) and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
