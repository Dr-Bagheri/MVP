# -*- coding: utf-8 -*-
"""
The architecture document's prose. Blocks:
  ('h2'|'h3', text) ('p', text) ('ul', [items]) ('num', [items])
  ('table', [headers], [[cells]], [widths]) ('fig', name, caption)
  ('screen', name, caption) ('note', text)

Every number in here was measured on 2026-09-08 against the running system or
the tree, and the measurement is named where it is given. A number without its
conditions is a number that rots.
"""

TITLE = "NeurAI Platform"
SUBTITLE = "System architecture, component choices, and the agentic layer"
STAMP = "Measured against production and the repository on 8 September 2026"

CHAPTERS = [

# ─────────────────────────────────────────────────────────────────────────
("What this platform is", [
 ('p', "NeurAI is a Persian-first work platform with an AI layer that is part of the "
       "product rather than a feature bolted onto it. People run their meetings, tasks, "
       "projects and team conversations here; the platform listens where it is asked to, "
       "turns what was said into a record that can be searched and cited, and puts three "
       "agents beside that record who can read it and act on the surfaces the person "
       "already uses."),
 ('p', "Two commitments shape every decision in this document. The first is that the "
       "product is Persian-first: right-to-left, Jalali-capable, Persian digits, and one "
       "language per screen — with a full English mirror. The second is that authority is "
       "enforced by the database, not by prompts. An agent in this system borrows the "
       "authority of the person it is working for and can never exceed it, because the "
       "connection it uses is a database role whose grants say so."),
 ('h2', "What is running today"),
 ('p', "The figures below were read from the production database and the running services "
       "on 8 September 2026. They describe one organisation using the platform daily; "
       "they are a snapshot of a live deployment, not a benchmark."),
 ('table',
  ["Area", "Live today"],
  [["Organisations / members", "2 orgs · 14 accounts (12 active) · 3 roles"],
   ["Recordings", "42 calls · 102 parts · 2,395 transcript lines"],
   ["Agents", "Echo plus 2 colleague seats (Roya, Ava) — 607 agent runs, 580 completed"],
   ["Assistant", "199 conversations · 814 messages"],
   ["Work", "Meetings, task board, projects, 12 team rooms, 6 workflows"],
   ["Connections", "13 on the shelf, 6 connected — Google (Gmail, Calendar, Drive, Meet), "
                   "Slack, Zoom; 7 waiting"],
   ["Schema", "207 migrations · 67 tables · 177 row-level policies · 114 functions"],
   ["Services", "api · worker · speech · 4 voice services · nightly purge timer"]],
  [1.6, 4.6]),
 ('note', "Two figures deliberately absent: uptime and cost. Neither has been measured over "
          "a period long enough to state honestly."),
]),

# ─────────────────────────────────────────────────────────────────────────
("The shape: four packages, three planes", [
 ('p', "The system is four packages in one repository and three planes at runtime. The "
       "packages are drawn along the lines where a mistake would be most expensive: the "
       "interface cannot reach the database, the speech service knows nothing about the "
       "product, and every rule about who may see what lives in SQL."),
 ('table',
  ["Package", "What it is", "Size", "Where it runs"],
  [["web/", "Next.js interface plus the BFF that holds the session",
    "442 files · 74,516 lines", "Vercel (Frankfurt)"],
   ["core/", "Fastify API, the pipeline worker, the agent runtime, the workflow engine",
    "90 files · 39,638 lines", "Hetzner (systemd)"],
   ["ml/", "Speech service: decode, detect speech, transcribe, diarize, embed, translate",
    "25 files · 3,475 lines", "Hetzner (loopback only)"],
   ["db/", "Numbered SQL migrations and the standing policy tests",
    "207 migrations · 22,389 lines", "Supabase Postgres 17.6"]],
  [0.85, 3.0, 1.35, 1.3]),
 ('p', "The three planes are the control plane (a person's request, carrying their "
       "identity), the data plane (rows, objects and the permission wall), and the media "
       "plane (audio and video, which never travel through the API — the browser talks to "
       "storage and to the room service directly, using short-lived credentials the server "
       "mints)."),
 ('fig', 'topology', "Runtime and deployment topology, as deployed on 8 September 2026."),
 ('h2', "Why the speech service is separate"),
 ('p', "ml/ has no idea what a meeting is. It receives audio and returns words, speech "
       "regions, speaker clusters and vectors. That boundary is what lets the speech stack "
       "be measured, replaced and re-measured — the voiceprint model was swapped on "
       "7 September without a single change to the product — and it is also what keeps "
       "biometric data on the organisation's own machine."),
]),

# ─────────────────────────────────────────────────────────────────────────
("How a request is authorized", [
 ('p', "This is the part of the system that is worth reading twice, because everything the "
       "product promises about privacy rests on it."),
 ('fig', 'request', "One request, from the browser to a permitted row."),
 ('num', [
   "The browser holds no token. It sends a session cookie it cannot read to the BFF that "
   "runs beside the interface.",
   "The BFF exchanges that session for a signed identity and calls the platform API. "
   "Provider secrets never exist in code the browser downloads.",
   "The API verifies the token's signature against the identity provider's public keys "
   "(ES256/JWKS) and resolves the actor: which person, which organisation, and whether "
   "either is active.",
   "It opens a transaction, sets the database ROLE for the caller's kind and the actor id "
   "as a transaction-local setting. There is no anonymous database handle in the product.",
   "The query runs. Row-level security — forced on all 67 tables — decides what the "
   "statement may see or write, using that actor.",
   "The result is either the permitted rows or a named refusal. Logs record codes and "
   "identifiers; they never record content.",
 ]),
 ('h2', "Four roles, and what each may do"),
 ('table',
  ["Role", "Used by", "Notably"],
  [["echo_app", "Every human request", "Full product surface within row-level policy"],
   ["echo_agent", "Every agent run", "No DELETE grant anywhere in the schema"],
   ["echo_purge", "The nightly retention job", "The only role that may erase, and it can do nothing else"],
   ["echo_vendor", "Platform operator (control plane)", "Tenant lifecycle only; never reads content"]],
  [1.15, 1.9, 3.15]),
 ('p', "The agent's row deserves a sentence of its own. \"The assistant will not delete your "
       "work\" is not a policy in a prompt that a cleverly-worded message might talk its way "
       "around — it is a missing grant. When an agent needs to do something destructive, it "
       "proposes it and a person performs it from their own session, under their own "
       "authority, having read a card that names the thing being deleted."),
 ('h2', "Doors, not exceptions"),
 ('p', "Some operations legitimately need more power than the caller's policy allows — "
       "soft-deleting a call so the owner can still see the deletion, accepting a new member "
       "into an organisation, reading whether a meeting's recording has finished. Each one is "
       "a named SQL function with a fixed return shape, enumerated with its reason. A "
       "security surface that is a SHAPE cannot be widened by forgetting a filter, and the "
       "list of doors is short enough to read in a minute."),
]),

# ─────────────────────────────────────────────────────────────────────────
("From a conversation to a record", [
 ('p', "A meeting can be recorded in the room the platform hosts, from a microphone in a "
       "physical room, or uploaded after the fact. What comes out is not a file — it is a "
       "record with a timeline, named voices, a summary that carries its provenance, and "
       "minutes with a lifecycle."),
 ('fig', 'pipeline', "A recording becomes a citable record."),
 ('h2', "Capture"),
 ('p', "Long recordings are cut into parts with timeline offsets, uploaded as they are made, "
       "and each part is queued the moment it lands. A browser tab that dies mid-meeting "
       "still leaves the meeting pointing at everything captured up to that second."),
 ('h2', "Speech"),
 ('p', "Each part is decoded to one shape, scanned for speech, and only the speech is sent "
       "to the transcriber. Two lanes are configured — a primary provider and a fallback — "
       "and each lane names its own ceiling, so a five-hour upload is refused only if no "
       "usable lane can take it. The audio is read as a stream rather than loaded whole, "
       "which is what makes a five-hour file possible on a machine with four gigabytes."),
 ('table',
  ["Measurement", "Result", "Conditions"],
  [["Persian word error rate", "2.1%",
    "13 Aug 2026 · a real device recording · corrected reference · post-normalisation"],
   ["Voice match, same person across two microphones", "0.577 – 0.627",
    "7 Sep 2026 · through the product's own /embed · ERes2NetV2"],
   ["Voice match, a different person", "0.19 – 0.30", "same run · threshold sits at 0.50"],
   ["Speech detection", "Local, CPU, well under real time",
    "Silero VAD v5 · reports measured speech, not duration"]],
  [1.85, 1.5, 2.85]),
 ('h2', "Timing degrades, it never disappears"),
 ('p', "Word-level timings are the best case. When a provider returns none, the record falls "
       "back to line timings; when it returns nothing usable, it falls back to a single "
       "anchored speech span for the part. What it never does is claim a precision it does "
       "not have — a transcript that cannot be clicked is honest; one that seeks to the "
       "wrong second is not."),
 ('h2', "Who was speaking"),
 ('p', "Diarization separates voices within each part. Matching a voice to a person is a "
       "second, deliberately conservative step: only people who have enrolled a voiceprint "
       "are candidates, because in this product enrolling IS the consent to be recognised. "
       "Enrolment keeps every take rather than averaging them, and a match scores against the "
       "best one — the average of a headset recording and a room recording is a point that is "
       "neither."),
 ('p', "When the machine will not commit, a person decides. On the transcript, the host can "
       "press a voice's name and choose from the people who were in that meeting; the answer "
       "renames every turn that voice took, and the platform remembers the pairing so it does "
       "not ask again."),
 ('screen', 'record-transcript',
  "The transcript of a real 18-minute management meeting: named voices, timestamps, "
  "click-to-seek, and a speaker filter."),
 ('screen', 'record-summary',
  "The same record's summary — sectioned, in Persian, with the version it came from."),
]),

# ─────────────────────────────────────────────────────────────────────────
("The agentic layer", [
 ('p', "Three agents work inside the platform. Echo is the one that answers by default. "
       "Roya is the operational colleague — meetings, agendas, tasks, projects. Ava is the "
       "analytical one — records, versions, evidence. They are not personas painted on one "
       "model: each has a seat in the organisation, its own stored instructions, its own "
       "page listing exactly what it can do, and its own line in the audit log."),
 ('fig', 'agents', "Who answers, what they may touch, and where a human stands in the path."),
 ('h2', "Who answers a turn"),
 ('p', "Naming an agent gives it the floor and it keeps answering until another name is said "
       "or the person presses the × on the chip. Two names in one message means both answer, "
       "in the order they were addressed. Nobody named means Echo. This is one rule in one "
       "place, and the floor is stored with the conversation so a reload does not lose it."),
 ('h2', "Reach is the person's reach"),
 ('p', "Every agent carries a map of the platform and one rule about access: your reach is "
       "the reach of the person you are working for. An agent never says \"I don't have "
       "access\" — either the person can do the thing, in which case so can the agent on "
       "their behalf, or they cannot, in which case the refusal names whose role would be "
       "needed. Because the wall is the database, this is safe to promise."),
 ('h2', "Two kinds of hands"),
 ('table',
  ["Kind", "Count", "Runs where", "Wall"],
  [["Server-side reads", "5",
    "In the API, on the agent's own database role",
    "Read-only by construction; a delegate holds nothing else"],
   ["Client tools ('hands')", "97",
    "In the person's own browser, through the same API a button uses",
    "A consent card names the object; nothing runs on a silent yes"]],
  [1.5, 0.7, 2.2, 2.4]),
 ('p', "The split is the design. A read can happen quietly because the reader is already "
       "entitled to the row. An action that changes something happens in the person's "
       "session, with their authority, after they have seen a card that names not just the "
       "verb but the object — «delete the task “budget review”», not «delete task». A card "
       "that names the verb and not the object collects a yes to anything."),
 ('p', "A person who is tired of answering can grant a yes for the whole session, and that "
       "grant deliberately does not cover the classes where a mistake is not recoverable or "
       "leaves the building: deletions, messages, invitations, revocations, role and "
       "permission changes, record scope, approved minutes, shared conversations and the "
       "model list."),
 ('h2', "Delegation"),
 ('p', "Echo can hand work to a colleague — and does, when a request is more than three "
       "separate pieces of work or when the person asks for them by name. A delegated run is "
       "a full run with the same tools and the same consent rules, and its answer comes back "
       "attributed. Agents may also answer each other in a team room, with a four-hop ceiling: "
       "two agents naming each other never stop on their own, and the first anybody would know "
       "is the bill."),
 ('screen', 'agent-roya',
  "An agent's own page: every capability it holds, grouped and counted, in the person's "
  "language."),
 ('h2', "Work that runs without being asked"),
 ('p', "Workflows are versioned graphs with triggers, waits and approvals. The two shipped "
       "ones are the honest examples: a meeting brief that arrives before the meeting, and a "
       "reply drafted for new mail that waits in the person's own Drafts folder until they "
       "press send. The wall there is a grant as well — the agent role may insert a draft and "
       "may never update one, so \"it will not send mail by itself\" is a fact about the "
       "database."),
 ('screen', 'workflows', "The workflow shelf: shipped starters, installed workflows, versions and state."),
]),

# ─────────────────────────────────────────────────────────────────────────
("What an agentic platform actually buys you", [
 ('p', "The case for putting agents inside a work platform rather than beside it is not that "
       "a model can write text. It is that the three things which normally leak out of an "
       "organisation — what was said, what was decided, and who owes what — can be captured, "
       "connected and acted on in one place, with the same permissions."),
 ('h3', "1. The meeting stops being a memory test"),
 ('p', "A recorded meeting becomes a transcript with named voices, a sectioned summary, "
       "minutes with an approval lifecycle, and tasks that carry names and dates. Nobody has "
       "to write any of that down while also taking part in the conversation."),
 ('h3', "2. Retrieval that respects the wall"),
 ('p', "Asking «what did we decide about the audio database?» searches transcripts, "
       "summaries and notes under the asker's own permissions. The answer cites the record it "
       "came from. A retrieval layer that ignored permissions would be a data leak with a "
       "chat interface."),
 ('h3', "3. Work is filed where work lives"),
 ('p', "The agent does not hand back a list of suggested tasks for somebody to re-type. It "
       "creates the cards on the board, in the right folder or project, assigned to real "
       "colleagues resolved from the member directory — each one behind a consent card the "
       "person actually reads."),
 ('h3', "4. Routine correspondence becomes review instead of authorship"),
 ('p', "A drafted reply is a decision to approve rather than a blank page to fill. The "
       "recipient, subject and thread come from the original message's headers — never from "
       "the model — so \"reply to someone else instead\" describes something the system "
       "cannot do."),
 ('h3', "5. One assistant, many surfaces"),
 ('p', "The same assistant is docked on every screen and knows which screen it is on. It can "
       "open a meeting, move a card, rename a voice or start a recording — the same "
       "operations the buttons perform, through the same API, under the same permissions."),
 ('h2', "What it does not do"),
 ('ul', [
   "It does not act while nobody is watching, except where a workflow was switched on "
   "deliberately and its effects are bounded.",
   "It does not delete. The role it runs as holds no DELETE grant anywhere.",
   "It does not see more than the person it works for, in any surface, including search.",
   "It does not name a voice it is not confident about — it says the voice is unnamed and "
   "offers the people who were in the room.",
   "It does not send mail, messages or invitations on a standing permission.",
 ]),
]),

# ─────────────────────────────────────────────────────────────────────────
("The surfaces, one by one", [
 ('p', "Twelve places in the rail, each with a job. Every screenshot in this chapter was "
       "taken on production on 8 September 2026, signed in as the organisation's owner."),
 ('h3', "Dashboard"),
 ('p', "The first screen: a greeting, four counters, the week as an hour grid, upcoming and "
       "recent meetings. The assistant column is docked on the left of every surface — closed "
       "means a place, not an absence."),
 ('screen', 'dashboard', "Dashboard, with the assistant docked beside it."),
 ('h3', "Assistant"),
 ('p', "The full-width conversation: history, the floor chip when a colleague has been named, "
       "consent cards where a write is proposed, and push-to-talk dictation on a bound key."),
 ('screen', 'assistant', "The assistant's own surface with its opening suggestions."),
 ('h3', "Meetings and the record"),
 ('p', "A meeting moves through three stages — before, during, after. The live stage carries "
       "the recorder, a shared whiteboard, the video room and the presentation; the stage is "
       "the host's, and every other attendee follows what the host does. Afterwards the same "
       "page shows the record: transcript, decisions and actions, files, minutes, notes, and "
       "an assistant scoped to that meeting."),
 ('screen', 'meetings', "The meetings list — this organisation had archived its test meetings "
                        "at the time of capture."),
 ('h3', "Tasks and projects"),
 ('p', "One board, four views (kanban, list, calendar, archive), folders that a project may "
       "own, labels as organisation-level entities, repeating work triggered by completion "
       "rather than by a clock, and an append-only event log for who moved what."),
 ('screen', 'tasks', "The task board: columns, folders, priority, assignee and deadline."),
 ('h3', "Team chat"),
 ('p', "Rooms for the humans, where the agents are guests: an agent answers when it is named "
       "or replied to, never ambiently, and in a room it holds only the tools whose rows every "
       "member can already read."),
 ('screen', 'chat', "The chat surface (this organisation had archived its rooms)."),
 ('h3', "Integrations"),
 ('p', "One tile per connector, the provider's own mark, and the status said plainly. A "
       "connector that the deployment has not configured says so rather than offering a button "
       "that fails."),
 ('screen', 'integrations', "Thirteen connectors, six of them connected on this deployment: "
                            "four Google surfaces, Slack and Zoom."),
 ('h3', "Agents"),
 ('screen', 'agents', "The agent catalogue: Roya and Ava, each with the sentence that says "
                      "what it is for."),
 ('h3', "Management"),
 ('p', "People, invitations, role privileges, the speaker directory, allowed models, and "
       "service health. Agents appear in the member list with seats of their own, which is "
       "what makes their actions attributable."),
 ('screen', 'users', "Members and agent seats, with roles."),
 ('screen', 'speakers', "The speaker directory — who has enrolled a voice, and how many takes."),
 ('screen', 'models', "The allowed-model list an owner curates. Anthropic models are excluded "
                      "by a product rule applied at every rung."),
 ('screen', 'server', "Service health: the six queues, with pending, retrying and archived counts."),
 ('h3', "Audit"),
 ('p', "Three sources in one feed — administrative actions, human decisions on agent "
       "proposals, and agent runs with their model, skill and token counts. Codes and "
       "identifiers, never content."),
 ('screen', 'audit', "The audit log, filtered by source."),
 ('h3', "Settings and help"),
 ('screen', 'settings-general', "Settings: theme, calendar and timezone — the two axes are "
                                "digits with the language, months with the calendar."),
 ('screen', 'help', "Help, written in the rail's own order, checked line by line against the "
                    "screens it describes."),
]),

# ─────────────────────────────────────────────────────────────────────────
("Connections to the outside", [
 ('p', "Connectors are a registry rather than ten integrations. One definition per provider "
       "describes its kind (an OAuth dance or a pasted token), its scopes, what it can read "
       "and what it can do; the repository is generic over that definition, so a new provider "
       "is a data entry rather than a new code path."),
 ('fig', 'connectors', "The connector registry and the two shapes of credential."),
 ('table',
  ["Provider", "What it gives", "State on 8 Sep 2026"],
  [["Google — Gmail, Calendar, Drive, Meet", "Mail and drafts, events, files, meeting links",
    "Connected"],
   ["Slack", "Channels, history, and sending a message as the person", "Connected"],
   ["Zoom", "Creating and reading meetings", "Connected"],
   ["Jira · Notion · GitHub · Dropbox", "Issues, pages, files",
    "OAuth app configured; nobody has connected one yet"],
   ["Telegram · WhatsApp Business", "Sending a message from a bot the org owns",
    "A pasted token — nothing to configure on the server"],
   ["MCP (any server)", "Any tool a Model Context Protocol server exposes",
    "Open door; never covered by a standing yes"]],
  [2.1, 2.5, 1.6]),
 ('p', "Two rules make this safe. A connection belongs to the PERSON who granted it, not to "
       "the organisation, so an agent reaches exactly the mailbox its owner reached. And "
       "every action a connector exposes is a client tool with a consent card — sending a "
       "Slack message is a decision, not a side effect."),
]),

# ─────────────────────────────────────────────────────────────────────────
("The rules that run", [
 ('p', "This codebase treats a rule that only lives in prose as a rule that protects whoever "
       "happens to remember it. The important ones are executable."),
 ('table',
  ["What runs", "What it protects"],
  [["2,921 tests in web, core and ml", "Behaviour, in the units where it is decided"],
   ["65 SQL test files against the live catalogue", "Policies, grants and refusals, both directions"],
   ["Migration self-checks", "Every migration proves its own claim before it commits"],
   ["Guard tests (control sizes, surfaces, copy, icons, keys, RTL)",
    "The design system, and the classes of defect that read as correct"],
   ["Boot tests under the production runtime", "That each service starts and answers one request"],
   ["Encoding sweep over every tracked text file", "Byte-level corruption that survives a visual check"],
   ["Build gate", "That a change which breaks the production build cannot stay green"],
   ["Contrast verifier", "That a theme change cannot ship an unreadable pair"]],
  [3.0, 3.2]),
 ('h2', "Verify-red"),
 ('p', "A test is only trusted here after it has been made to fail for its own reason. The "
       "practice has a name in the repository — verify-red — and it is applied by mutation: "
       "the behaviour is put back the way it was, the suite is run, and the expected test must "
       "go red by name. It regularly finds that a test could never have failed, which is the "
       "one thing a green run cannot tell you."),
 ('h2', "Where the defects actually came from"),
 ('p', "The recurring lesson of this project, recorded across a hundred entries, is that the "
       "expensive bugs are not logic errors. They are seams: a producer with no consumer, a "
       "column nobody reads, a class that is present and inert, a check that could only ever "
       "pass. Several instruments exist purely to watch those seams — every granted database "
       "function must have a caller, every queue must have a handler, every nav destination "
       "must resolve, every published vocabulary must be consumed."),
]),

# ─────────────────────────────────────────────────────────────────────────
("Operations", [
 ('table',
  ["Concern", "How it works today"],
  [["Web deploys", "Push to main; Vercel builds and promotes; functions pinned to Frankfurt"],
   ["Service deploys", "git archive to the server, restart the systemd unit, verify /health "
                       "and that new routes answer 401 rather than 404"],
   ["Database changes", "Numbered migration, applied with its self-checks, then the SQL suite"],
   ["Secrets", "A DPAPI-backed store on the operator's machine; shipped to /etc/neurai/*.env; "
               "never in the repository, never in a log"],
   ["Retention", "A nightly purge timer; objects are deleted before the rows that point at them"],
   ["Health", "/health on the API and the speech service; queue depths on the service page"],
   ["Errors", "Structured logs plus a self-hosted, Sentry-compatible collector"]],
  [1.5, 4.7]),
 ('p', "The deployment is deliberately small: one virtual machine for everything that must "
       "keep running, a managed database, and a web tier that can be redeployed a dozen times "
       "a day without touching either."),
]),

# ─────────────────────────────────────────────────────────────────────────
("Honest limits", [
 ('p', "Three kinds of statement belong in an architecture document: what is built, what is "
       "deliberately not built, and what is not yet proven. This chapter is the last two."),
 ('ul', [
   "Crosstalk is a measured weakness: when two people speak over each other, roughly 30% of "
   "words are lost while every quality indicator still reads clean. An overlap detector is "
   "named work, not shipped work.",
   "The local diarizer over-splits real conversation; the primary provider's speaker labels "
   "carry the product. The local path is a hedge, not the production-quality answer.",
   "Voice matching only names people who have enrolled. On this deployment one person has, "
   "so most voices are correctly left unnamed and offered to the host to name.",
   "Search is lexical. Semantic retrieval (pgvector) is the natural next step and is not built.",
   "Uptime and cost per meeting have not been measured over a meaningful window.",
   "The Persian word error rate is a measurement on one corrected reference recording, not a "
   "general claim about Persian.",
   "Four of the seven configured OAuth connectors have never been connected by a real "
   "account, so their secrets are unproven — and Jira's cannot be probed at all, because "
   "Atlassian answers a right credential and a wrong one identically. No connector action "
   "has been run against a real account yet either.",
 ]),
 ('p', "None of these is a surprise discovered while writing this document. Each is recorded "
       "in the project's own log on the day it was measured, which is the point: a limit that "
       "is written down can be planned against, and one that is not becomes a promise "
       "somebody made by accident."),
]),
]
