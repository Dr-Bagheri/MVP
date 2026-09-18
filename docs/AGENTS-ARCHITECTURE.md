# Echo, Roya and Ava — what they are, and why they stopped being the same

*Written 2026-09-18 for the directive: "we have 2 agents ava and roya but i
dont know why and they do the same, build them right — and also we have the
main one echo or neurai, i dont know the name; make it work somehow that makes
sense, give them a full shape and tech, and give me a report of what we done so
i understand it too."*

---

## 1. The names, settled

- **NeurAI** is the **platform** — the product, the company, the thing at
  app.neurai.pt.
- **Echo** is the **assistant** — the one you talk to.
- **Roya (رؤیا)** and **Ava (آوا)** are its two **colleagues**.

The confusion was real and it was ours: "Echo" used to be the name of the
call-intelligence *app* inside the platform, and that app was dissolved into
meetings on 2026-09-04. The name was then free, and 0169 had already given it
to the assistant. So: one Echo, and it is the assistant.

---

## 2. Why they did the same thing

Their instructions have always described two different jobs — Ava reads the
record and reports, Roya gets work done — and they are well written.

**Nothing enforced it.**

On 2026-09-06 the analyst/operator split was deleted, for a good reason: a
user reported agents answering «دسترسی ندارم» about records the person could
plainly see. Narrowing an analyst's *reads* was the wrong axis, and removing
it was right. But it was the **only** structural difference the two had. From
that day they had identical reads, identical write hands and identical reach,
and the only thing left telling them apart was a paragraph.

A paragraph is not a wall. Two weeks later the user noticed, which is about how
long that takes.

There was a second, quieter version of the same problem: `assistant_agent.tools`
stores five tool names per agent, `agent-store` writes it, and `delegation`
ignores it entirely. Stored and unqueried — so the agents page could show two
agents with tidy, different-looking capability lists that decided nothing.

---

## 3. The architecture, and where it comes from

The pattern the field settled on for 2026 is **orchestrator + specialists**,
with three qualifications that all apply here:

- the orchestrator runs on the capable model and specialists on cheaper ones —
  a 40–60% cost difference in production reports;
- **tool surface is scoped per agent**, because every tool in the context
  window is a tax on the ones that matter;
- and the loudest finding of all: Princeton measured a **single agent matching
  or beating multi-agent systems on 64% of tasks** given the same tools and
  context, so Microsoft's guidance is "use the lowest level of complexity that
  reliably meets your requirements".

That last one is why this product does **not** get a committee. Echo answers
almost everything alone. The colleagues exist for two specific shapes — a
batch of work to be done, and a question that needs the record read carefully
— and they are brought in deliberately.

```
                    ┌──────────────────────────────────┐
     the person ───▶│  ECHO  (orchestrator)            │
                    │  · holds the conversation        │
                    │  · full reads + full write hands │
                    │  · decides when to hand off      │
                    └───────────┬──────────────────────┘
                                │  ask_roya / ask_ava   (max 4 hops)
                 ┌──────────────┴───────────────┐
                 ▼                              ▼
      ┌───────────────────────┐     ┌───────────────────────┐
      │  ROYA  (operator)     │     │  AVA  (analyst)       │
      │  full reads           │     │  full reads           │
      │  WRITE HANDS ✓        │     │  no write hands       │
      │  can_act = true       │     │  can_act = false      │
      └───────────────────────┘     └───────────────────────┘
```

---

## 4. The one difference, and why it is this one

**`echo.assistant_agent.can_act`** (db/0233).

- **Roya: true.** She is offered the session's write hands — tasks, projects,
  meetings, folders, drafts, messages. She is who you hand a batch to.
- **Ava: false.** She reads everything and is not offered the means to change
  anything. Asked to do something, she says whose job it is.

Reads are **not** narrowed. Both colleagues keep the whole platform read set,
exactly as they have since 2026-09-06, because that is the axis that produced
«دسترسی ندارم» and an analyst who cannot look things up is not a specialist,
it is a broken assistant.

Enforced in `core/src/agent/delegation.ts`, one line:

```ts
clientTools: agent.canAct ? options.clientTools ?? [] : [],
```

and asserted as a PAIR in `core/test/delegation.test.ts`, because either half
alone passes against a version that hands nobody anything (Roya unable to do
her job) or everybody everything (the state being fixed).

**`can_act` defaults to FALSE.** An organisation authoring its own agent gets
one that can look and cannot touch; making it a writer is a deliberate act.

---

## 5. What is still true underneath

None of this widens anything. The walls the agents run against are unchanged:

1. **`echo_agent` holds no UPDATE and no DELETE anywhere** — 43 selects, 8
   inserts, and that is the whole grant. An agent cannot change a product row
   server-side at all, whatever its prompt says.
2. **Every write is a client tool**: it runs in the person's own browser under
   their own identity, behind a consent card that names the object (the task's
   title, the project's name, the person being messaged) — not just the verb.
   That rule was minted the night a test run on live data cost the board.
3. **A session-wide "yes" never covers a delete**, a message, an invitation, a
   revocation, a role or permission change, a record's scope, approved
   minutes, a shared conversation or the model list.
4. **The person's own role is the outer wall.** An agent asking for something
   the person cannot see gets the person's refusal, not a wider answer.
5. **An unverified organisation cannot spend a model call at all** — a trigger
   on `agent_run`, so no route, worker or future path can route around it.
6. **Four hops.** Two agents naming each other never stop on their own, and
   the first anyone would know is the bill.

---

## 6. The tech, end to end

**One turn, from typing to answer:**

```
browser ──▶ /api/assistant/ask (BFF, session attached server-side)
        ──▶ core /v1/assistant/ask
              · identity resolved (RLS actor set for the whole transaction)
              · org verified?                    ── no ─▶ 403 org_unverified
              · model chosen by M5's ladder      (preference → org → offer list)
              · thread read BEFORE the question is appended
              · carried context: this conversation + a tail of the person's
                other recent ones (12h, 3 conversations, verbatim, labelled)
              · tools offered:  platform reads + domain reads + the session's
                                client tools + ask_roya / ask_ava
        ──▶ pi-ai ──▶ OpenRouter ──▶ the model
              · a tool call comes back
                  · read  → runs server-side on echo_agent
                  · write → streamed to the browser as a CONSENT CARD
                  · ask_* → a nested run under the colleague's own prompt
        ──▶ SSE back: session, floor, deltas, tool codes, done
              · assistant turn persisted BEFORE done, so a reload finds it
```

**What each agent is made of:** a handle, a name, a description, its own
instructions, an optional pinned model, `web` (may search the open web),
`can_act`, and an icon and colour. System agents are shipped and not editable;
an org can write its own.

**The floor (M48)**: naming a colleague gives them the floor — they answer
under their own name until somebody else is named or you press ×. Two names in
one message means both answer, in the order you wrote them.

**Cost**: the platform offers three models and the default is DeepSeek V4
Flash 0731 at $0.06/$0.12 per million, so a colleague's turn is cheap enough to
hand work to. The M5 ladder is applied at every rung including the env
fallback, which is where the no-Claude rule had silently not been true for
anything running unwatched.

---

## 7. What we did today, in order

1. Read the three agents out of the production database rather than the code,
   and found the tools column identical for both and inert.
2. Searched the field for the current pattern and took the parts that apply:
   orchestrator + specialists, per-agent tool scoping, and "the lowest level of
   complexity that works".
3. **db/0233**: added `can_act`, gave Roya true and Ava false, corrected both
   descriptions so a person choosing between them has something to choose on,
   and corrected the `tools` column's comment so the schema stops implying it
   is a ceiling.
4. **core**: carried `can_act` through the agent store (defaulting to false
   when the column is missing, so an older schema fails in the safe
   direction), and gated the delegate's write hands on it.
5. **Echo's standing orders**: rewritten so the handoff makes sense — who it
   is, that both colleagues see everything it sees, and that the difference is
   whether they act. Ava's limit is stated POSITIVELY ("acting is not her
   job — hand it to Roya") because a 2026-09-06 guard forbids "cannot" in this
   prompt, and rightly: a prompt that teaches a model to plead inability is how
   «دسترسی ندارم» happened in the first place.
6. Asserted the new rule as a pair, and re-ran the whole suite.

---

## 8. What we did NOT do, and why

- **No new agents.** The evidence says a single capable agent beats a
  committee most of the time, and this product already has one orchestrator
  and two specialists. Adding a third persona would be complexity ahead of
  workload.
- **No per-agent READ scoping.** It is the axis that broke before. If it ever
  comes back it should be per-ORG configuration on an authored agent, not a
  property of the two we ship.
- **`assistant_agent.tools` not dropped.** It is inert as a ceiling but the
  web still falls back to it when an older core sends no capability list.
  Removing it is a migration plus a web change and belongs in its own round;
  its comment now says exactly what it is.
- **No model pinned per agent.** A cheap specialist and an expensive
  orchestrator is the textbook saving, and this product's default model is
  already the cheap one. Pinning Ava to something smaller is a real and
  separate optimisation, and it wants a measurement rather than a guess.
