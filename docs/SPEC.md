# Echo (اکو) — Product Specification (source of truth for WHAT we build)

> Cleaned and structured from the founding spec (2026-08-10). ARCHITECTURE.md
> holds the HOW. Where this document and ARCHITECTURE.md conflict, this one
> wins on product behavior, ARCHITECTURE.md wins on technical shape.

## What it is

The system records or ingests business calls/meetings, transcribes them, and
keeps them as a searchable body of knowledge. An AI agent sits at the core,
connected to an organizational second-brain knowledge base, and does the
open-ended work: summarizing, answering questions, comparing calls, and
correcting the record. The interface supports Persian. Each organization's
data is kept separate from every other organization's.

## Who uses it

- **Member** — an employee who takes calls/meetings. They own their own calls,
  which are **private by default**.
- **Admin** — provisions people, sets organization defaults and skills, and can
  **read** every call in the organization.

Only these two roles. Only two scopes: a call belongs either to its **owner
(private)** or to **everyone in the organization (org)**.

## The objects

| Object | What it is |
|---|---|
| **Call** | One recording. Owner, scope, status, audio, duration. |
| **Transcript** | The text of the call: timestamped utterances with a speaker and a channel. **This is the record** — everything else is derived from it. |
| **Summary** | Agent-written prose about the call. **Versioned** — a new one never destroys the old. |
| **Speaker** | A voice in a recording. Can be linked to a person in the organization's directory, so the name follows them across calls. |
| **Skill** | A named thing the agent knows how to do: a prompt, the tools it may use, and a model. **Stored as data.** |
| **Agent run** | The record of one agent execution: prompt, model, every tool call, tokens, outcome. |

## How work gets done

Work splits in two:

- **Hand-written code** does anything with a fixed shape: signing in, listing
  calls, checking processing status, moving audio through the pipeline, admin
  CRUD, and enforcing who may see what. **No model is involved in any of it.**
- **An agent** does anything open-ended: writing a summary, answering a
  question, finding something across many calls, drafting text, deciding what
  context it needs. It works by calling tools: search transcripts, read a
  window of one, fetch a call, correct a transcript, edit speakers, replace a
  summary. **The agent runs as the user who asked, with their permissions and
  no more.** It cannot see a call that user could not open, and every tool
  re-checks this on the server. **One agent runtime serves both situations**:
  the assistant a user talks to, and the summarizer the pipeline invokes.

## The core loop

1. **Capture** — record in the browser, or upload a file.
2. **Process** — transcode → transcribe → split into speakers → summarize
   (by the summarizer agent). Step-by-step progress indicator.
3. **Read** — audio player beside the transcript, speaker by speaker, summary
   above. Clicking a line seeks the audio.
4. **Work on it with the agent** — ask questions, search across calls, have
   the agent correct what it finds wrong.

## Features

### Calls
List with status, date, length, owner, scope; filterable by archive state.
Scope switchable between private and org, effective immediately. Archiving
hides a call; deleting removes it. **Admins may delete any recording,
including members' private ones; members delete only their own** (human
actions, always logged — the agent can never delete).

### Capture
Browser recording with a live input-level meter. Drag-in file upload with
progress and server-side transcoding to the pipeline format (any audio format
accepted). Size and duration limits checked **before** upload. **Sessions
longer than 30 minutes auto-split into 30-minute parts** — separate audio
files under ONE call with ONE title and a continuous timeline.

### Transcript
Timestamped turns with speaker labels. Click a line → seek audio; auto-scroll
follows playback. Two-channel recordings take speakers from the channels;
single-channel recordings are diarized into Speaker 1/2/3 by voice clustering.
The organization has a **speaker directory**: name a voice once, link it to a
person, and the name applies to every line that voice speaks. Duplicates can be
merged; a short voice snippet plays for identification. Individual lines can be
corrected; a corrected line keeps its identity and is marked as edited.

### Summary
Produced automatically when processing finishes, by an agent **with search
tools** — it reads earlier calls with the same people or subject before it
writes ("this is the fourth conversation about the same contract"). With
nothing prior, it writes from the transcript alone. Summaries are versioned:
replacing one adds a new version and moves the pointer.

### Search
One search box over transcripts and summaries, filtered to what the user may
see.

### The assistant
A dockable pane on every screen. Knows which page you're on; you can mention a
specific call to add it as context. Sessions persist. Answers stream; tool
calls are shown as they run. **Each user picks their own model from a live
catalogue; models that cannot call tools are not selectable.**

### Skills
Three levels: **system** skills shipped with the product (the summarizer is
one), **organization** skills an admin sets, **user** skills an individual
saves. Most specific wins. Catalogue entries like: Call recap, Action items,
Objection finder, Pricing mentions, Talk ratio, Pre-call brief. Invocable as
`/skill-name`.

### Sign-up & access
Anyone can create an account — username + password, or one-click Google
sign-up — but the account is **pending until an admin accepts it**; nothing is
accessible before acceptance. No trials.

### Settings & admin
Profile: display name, avatar, interface language. Admins: members list
(including pending-approval queue), role assignment, organization-level
settings.

### Connectors & API gateway
A catalogue screen for future integrations (chat, CRM, documents, calendar,
storage) — preview in v1. **Wired in v1: the public API gateway** — per-org
API keys and webhooks so any platform can push audio in and pull results out,
under the same permission wall.

## What the agent may and may not change

Three write tools: correct a transcript, edit the speaker roster, replace a
summary. Limits enforced by the **system**, not by prompts:

- Writes only to the **caller's own calls**. An admin who can read every call
  still cannot rewrite one they don't own.
- **Nothing the agent can call deletes anything.** The database role it runs
  under has no delete permission on calls, transcripts, or summaries.
- A summary edit adds a version. A corrected line keeps its identifier. A
  roster edit is a change-list, not a wholesale replacement.
- The agent **proposes before writing** anything it inferred rather than was
  told. Once a write lands, the viewed page refreshes itself.

## Future (designed-for, not built in v1)

- **Projects**: calls, documents, people grouped by account/deal/customer;
  scope and retrieval follow the project.
- **A wiki per project**: living documents the agent reads before working and
  updates after; humans can read and correct.
- **Retrieval across everything** a user is exposed to (documents, notes),
  under the same permission boundary.
- **Connectors** wired for real.

## Explicitly not built (v1)

Native desktop capture · SSO · compliance suite (disclosure, retention, audit
exports, data-subject deletion) · team and manager roles · agent long-term
memory · code execution · rate limiting and device-token revocation.

## Invariants (product-level)

1. The transcript is the source of truth; everything else is derived and
   rebuildable.
2. No database access without a user identity attached.
3. The agent holds no authority of its own; instructions never come from data.
4. Everything derived records what produced it; version stamps cannot be
   backfilled.
5. Agent runs are replayable.
6. `ml/` knows nothing about the product: no database, no identity, no product
   credentials — only its own upstream API key.
