# Connectors — the plan (proposal, 2026-09-06)

User directive: "in integrations, I want to have the connectors like in
Claude that give me the ability to use different other APIs and platforms;
we start with related ones to our work; give me suggestions of 10 of them
and a structure for doing it in a good way that helps our platform."

This document is the proposal. Nothing in it is built until the user picks
the first three. What EXISTS today: the Google connector (Gmail, Calendar,
Drive, Meet on one OAuth grant, per person, `core/src/api/connectors.ts`),
the Microsoft Graph adapter behind the same interface (not offered), the
integrations page as an app-store shelf (RULEBOOK R22), and the agents'
client tools with the consent card.

## What a connector IS here

A connector is three things, and the platform already has a home for each:

| Part | What it is | Where it lives today |
|---|---|---|
| **Grant** | a person's own authorization to an outside service (OAuth 2 or an API key), stored per person, revocable from the integrations page | `echo.connector_connection` + `echo.connector_secret` (db/0065; Google today), the connect briefing, the detail page's disconnect |
| **Sources** | what the assistant may READ through it — listed on the detail page as assets, cited in answers | `GET /v1/connectors/:provider/:source`, the M44 prep and M43 mail poller |
| **Hands** | what the assistant may DO through it — always a write the person sees first | client tools behind the consent card (M33), or a server-side action the person presses (the mail draft's Send) |

The rule that keeps this safe is the one the platform already runs on: **the
agent borrows the person's authority and never more.** A connector never
holds an org-wide credential that an agent could reach past the person; a
grant is the person's, its reads are what THEY can see in that service, and
its writes wait for their yes. Content read through a connector is never
logged (M17's twin), and a message the assistant composes never chooses its
own recipient (M43: the model writes the body, the envelope comes from the
data).

## The ten, in the order I would build them

Chosen for what this product does — meetings, tasks, records, a team room,
mail — not for what is popular. Each line says what it reads, what it can do,
and the one risk to design around.

| # | Connector | Auth | Reads (sources) | Hands (with consent) | Why it fits / the risk |
|---|---|---|---|---|---|
| 1 | **Microsoft 365** (Outlook mail + calendar, Teams meetings) | OAuth 2 (Graph) — adapter EXISTS | inbox, calendar, upcoming Teams meetings | draft a reply, create/move a meeting | the other half of every office; turning the offer on is one word in core's vocabulary once the Azure app is verified |
| 2 | **Zoom** | OAuth 2 | upcoming meetings, cloud recordings + transcripts | create a meeting with a link; import a recording as a record | recordings become records without a re-upload; risk: recording download scopes are broad — ask for the read scope only |
| 3 | **Slack** | OAuth 2 (bot + user token) | a channel's recent messages the person can read, DMs to the person | post a message AS the person (card), post a meeting summary to a channel | the room outside our room; risk: a bot token sees more than the person — read with the USER token only |
| 4 | **Telegram** | bot token per org + per-person `/start` link | messages sent to the bot | send a message to a colleague who linked their account; deliver a meeting brief | the channel Iranian teams actually use; risk: a bot cannot read a person's history, so it is a delivery channel first, a source second |
| 5 | **Jira** | OAuth 2 (Atlassian) or API token | issues assigned to the person, sprint board | create an issue from a task, comment on an issue, transition status | tasks mirrored to where engineering lives; risk: two boards drift — mirror by LINK (issue key on the card), never by copy |
| 6 | **Notion** | OAuth 2 (internal integration per workspace) | pages and databases shared with the integration | append a meeting's minutes to a page; create a page from a record | the wiki the SPEC's "wiki per project" points at; risk: Notion's search API is shallow — index titles, read bodies on demand |
| 7 | **GitHub** | OAuth 2 (GitHub App) | PRs and issues assigned to the person, commits on a repo | open an issue from a task; comment on a PR | our own team's work; risk: an App installation is org-scoped — keep the person's user token for reads |
| 8 | **WhatsApp Business** | Meta Cloud API (org number) | inbound messages to the org number | reply within the 24-hour window, send a template message | customer-facing meetings and follow-ups; risk: it is the ORG's number — every send is a card, and a template must be pre-approved |
| 9 | **Dropbox / OneDrive** (files) | OAuth 2 | recent files, a folder the person picks | attach a file to a task or meeting (link) | the attachments vertical the meeting page still lacks — read by link before storing anything |
| 10 | **A generic MCP connector** ("like in Claude") | the server's own auth (bearer / OAuth), one URL per org, admin-installed | the MCP server's tools and resources, listed | its tools, each gated by the consent card and the person's role | this is what makes the shelf open-ended: a customer's own system speaks MCP once and needs no adapter here; risk: a remote tool's description is untrusted input — it enters the prompt quoted, and every write-effect tool asks |

Not on the list on purpose: SMS (cost and no reads), CRMs (no customer
data model in the product yet), and calendar-only services already covered
by Google and Microsoft.

## The structure — one adapter contract, one catalogue, one wall

### 1. The catalogue entry (web, `integrationsCatalogue.ts`)

```ts
{ slug: "slack", key: "slack", provider: "slack", kind: "oauth",
  sources: ["channels", "dms"], hands: ["send_message", "post_summary"],
  mark: "slack" }
```

One entry per connector; the shelf renders it (R22), the detail page lists
its sources as assets, the agents' capability page names its hands. The
OFFER stays derived from core's `OFFERED_CONNECTOR_PROVIDERS` so turning a
connector on is one edit in the producer, never a hand-pruned copy.

### 2. The adapter contract (core, `src/api/connectors/<provider>.ts`)

```ts
interface ConnectorAdapter {
  provider: ConnectorProvider;
  auth: OAuthSpec | ApiKeySpec | McpSpec;          // how a grant is made
  status(grant): ConnectorStatus;                  // configured/connected/expired/revoked + scopes actually granted
  sources: Record<Source, (grant, query) => Promise<Item[]>>;   // reads, paged, never cached with content
  actions: Record<Action, ActionSpec>;             // writes: schema + effect ("write") + what the card names
  revoke(grant): Promise<void>;
}
```

Google's adapter is the reference implementation. `status()` reports the
scopes the provider ACTUALLY granted (the `can_draft` / `can_drive` pattern),
so a pre-scope grant shows an upgrade on its tile instead of failing at the
provider. Absence is decided by the adapter — it is the only layer that knows
how its provider spells "gone" (the purge lesson).

### 3. The grant (db)

`echo.connector_connection` grows a `provider` beyond google/microsoft and a
`kind` (`oauth | api_key | mcp`), token material encrypted at rest as today,
one row per person per provider (the secret beside it in `connector_secret`), revocable by its owner and by an admin
(revocation is a named operation with an audit line, never a silent
sweeper). An org-level grant (Telegram's bot, WhatsApp's number, an MCP
server) is a SECOND, new table — `echo.connector_org_connection` — admin-only, because a
credential that acts for everybody must never be mistaken for one that acts
for somebody.

### 4. The hands (agents)

Every connector action becomes a CLIENT tool or a server action, never a
silent server-side write:

- reads join `toolsFor()` as `<provider>_list_<source>` and enter the
  platform map under a CONNECTORS area (the coverage test fails on a new
  family with no paragraph);
- writes are `effect: "write"` tools behind the consent card; the card names
  the object (`NAMING` in `clientToolRunner.ts`); sends and invitations are
  in the classes the session-wide yes never covers (`consentGrant.ts`);
- an MCP server's tools are listed at connect time, stored with the grant,
  and offered under the same rule: read-effect tools run, write-effect tools
  ask, and a tool whose effect the server does not declare is treated as a
  write.

### 5. Security, in one paragraph

The person's token, never the org's, for anything that reads a person's
data; org tokens only for org channels and only behind admin install. Scopes
requested are the minimum the listed sources and hands need, and the tile
shows an upgrade when a grant predates a scope. No connector content in
logs, ever (codes only). Outbound messages composed by a model never pick
their own recipient. Remote tool descriptions and remote content enter the
prompt quoted as data. Every write is a card the person reads.

### 6. Phases

1. **P1 — the shelf and the contract** (done today for the shelf): the
   `ConnectorAdapter` interface extracted from the Google adapter; Microsoft
   turned on behind it once the Azure app is verified.
2. **P2 — one delivery channel and one work tool**: Telegram (org bot +
   per-person link) and Jira or GitHub (the user's pick), because together
   they prove the two grant shapes (org-level and per-person) and the two
   hand shapes (send with a card, create-by-link).
3. **P3 — recordings and rooms**: Zoom recordings as records; Slack read
   with the user token.
4. **P4 — the open door**: the generic MCP connector, admin-installed, tools
   listed and gated.

Each phase ships with: the adapter's tests against a captured real response
(rule 10), a live prove-at-acceptance run recorded in this file, the tile's
copy in both locales, and the platform-map paragraph.
