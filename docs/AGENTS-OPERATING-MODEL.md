# Echo and its colleagues — an operating model (proposal)

> **Status: PROPOSAL, 2026-09-06.** Written on the user's ask — "suggest a
> good state-of-the-art architecture, and how it is better for them to use
> the platform, come to chat, do the tasks, or anything else; I want your
> opinion." Nothing here is built unless it says so. The decisions are the
> user's; the recommendation is in one line under each heading.

## 0 · Where we are

Three agents. **Echo** answers in the assistant thread and in the strip on
every page; **Roya** (operator) and **Ava** (analyst) are called by Echo
(`ask_roya` / `ask_ava`) or named in a room. Since 2026-09-05 all three have
**hands**: every write is a *client tool* — performed in the person's own
browser, on the person's own session, through the same api call the screen's
button makes, behind a consent card below the Act setting. That gives the
agents exactly the person's reach and not one grant more (`echo_agent` still
holds no DELETE anywhere), and it has two consequences worth saying plainly:

- an agent can act **only while the person's tab is open**, and only as
  that person — there is no such thing today as "Roya did it overnight";
- a request with many pieces becomes **many cards** — which is the complaint
  behind today's "for this session" button.

The workflow engine (M41) already has the other half: **server-side writes
with the human in the middle** — proposals, decisions, standing approvals
(`via_standing`), the agent role, an audit line per write. The two halves
have not been joined.

## 1 · The shape I recommend

**One sentence:** *chat is for asking and deciding; the board is where agents
work; rooms are for coordination; and the person's authority is expressed
once, on the agent's page, not one card at a time.*

### 1.1 Chat decides, it does not labour

Echo's job in the thread is triage: answer, look things up, and turn work
into **cards**. Three or fewer changes run inline behind the card (as now).
Anything larger — the "more than three tasks" rule — should not become a
run of consent cards; it should become **one plan card**: the split, each
item named (title · project · who · when), one yes for the batch. That is
the "one after another" complaint solved at its cause rather than by a
blanket grant, and it keeps the card honest: every object is still named.

*Recommendation:* build the plan card next (P2 below). Today's session grant
stays as the blunt instrument for people who want it.

### 1.2 The board is the agents' queue

A task **assigned to an agent** (`@roya`, `@ava`) is picked up by the worker
— a new queue, `echo_agent_task`, beside the four that exist — and run
**server-side with the borrowed authority of the person who filed it** (M4's
invariant, unchanged: the agent never holds more than the caller). The agent
uses the read tools plus **proposal tools**, and a write lands only through
the existing decision path: per item, or automatically where the org's
standing rules already allow that class (M41 `via_standing`). Progress is
**comments on the task** (append-only), the result is checklist items ticked
and a closing comment, and the card moves to a *review* column — a person
moves it to done. Nothing new is invented: tasks, comments, events,
proposals, decisions and standing rules all exist; this joins them.

What this buys: work continues when the tab closes; a person can hand an
agent ten things and look once; every step is on the card's own history
(«چه کسی چه کرد»); and a failed run is a card that says so rather than a
spinner.

*Recommendation:* P3. It is the largest piece and the one that changes what
"an agent" means to a member.

### 1.3 Rooms coordinate, they do not execute

In a room an agent answers when named (0184's silence rule stays), and may
**file cards** — never carry out long work in the room. A room is addressed
to everybody, so the agent's reach there stays the org-readable set
(`ROOM_TOOLS`), and anything that writes goes to the board where the
consent lives.

*Recommendation:* keep as is; add "file this as a task for X" as the room's
one write, through the same consent.

### 1.4 Authority is written once, on the agent's page

Today a person expresses trust in four places: the Act dial (M36), the
per-card yes, today's session grant, and M41's standing rules. They should
collapse into **one ledger on each agent's page**: *what this agent may do
without asking me* — by class (create, edit, move, archive; delete never),
per scope (my own tasks / projects I am on / the org), with the audit of
what it actually did under it. The consent card then becomes the exception
path, not the daily one.

*Recommendation:* P4, after P3 — it is the UI of the standing rules that P3
makes matter.

### 1.5 Agents as principals

`author_kind = agent` and `assigned to @roya` should be first class: an
`agent_principal` row per agent (not an `app_user` — it must never sign in
and never hold a session), so a card, a comment, an audit line and a room
message can name the agent AND the person on whose behalf it acted. The
database role stays `echo_agent`.

*Recommendation:* ships with P3; it is what makes "assigned to an agent"
representable.

## 2 · What I would not do

- **No server-side DELETE for agents, ever** — not by standing rule, not by
  session grant. It is the one verb whose mistake cannot be undone, and this
  week's incident was a delete.
- **No headless browser hands.** Running client tools without the person is
  the worst of both designs: the person's authority without the person.
- **No always-on agents in rooms.** Three agents answering every sentence is
  noise, and noise is how people stop reading what agents say.
- **No second memory system yet.** A per-org notebook of confirmed facts is
  tempting; until agents work on the board, there is nothing worth
  remembering that the board does not already hold.

## 3 · Phases

| Phase | What | Where it lives | Status |
|---|---|---|---|
| P1 | Session grant; folder ≠ project (vocabulary, `list_projects`, `folders`, `create_task` by project/folder/assignee) | web runner + core tools + db/0193 | **shipped 2026-09-06** |
| P2 | The plan card: one consent for a batch, every item named; Echo's "more than three" rule produces it | core (a `propose_plan` client tool) + web card | proposed |
| P3 | Agents as assignees: `echo_agent_task` queue, server-side runs on borrowed authority, proposals + standing rules, progress as comments, review column | core worker + db (queue, agent_principal) + web | proposed |
| P4 | The authority ledger on the agent's page; the card becomes the exception | web + core (standing rules per class/scope) | proposed |

## 4 · How to read this against the invariants

Every phase keeps the four walls: no DB access without a person's identity
(the run carries the filer's), the agent borrows the caller's authority and
never more (proposals, not grants), RLS + role grants are the wall (the
agent role gains nothing), the agent's DB role has no DELETE (unchanged).
What changes is *where* the person says yes — from a card per write to a
rule per class — and *when* the agent works — from "while I watch" to "on
the card, with the record".
