# The agents' tools: what the structure is today, and the shape proposed

A PROPOSAL (2026-09-18), the user's to decide. Nothing here is built. The
facts in §1 were read from the tree that day; the proposal in §2 is what
would make the tool surface one thing written once.

## 1. What is there today

125 model-facing tools in three registries with three shapes:

| Registry | Count | Shape | Naming |
|---|---|---|---|
| `core/src/agent/domain-tools.ts` | 6 | `name`, Persian-only `label`, `description`, TypeBox `parameters`, `run` | verb_object |
| `core/src/agent/platform-tools.ts` | 21 | the same | verb_object, plus `whoami` |
| `core/src/agent/client-tools.ts` | 98 | `name`, `label {fa,en}`, `description`, PLAIN JSON-schema `parameters`, `effect: "ui" \| "write"`, no `run` (the browser performs it) | verb_object; 19 ui / 79 write |

Plus `ask_<handle>` per colleague (`delegation.ts`) and a third vocabulary
for connector actions (`connector-providers.ts`: `send_message`,
`create_issue`, …) that the web maps to client tool names by hand
(`CONNECTOR_HANDS`).

**The same 125 names are restated by hand in at least eight places**, each
kept aligned by a string-equality test rather than by derivation:

1. `web/src/lib/agentSurface.ts` `SURFACE_TOOLS` — 98 names typed out.
2. the same file's `executeClientTool` — 98 `case` labels.
3. `web/src/lib/clientToolRunner.ts` `NAMING` — 46 per-tool entries that say
   which argument the consent card names; the other 33 write tools fall to
   a "first name-like field" guess.
4. `web/src/lib/consentGrant.ts` `NEVER_COVERED` — twelve regexes over the
   NAME (`/^delete_/`, `/^send_/`, …) that decide what the session-wide yes
   may cover. The server never learns this list.
5. `core/src/api/server.ts` `ROOM_TOOLS` — ten magic strings, no test.
6. `core/src/agent/platform-map.ts` `AREAS` — nine areas as regex stems
   over names, for the prompt's map.
7. `web/src/components/platform/agentCapabilities.ts` `CAPABILITY_GROUPS` —
   eleven hand-written groups for the agents page, checked in one
   direction only (a new tool lands under «other» silently).
8. `web/src/messages/{fa,en}.json` `agents.tool.*` — 125 sentences ×2,
   re-derived by `toolCopy.guard` through a regex over an allow-list of
   file NAMES that still includes `write-tools.ts`, deleted on 2026-09-06.

And the tool names appear in PROSE three times — `DEFAULT_ASSISTANT_PROMPT`
(`runtime.ts`), the colleagues' stored instructions (`db/0193`), and
`colleagueBriefing()` (`delegation.ts`) — so a rename can leave a prompt
naming a tool that no longer exists, and no test reads prose.

**Authority is a name, not a property.** No server tool carries a tier;
the only declared property is the client tools' `effect: "ui" | "write"`.
Whether a yes may stand for the session is decided in the BROWSER by name
prefix, so tools whose effect leaves the building but do not match a prefix
are covered by one standing yes today: `export_meeting_minutes` (its own
comment says "a FILE leaves the building"), `create_jira_issue`,
`create_github_issue`, `create_notion_page`, `create_zoom_meeting`,
`create_person`. `adminOnlyTools` is plumbed from `server.ts` through
`assistant.ts` into `runtime.ts` and populated by exactly one caller — a
test.

**Two spellings of one thing:** `whoami` / `whoami_surface`; `list_members`
/ `list_colleagues`; `get_call` / `open_call` / `list_records` /
`rename_record` for one object; `DOMAIN_TOOL_NAMES` hand-listed beside two
sibling lists that are derived. **One tool is theatre:** `start_recording`
is declared, advertised, grouped and given copy, and its executor always
answers "I can't start a recording on my own".

## 2. The shape proposed

**One manifest, everything else derived.** A single `ToolSpec` shared by
core and web:

```
name          verb_object, where verb ∈ {list, get, create, update, delete,
              archive, restore, set, send, open, export, ask} and object is
              one word from ONE object vocabulary (record, not call;
              colleague, not member)
area          one of the nine areas — replaces AREAS' regex stems and the
              agents page's eleven hand groups
side          "server" | "client"
scope         "org" | "record" | "admin" — what the rows it reads are walled
              by; ROOM_TOOLS becomes `side=server && scope=org && effect=read`,
              which is the sentence the 2026-09-05 record already says in prose
effect        "read" | "ui" | "write" | "external" | "destructive" — the TIER,
              declared, on server tools as well
consent       derived from effect: read/ui → none; write → once, session-
              coverable; external/destructive → every time (NEVER_COVERED
              becomes a property, and the server can refuse a client's claim
              of a standing yes for a destructive tool — defence in depth)
admin         boolean — the producer `adminOnlyTools` never had
label, description   {fa, en} on every tool, so the locale files stop being
              a second registry (or are GENERATED from the manifest)
params        TypeBox everywhere; the JSON schema the client sends is derived
names         which argument the consent card names (replaces NAMING and the
              guess), and the id+title pair for the 2026-09-06 rule
```

From that one table: `SURFACE_TOOLS` is `manifest.filter(side === "client")`;
the executor is a `Record<ClientToolName, fn>` whose completeness the
compiler checks, not a 98-case switch; `CAPABILITY_GROUPS` and the prompt's
`PLATFORM_MAP` are `groupBy(area)`; `ROOM_TOOLS` is a filter; the consent
classes are a property; the agents page reads the manifest; the prompts'
tool paragraphs are RENDERED from it at run time rather than typed into
three places; connector hands are generated from each `ProviderDef`'s
actions rather than mapped by hand.

**Migration, incremental and safe:** add the new fields with values derived
ONCE from today's prefixes and lists, hand-review the handful that
disagree (the six external tools above are the first), then move one
consumer at a time onto the manifest behind the existing equality tests —
they are the safety net until each is retired. Delete `start_recording`
from the advertised set or make it true; drop the `write-tools.ts` entry.

**What it buys:** a tool is added in one file and appears everywhere with
its tier, its group, its copy keys and its consent rule; a rename cannot
strand a prompt, a room, a group or a card; and the standing yes covers
exactly what the manifest says it covers, on both sides of the wire.
