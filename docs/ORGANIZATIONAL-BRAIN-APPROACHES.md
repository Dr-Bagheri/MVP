# The organizational brain: approaches to layering NeurAI on a system a company already has

A DISCUSSION DOCUMENT (2026-09-18), the user's to decide. The goal, in the
user's words: *"an organizational brain — NeurAI that knows your organization
better than you,"* able to *"come like a layer on top of a system or CRM that
they already have and use the raw data or system data that they already
have."* This lays out five approaches, what each buys and costs, and a path
that gets there without betting the product on one of them. Nothing here is
built; ARCHITECTURE.md is untouched.

## What "knows the org better than you" actually is

Not a bigger model. It is four things a person cannot do and a system of
record does not try to:

1. **It reads everything.** Nobody reads every meeting, email, ticket, deal
   note and document. A brain that sees all of them at once knows things no
   single person does.
2. **It remembers decisions and commitments.** Who decided what, when, who
   owns the follow-up — institutional memory that today lives in people's
   heads and leaves when they do. NeurAI already has the seed: a decision
   ledger (`meeting_item`), a directory, tasks and projects.
3. **It knows the people-graph.** Who owns which account, who knows which
   customer, who is the real expert on a topic — derivable from activity, not
   from an org chart.
4. **It never forgets and it is always current.** Time is the brain's
   advantage over a person and freshness is its advantage over a wiki.

The safety rule that makes this shippable is already a NeurAI invariant: **the
brain borrows the asker's authority and never more.** It can only ever show
someone what they were already allowed to see, so a shared brain is not a leak
— it is the same walls, read faster. Keep that; it is the whole reason an org
brain is not a compliance problem.

## The two hard sub-problems, common to every approach

- **Identity resolution.** Their CRM's "user 4471", their Slack handle, the
  email `sara@acme.com`, and NeurAI's own account are one person — or one
  customer, one deal — and nothing says so. Every approach needs a canonical
  entity spine (people, organizations, deals/accounts, projects, documents,
  decisions) with a resolver, because a join is only as good as the link
  under it. NeurAI already feels this pain: `person.app_user_id` is null on
  every row of the live org, and the voice picker and the directory both
  stall on it. **This is the first thing to build regardless of approach.**
- **Write-back.** Reading their data is safe. Writing into their CRM (update a
  deal, log a call, create a task) is where the value doubles and the risk
  does too. NeurAI already has the answer shape: a proposal the human
  approves (the consent card). A brain that only reads can ship this quarter;
  write-back is a deliberate, later, per-integration step behind consent.

## Five approaches

### A — Connector Mirror (read-through, no store)
NeurAI reaches into the CRM/system over its API at query time and reasons over
what comes back. No copy of their data lives in NeurAI. This is the existing
connector registry (M49) pointed at a system of record.
- **Buys:** ships fastest (extends what exists), zero data duplication, the
  cleanest privacy story, authority borrowed live, their system stays the one
  source of truth.
- **Costs:** limited to the source API's shape and rate limits; cross-system
  questions cost N calls; no memory beyond what the source keeps; no real
  semantic search. "Knows better than you" stays weak — it only sees what a
  given question reaches for.
- **Fits when:** the customer wants a smart read-only assistant over one
  system, now, with nothing stored.

### B — Ingestion Lake + Semantic Index (ETL into NeurAI's own store)
Pull the raw/system data — CRM records, tickets, emails, documents, calendar,
plus the transcripts and decisions NeurAI already makes — into NeurAI's own
store, normalize it into the canonical spine, build embeddings and a knowledge
graph, and keep it fresh with webhooks / change-data-capture / polling.
- **Buys:** the real brain. Cross-system joins, semantic + graph retrieval,
  memory over time. This is where "knows the org better than you" actually
  lives.
- **Costs:** a full copy of their data (a security and privacy burden — which
  on-prem, approach E, is the answer to), sync complexity (drift, deletes,
  conflicts, backfill), a schema mapping per source, embedding and storage
  cost, and the standing danger of quietly becoming a **second system of
  record** the org now has to reconcile.
- **Fits when:** a customer commits to NeurAI as the intelligence layer and
  accepts a managed copy — usually the on-prem or single-tenant path.

### C — Provenance-First Derived Graph (store the meaning, not the raw)  ★ recommended spine
The middle path, and the one that matches NeurAI's own principles. Do **not**
mirror raw records. Instead, as NeurAI observes the org — meetings it records,
connectors it reads, activity it sees — it writes **derived knowledge** into
its own lightweight graph: entities, relationships, decisions, commitments,
who-owns-what, who-knows-what — **each row carrying a provenance pointer back
to the source** (this call, that email, that CRM record). Raw data is read
live (A/D) when a question needs the current field value.
- **Buys:** a small footprint; the graph is the **organization's own
  knowledge** (decisions, expertise, commitments), not a copy of the CRM, so
  it complements the system of record instead of competing with it; it is
  literally "a layer on top"; and it is exactly rule 6 already in the repo —
  *the transcript is the source of truth, derived artifacts are rebuildable
  and carry provenance.* The brain is the derived layer plus a live read for
  the raw field.
- **Costs:** the derived layer can lag the source (mitigated by reading raw
  live for volatile fields and by rebuilding derivations on change); it needs
  a strong entity-resolution story (the spine above); and its knowledge is
  only as complete as NeurAI's observation coverage.
- **Fits when:** you want one product that works for everyone from day one and
  gets smarter as it observes — the pragmatic default.

### D — Federated / MCP (NeurAI plans across systems, stores nothing)
Treat every source — CRM, ticketing, docs, the customer's own internal APIs —
as a tool or an MCP server. NeurAI is the orchestrating brain that plans and
joins **at reasoning time**; each system exposes its data through a thin
adapter its own IT controls. NeurAI already ships a generic MCP connector, so
the seam exists.
- **Buys:** standard and extensible, no lock-in, the customer's IT keeps
  control of each adapter, and adding a source needs no change to NeurAI. This
  is the purest reading of "a layer on top."
- **Costs:** reasoning-time joins are slow and token-expensive; quality is
  hostage to each adapter; and there is no persistent memory unless paired
  with C.
- **Fits when:** a security-conscious enterprise wants NeurAI to reach their
  systems without NeurAI holding anything — best combined with C for memory.

### E — Embedded Sidecar (deploy inside their perimeter, read their DB directly)
The on-prem endgame. NeurAI runs inside the customer's network, reads their
system's database or warehouse directly (a read replica), and builds the brain
locally. Nothing leaves the perimeter — and the open-weight model choice
(DeepSeek V4 Flash today, a 2-GPU box) is what makes the reasoning local too.
- **Buys:** the strongest privacy and on-prem story; direct DB or warehouse
  access is the richest, least rate-limited data there is; a real brain that
  never phones home.
- **Costs:** a heavy per-customer deployment, schema coupling to their
  database, an ops and upgrade burden, and a security review each time. Only
  worth it for larger customers with real data gravity.
- **Fits when:** an enterprise says the data cannot leave — which is exactly
  the customer who most wants an org brain.

## How the data actually gets in (orthogonal to the approach)

For any of B/C/E, the raw or system data arrives by one of: **the vendor
API** (connectors — easiest, rate-limited), a **read replica or data
warehouse** (richest, needs their DB — the E path), a **change-data-capture
stream** (freshest, most engineering), or a **file/export drop** (crudest,
good for a first import). Most customers start at the API and graduate to a
replica once they trust the product.

## A path that does not bet on one approach

The point of laying these out is that C is a spine the others attach to, so
you can walk toward the vision without a fork.

- **Phase 0 — already true.** NeurAI is *itself* a source: it makes the
  meeting, transcript, decision and commitment data, and it already connects
  Gmail, Slack, Jira, Notion, GitHub, Zoom, Dropbox. The brain's seed exists;
  it just is not organized as a brain yet.
- **Phase 1 — the entity spine + resolver.** People, organizations,
  deals/accounts, projects, documents, decisions, with an entity-resolution
  service that links a CRM id, an email, a handle and a NeurAI account into
  one node. This is the first real build and every approach needs it. (It
  also fixes the `app_user_id` gap the product already stumbles on.)
- **Phase 2 — the provenance-first derived graph (C) fed by observation and
  connectors (A/D).** The graph carries decisions, commitments, ownership and
  expertise, each pointing back at its source; raw fields are read live. This
  is the shippable org brain, multi-tenant, safe by the borrowed-authority
  rule.
- **Phase 3 — semantic memory over the graph and selected raw.** Embeddings
  make the brain answer "what do we know about X" across everything. This is
  the *item 1 (semantic memory)* that the older vision doc had *item 7*
  depending on; it was blocked on a box, and it is unblocked the moment you
  are on a GPU host — which the open-weight model path already puts you on.
- **Phase 4 — on-prem sidecar (E) and federated MCP (D)** for enterprises,
  reusing the same spine and graph, now inside their perimeter.

## Recommendation

**Build the entity spine (Phase 1) next, and make the provenance-first derived
graph (C) the product's brain, reading raw data live through connectors (A)
and MCP (D), and moving to a read replica or on-prem sidecar (E) for customers
whose data cannot leave.** It is the only approach that (a) matches NeurAI's
existing invariants — borrowed authority, transcript-as-source-of-truth,
derived-and-rebuildable-with-provenance — (b) is genuinely *a layer on top*
rather than a second system of record, and (c) reaches the on-prem endgame and
semantic memory without a rewrite. Approach B (a full managed copy) is worth
having only as the single-tenant / on-prem shape of the same graph, not as the
multi-tenant default, because a copy of every customer's CRM is a liability the
derived graph avoids.

The one thing to decide before any of it: **read-only first.** An org brain
that only reads ships this year and is safe by construction. Write-back into
the customer's CRM — the step that doubles the value — comes later, per
integration, behind the consent card the product already has.
