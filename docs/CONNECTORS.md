# Connectors — what is built, and how each one is switched on (2026-09-06)

User directive: "built these: Zoom, Slack, Telegram, Jira, Notion, GitHub,
WhatsApp Business, Dropbox/OneDrive, and a generic MCP connector, and tell me
how to connect them to the platform." This is the record of what shipped and
the operator's guide to connecting each one. The proposal it grew from is
[CONNECTORS-PLAN.md](CONNECTORS-PLAN.md); the architecture decision is M49 in
[ARCHITECTURE.md](../ARCHITECTURE.md).

## The shape, in one paragraph

Every connector is one entry in a REGISTRY (`core/src/api/connector-providers.ts`)
that says how a connection is made (`oauth` or `token`), what the assistant
may READ through it (its `sources`), what it may DO (its `actions`), and how
to talk to the provider. The generic repository (`core/src/api/connectors.ts`)
drives the registry: the OAuth dance, the token vouch, the encrypted store,
the refresh, the revoke. The web catalogue
(`web/src/components/platform/integrationsCatalogue.ts`) mirrors the registry
one tile per connector on the app-store shelf (RULEBOOK R22), and the detail
page switches between a connector's sources with the platform's filter chips.
The agents get one READ tool over every connector (`list_connector_items`)
and eight HANDS, each a client tool performed in the person's own browser
behind the consent card. **A grant is the person's, encrypted at rest in
`echo.connector_secret`, unreadable by `echo_agent`; the agent borrows the
person's reach and never more.**

## Two ways to connect

| Kind | Who does what | Providers |
|---|---|---|
| **OAuth** | The operator registers ONE app per provider (once per deployment) and stores its client id + secret; each person then presses «اتصال» on the shelf and consents on the provider's own screen. | Google, Zoom, Slack, Jira, Notion, GitHub, Dropbox |
| **Token** | No operator step. The person pastes a credential of their own into the connect dialog; core asks the provider to vouch for it BEFORE storing it (`getMe`, the business profile, an MCP `initialize`). | Telegram, WhatsApp Business, MCP server |

A provider whose OAuth pair is absent shows «روی سرور پیکربندی نشده» on the
shelf — a claim about the deployment, with nothing to press. Token providers
never show that state: the store needs only the encryption key.

## Base configuration, once per deployment

These two exist already on production and every connector uses them. The
browser never receives a provider token: the OAuth callback is bound to this
origin, the BFF keeps the short-lived PKCE verifier in an HttpOnly cookie,
and core encrypts the credential before it is stored. A connection belongs
to the person who authorised it; an organisation administrator cannot read
another person's connection.

| Name (DPAPI store → `/etc/neurai/core.env`) | Purpose |
|---|---|
| `echo_platform_web_url` | the exact public origin, `https://app.neurai.pt` — every callback URL is built on it |
| `echo_platform_connector_encryption_key` | base64 of exactly 32 random bytes (AES-256-GCM for `echo.connector_secret`) |

## The operator's steps for an OAuth provider

The same four steps for every one; only the console differs.

1. **Create the OAuth app** in the provider's developer console (table below).
2. **Register the redirect URI** exactly:
   `https://app.neurai.pt/api/connectors/<provider>/callback`
   (`<provider>` is the lower-case name in the table: `zoom`, `slack`, `jira`,
   `notion`, `github`, `dropbox`). The BFF builds it from the
   page's own origin, so a staging host registers its own.
3. **Store the pair** in the DPAPI store on the operator machine under the
   names `echo_platform_<provider>_oauth_client_id` and
   `echo_platform_<provider>_oauth_client_secret` (the `echo_platform_`
   prefix is the rule of the store; see CLAUDE.md rule 3). Every provider
   reads its OWN pair — nobody borrows another's.
4. **Ship and restart**: `scripts/deploy-secrets-to-server.ps1` writes every
   present pair into `/etc/neurai/core.env` and warns, by name, about the
   absent ones; then restart `neurai-api.service`. No code change, no deploy.

### Proving a pair is live

**Ask the TOKEN endpoint, not the authorize URL.** The authorize-URL trio
that proved the Google pair (real → sign-in page, invented id →
`invalid_client`, wrong redirect → `redirect_uri_mismatch`) DOES NOT TRANSFER:
Zoom answers all three with a 302 to its own sign-in page and validates the
client only after the person has signed in, so every case reads identically
and the probe distinguishes nothing (measured 2026-09-07). The authorize URL
also never sees the secret, so it cannot prove the half most likely to be
mistyped.

Post a deliberately invalid code to the token endpoint instead, from the
server, with the pair read out of `core.env`:

```
curl -s -u "$ID:$SECRET" -X POST <tokenUrl> \
  -d "grant_type=authorization_code&code=deadbeefnotarealcode&redirect_uri=<callback>"
```

The discriminating triple, and all three must be run — a probe that only
tries the real pair cannot tell a working credential from an endpoint that
accepts anything:

| Case | Expected |
|---|---|
| real id + real secret | an error about the CODE — the credentials were accepted and only the fake code refused |
| real id + wrong secret | an error about the CLIENT |
| wrong id + real secret | an error about the CLIENT |

Each provider spells that its own way, and the request has to be shaped the
way its `ProviderDef` shapes it (basic auth vs a body pair, form vs JSON).
Measured 2026-09-07, all three cases each:

| Provider | Request | real pair | wrong secret | wrong id |
|---|---|---|---|---|
| **Zoom** | basic auth, form | `invalid_grant` | `invalid_client` | `invalid_client` |
| **GitHub** | body pair, form, `Accept: application/json` | `bad_verification_code` | `incorrect_client_credentials` | `404 Not Found` |
| **Notion** | basic auth, JSON | `400 invalid_request` "Auth code must be a valid UUID" | `401 invalid_client` | `401 invalid_client` |
| **Dropbox** | body pair, form, PKCE verifier | `invalid_grant` "code doesn't exist" | `invalid_client` | `invalid_client` |

**Some providers cannot be probed at all** — Slack and Jira are both of that
class, each measured on 2026-09-07 with both probes and three readings each:

| Provider | Token endpoint | Authorize endpoint |
|---|---|---|
| **Slack** | validates the CODE first — real pair, wrong secret and wrong id all answer `invalid_code` | a JavaScript shell that echoes the input and bounces to `workspace-signin`; the client is checked only after a person signs in |
| **Jira** (Atlassian) | same shape — all three answer `400 invalid_request` / "authorization_code is invalid" | 302 to `id.atlassian.com/login` with the request echoed in `continue=`, identical for a real id, an invented id and a wrong redirect |

Four probes that cannot fail, which is worth knowing before somebody reports
one of them as proof. Note what the Jira reading also rules out: the
authorize endpoint does not even refuse a WRONG REDIRECT, so it cannot stand
in for the redirect check either.

Where no probe discriminates, these two are what remain, and they are enough
for the deployment half:

- **`GET /api/connectors` reports `configured: true`** for that provider. The
  product's own read of its environment — core found BOTH names — which is a
  better witness than any external probe, because it is the same read the
  connect button makes.
- **The SHELF tile** changes from «روی سرور پیکربندی نشده» (a plain box) to
  «وصل نشده» (a button).

Neither says the SECRET is right. For a provider whose token endpoint refuses
to discriminate, the first real connect is the first test of the secret, and
until somebody presses «اتصال» that is simply unproven — say so rather than
reporting a configured tile as a working credential.

| Provider | Console | App type / notes | Scopes requested |
|---|---|---|---|
| **Zoom** | marketplace.zoom.us → Develop → Build App → **General App** (user-managed) | Add scopes `meeting:read:list_meetings`, `meeting:write:meeting`, `cloud_recording:read:list_user_recordings`, `user:read:user` under the granular model; production use needs Zoom's app review — until then only the developer's own account and added test users can connect. PKCE on. | (granular scopes are set on the app, none sent) |
| **Slack** | api.slack.com/apps → **Create New App** → From scratch. NOT in the Slack client — app creation lives only on the developer site; the client's «Connect apps» installs an app somebody else built. | OAuth & Permissions → **User Token Scopes** — the seven `SLACK_USER_SCOPES` sends, verbatim: `channels:read`, `groups:read`, `channels:history`, `groups:history`, `search:read`, `chat:write`, `users:read`. (This table said six until 2026-09-07 — `groups:history` was missing, which reads as complete and loses PRIVATE channel history alone.) The connection is the PERSON's user token, never a bot token: a bot sees more than the person. Redirect URLs must be https. | `user_scope` = the list above |
| **Jira** | developer.atlassian.com → **OAuth 2.0 (3LO)** app | Permissions: Jira API — `read:jira-work`, `write:jira-work`, `read:jira-user`; User identity — `read:me`; plus `offline_access` for refresh. After connecting, core resolves the person's cloud id and site URL from `accessible-resources` and keeps them as the connection's public settings. | `read:jira-work write:jira-work read:jira-user read:me offline_access` |
| **Notion** | notion.so/my-integrations → **New integration** → type **Public** | Capabilities: read content, insert content, read user information without email. The person chooses which pages the integration may see on Notion's consent screen; the sources list only those. Token exchange uses HTTP basic auth with a JSON body (Notion's own shape). | (capabilities on the integration; `owner=user`) |
| **GitHub** | github.com/settings/developers → **OAuth Apps** → New (or the org's settings for an org-owned app) | Homepage `https://app.neurai.pt`. GitHub answers the token exchange in a form body unless asked for JSON — core asks. | `repo read:user user:email` |
| **Dropbox** | dropbox.com/developers/apps → **Create app** → Scoped access → Full Dropbox or App folder | Permissions: `files.metadata.read`, `account_info.read`. `token_access_type=offline` is sent so a refresh token is issued; PKCE on. | (permissions on the app) |
| **Google** (Gmail, Calendar, Drive, Meet — one grant) | console.cloud.google.com → OAuth client `Web client` (done 2026-08-27) | Already live. | as recorded in ARCHITECTURE M43 |
| **Microsoft** (Outlook mail + calendar) | — | **Nothing to create, and nothing on the shelf.** The adapter is still in `core/src/api/connectors.ts` and has never been OFFERED (user, 2026-08-28: "we just go with the google"), so no connection to it can be made; its pair left `deploy-secrets-to-server.ps1` on 2026-09-07 with OneDrive ("i dont want microsoft apps"). Listed here so nobody goes looking for a row that is missing. | — |

## The person's steps for a token provider

| Provider | What the dialog asks for | Where it comes from | What core checks before storing |
|---|---|---|---|
| **Telegram** | the bot token | Telegram → `@BotFather` → `/newbot` (or `/token` for an existing bot). The bot is the person's; the platform reads what is sent TO it and can send FROM it. | `getMe` succeeds; the bot's username becomes the connection's label. |
| **WhatsApp Business** | a permanent access token, the **phone number ID**, optionally the **WABA ID** | Meta Business Suite → WhatsApp Manager → API setup (a system-user permanent token with `whatsapp_business_messaging` + `whatsapp_business_management`). | the phone number's business profile loads; the display number becomes the label. Free-text sends work inside the 24-hour customer window; outside it a pre-approved **template** is required, and the hand carries `template` + `language` for that. |
| **MCP server** | the server's **https URL**, optionally a bearer token | whoever runs the server. Streamable HTTP transport, protocol `2025-06-18`. | the URL is public https (private, loopback and link-local addresses are refused after DNS resolution), and `initialize` answers; the server's declared name becomes the label. Tools and resources are then listed as sources. |

## What each connector reads and does

| Connector | Sources (detail page chips, `list_connector_items`) | Hand (client tool, behind the consent card) |
|---|---|---|
| Zoom | `meetings` (upcoming), `recordings` (cloud) | `create_zoom_meeting {topic, starts_at?, minutes?}` |
| Slack | `channels`, `mentions` (of the person) | `send_slack_message {channel, text}` |
| Telegram | `updates` (messages sent to the bot) | `send_telegram_message {chat, text}` |
| Jira | `issues` (assigned to the person), `projects` | `create_jira_issue {project, summary, description?}` |
| Notion | `pages`, `databases` (those shared with the integration) | `create_notion_page {parent, title, content?}` |
| GitHub | `issues`, `pulls`, `repos` | `create_github_issue {repository, title, body?}` |
| WhatsApp Business | `profile`, `templates` | `send_whatsapp_message {to, text? \| template?, language?}` |
| Dropbox | `files` (the root folder) | — (read only) |
| MCP server | `tools`, `resources` | `call_mcp_tool {tool, arguments_json?}` |

Every hand names its object on the consent card (the channel and the words,
the project and the summary, the tool and its arguments). The session-wide
yes («برای این نشست») never covers `call_mcp_tool`: a remote tool's effect is
whatever the remote server decides, the one hand whose consequence nobody on
this side can name in advance, so it is asked about every time.

## The wall, restated for connectors

- The token is the PERSON's grant, AES-256-GCM in `echo.connector_secret`;
  `echo_agent` has no grant on that table and no DELETE anywhere.
- Every read and every hand runs on the person's identity: server-side runs
  (workers, delegated agents) hold no route to a connector action.
- Content read through a connector never reaches a log; the provider's
  refusal is carried as its status class (`provider_refused`, the status),
  never its body.
- An MCP URL must be public https; the address guard resolves DNS and
  refuses private ranges — a customer's MCP server cannot be used to scan
  the platform's own network.
- The provider CHECK on `echo.connector_connection` names the twelve
  providers (db/0199) and the connection's `settings` column holds only
  PUBLIC facts (a site URL, a workspace, a bot username, a phone number);
  the secret never lands there. Test `db/test/112` walks it.

## Live proof — what has been run

| Provider | Date | What was proven |
|---|---|---|
| **Zoom** | 2026-09-07 | **Proven end to end, including the secret.** Pair stored (21 and 32 characters, BOM-free on both sides of the wire), shipped, api restarted. Token-endpoint triple discriminated: real pair → `invalid_grant`, wrong secret → `invalid_client`, wrong id → `invalid_client`. Then the operator CONNECTED: `status: connected`, `account_label: neurai.git.acc@gmail.com` — that label is Zoom's own `/users/me` answering our bearer token, so the code-for-token exchange (which is where the secret is used) and an authenticated API call both succeeded. `meetings` and `recordings` answer 200 with an empty list, the account having neither. Still unrun: `create_zoom_meeting`, the hand. |
| **Slack** | 2026-09-07 | **Proven end to end, including the secret and the scopes — by the first connect, because no probe could.** Pair stored (29 and 32 characters, BOM-free both sides), shipped, api restarted; both probes were run and both are structurally incapable (see the recipe above). Then the operator pressed «اتصال»: `status: connected`, `account_label: neurai.git.acc @ neurai`, and `channels` answers 200 with three real channels — `#social`, `#new-channel`, `#all-neurai`. That last reading is the one that settles the open question: **the seven scopes went under User, not Bot** — a bot-token grant would have connected and then listed none. `mentions` answers 200 with an empty list (`search:read` reached the endpoint; the account has no mentions). |
| **GitHub** | 2026-09-07 | **Secret proven at the token endpoint; the app TYPE wants a look.** Pair stored (20 and 40 characters, BOM-free both sides), shipped, api restarted, `configured: true`. The triple discriminated three distinct ways (above), so the pair is real. **But the client id has the `Ov23li…` shape of a GITHUB APP, not an OAuth App** — the probe cannot tell those apart (both use the same endpoint, and the authorize URL 302s to `/login` either way), so this is an observation about the id's format, not a measurement. It matters: a GitHub App IGNORES the `scope` parameter we send (`repo read:user user:email`) and grants only the permissions configured on the app, only on repositories where it is INSTALLED — so `issues`/`pulls`/`repos` can come back empty from a connection that succeeded. If the console shows it under **GitHub Apps**, either install it on the repositories that should be visible, or create an OAuth App instead. |
| **Notion** | 2026-09-07 | **Secret proven at the token endpoint.** Pair stored (36 and 50 characters, BOM-free both sides), shipped, api restarted, `configured: true`. The triple discriminated: the real pair got past authentication and was refused for the CODE alone ("Auth code must be a valid UUID" — Notion's codes are UUIDs, ours was not), while both wrong credentials answered `401 invalid_client`. Not yet connected; the pages and databases a connection sees are the ones the person shares with the integration on Notion's own consent screen. |
| **Dropbox** | 2026-09-07 | **Secret proven at the token endpoint.** Pair stored (15 and 15 characters, BOM-free both sides), shipped, api restarted, `configured: true`. The triple discriminated: real pair → `invalid_grant` "code doesn't exist or has expired", both wrong credentials → `invalid_client`. Not yet connected. |
| **Jira** | 2026-09-07 | **Deployment half only — the secret is UNPROVEN and cannot be probed.** Pair stored (32 and 76 characters, BOM-free on both sides of the wire), shipped to `/etc/neurai/core.env` (20 entries), api restarted, health 200. `GET /api/connectors` reports `configured: true, status: not_connected`; on the shelf «جیرا» is a `<button>` reading «وصل نشده» while «نوشن», unconfigured, is a plain `<div>` reading «روی سرور پیکربندی نشده» — the discriminating pair in one reading. Both probes were run and both are structurally incapable, the authorize one not even refusing a wrong redirect. The first «اتصال» is the first real test — of the secret, of the redirect URL, and of whether the five permissions were granted on the app. |

## Live proof still owed

Each connector's adapter is tested against the provider's documented
response shapes (`core/test/connector-providers.test.ts`). **A live
prove-at-acceptance run needs a real grant on each provider**, which needs
the OAuth apps above to be created by the operator (the credentials are the
operator's to mint) or a real bot token / WhatsApp number / MCP server.
Record each run here when it happens: provider, date, what was listed, what
the hand created.

Where it stands: Google, Zoom and Slack have real grants and have LISTED;
Jira, GitHub, Notion and Dropbox are configured and unconnected, and of those
four only Jira's secret is unproven (its probes cannot discriminate).
**No hand has been run on any connector yet** — `create_zoom_meeting` and
`send_slack_message` are the two that could be run today, and each writes
something a person will see, so each waits for the operator's word rather
than being fired to tick a box.
