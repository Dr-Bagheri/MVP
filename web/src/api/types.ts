/**
 * Types mirroring the SPEC objects one-for-one. When core/ lands, these are
 * replaced by the generated/shared contract — screens never change because
 * everything goes through src/api/client.ts.
 *
 * Naming follows the schema shape in ARCHITECTURE.md (snake_case fields as
 * they cross the wire; camelCase only where it never leaves the client).
 *
 * Shapes core/ publishes are IMPORTED from `@echo/core/wire` rather than
 * mirrored here — `import type` is fully erased, so no database driver reaches
 * the browser bundle (FE3 confirmed with a real `next build`, and that is why
 * `vocabulary`'s runtime arrays are also safe while `wire` must stay
 * type-only). Consumers keep importing from `@/api/types` and never learn the
 * difference.
 */
import type {
  AgentCard, CalendarPreference, CallPart, CallSummary, ConnectorItem,
  ConnectorProvider, ConnectorSourceKind, ConnectorStatus, OrgRecord, WorkflowCard,
  PlatformAuditEntry, PlatformOrganization, PlatformOverview, PlatformPage, PlatformUser,
} from "@echo/core/wire";

/** Core-owned M30 wires: these names are aliases, not browser-side copies. */
export type { AgentCard, ConnectorItem, ConnectorProvider, ConnectorSourceKind, ConnectorStatus, WorkflowCard };
export type { PlatformAuditEntry, PlatformOrganization, PlatformOverview, PlatformPage, PlatformUser };

// ---- org & people (M2, M15) -------------------------------------------------

export type OrgStatus = "active" | "suspended";

/**
 * **`Org` IS `OrgRecord`** — an alias, not a mirror, for the same reason
 * `Call` now extends `CallSummary`.
 *
 * The hand-written version carried `default_call_scope`, which is not a column
 * and is not on this wire. It was the fourth invented field of the week, and
 * the most expensive kind: `updateOrg` sent it faithfully, core/ ignored it in
 * silence, and the screen reported a saved setting that had never existed.
 *
 * The real shape brings `locale`, `allowed_models` and `created_at` — three
 * fields the product needed and did not know it was already being sent.
 *
 * Kept as a NAME rather than replacing every usage: consumers import `Org`
 * from `@/api/types` exactly as before and get the producer's shape. There are
 * no local-only fields to add, so this is a plain alias where `Call` needed an
 * `extends`.
 */
export type Org = OrgRecord;

/**
 * `echo.member_role` — three values since M23. `owner` is the org's root.
 *
 * It is **not settable through a general member update**: transfer is its own
 * action, so a role picker offers member/admin and shows `owner` as a state
 * rather than an option. A closed set containing it implies it can be
 * assigned, which is what the transfer ruling denies.
 */
export type Role = "member" | "admin" | "owner";

/** Server-side sort keys — deliberately not column names, so the database's
 *  shape never becomes an API contract. */
export type MemberSort = "default" | "name" | "created" | "last_seen" | "status";

export interface MemberStats {
  /**
   * The PRODUCER's shape (core members.ts), adopted verbatim after the tiles
   * rendered "undefined" in production: this type used to declare flat
   * `total/active/inactive` while core has always sent `counts.{pending,
   * active,disabled,total}` — a local type is a claim about someone else's
   * data, and nothing checked it until the live screen did.
   */
  counts: { pending: number; active: number; disabled: number; total: number };
  /**
   * **`history_since: null` means the log was not recording — render "—",
   * never "0".**
   *
   * A zero beside a non-null `history_since` is a true zero: nothing changed
   * in the window. A zero derived from a log that did not exist is a
   * fabricated delta reached by honest arithmetic, which is the more
   * dangerous kind — it is the only number on the tile a person would act on,
   * and it looks exactly like a measurement.
   *
   * Same kinds-of-nothing split as `last_seen_at`, and the API keeps them
   * distinct precisely so the UI can. Every org is in the null case today.
   */
  trend: {
    window_days: number;
    activated: number;
    disabled: number;
    joined: number;
    history_since: string | null;
  } | null;
}
/** M15: self-registration lands in `pending` until an admin accepts. */
export type UserStatus = "pending" | "active" | "disabled";

export interface User {
  id: string;
  org_id: string;
  /**
   * The handle, unique within the org — **`null` until chosen, and clearable
   * afterwards** (core/'s `MemberRecord.username: string | null`).
   *
   * It was `string` here, which is a type declaring that a state the wire
   * produces cannot exist. The whole point of M24 round 1's null-clears rule
   * is that "I have no handle" is expressible; a non-nullable mirror makes the
   * very feature being built unrepresentable in the type describing it.
   *
   * Renderers must guard: an `@` followed by nothing is not a handle.
   */
  username: string | null;
  /**
   * Served by `GET /v1/me` and the members read — `MemberRecord` declares it
   * non-optional, so this is `string` rather than `string?`. The avatar
   * menu's identity header needs name AND email, which is why this gap was
   * the one blocking a shipped requirement rather than a latent one.
   */
  email: string;
  display_name: string;
  /**
   * A Latin-script name the person chose for themselves. **Optional because
   * the wire does not carry it yet** (B1 wires it after B3's migration), and
   * optional afterwards too — plenty of people have exactly one name.
   *
   * When absent, the English UI shows `display_name` unchanged. That is the
   * ruled fallback and it is a kinds-of-nothing call: an absent English name
   * is *absent*, not *derivable*. Transliterating would invent a spelling
   * they never chose and render it as confidently as one they did; blanking
   * would erase them. Showing their one name is simply accurate.
   *
   * Resolution lives in `lib/format.ts`'s `personName()` — one rule, one
   * implementation, because two would drift and each would look right alone.
   */
  display_name_en?: string | null;
  avatar_url: string | null;
  role: Role;
  status: UserStatus;
  /**
   * **Optional here because the MEMBERS list does not carry it.** Preferences
   * live on core/'s `MeRecord`, not `MemberRecord`, and this one type serves
   * both reads — so `?` is the honest statement that a member row has no
   * preference fields, not a claim that the value can be unset. See `Me`
   * below, which is what `/v1/me` actually returns.
   *
   * `string`, not `"fa" | "en"`: core/ validates by SHAPE, so `en-GB` is a
   * legal stored value. A two-member union here would make a real preference
   * unrepresentable — the same mistake `username: string` was.
   *
   * Distinct from the ROUTING locale, which is fa|en and comes from the URL.
   */
  locale?: string;
  /** each user picks their own model (M5) */
  model_id: string | null;
  created_at: string;
  /** set when an admin accepts them (M15); null while pending */
  accepted_at?: string | null;
  /**
   * Last activity, written by core/'s identity path. **Null is "not seen
   * yet", never a dash** — a dash reads as "nothing to show" where the truth
   * is "this person has never signed in", which is a fact worth stating.
   *
   * Deliberately does NOT move for gateway-key traffic: a polling
   * integration must not make its owner look permanently online. So a "last
   * action" column built on this is about the PERSON, not their machines —
   * including it would be a lie about someone assembled from a robot's
   * behaviour.
   */
  last_seen_at?: string | null;
}

/**
 * What `GET /v1/me` returns: a member row PLUS the things only the person
 * themselves gets to see — their preferences and their model choice.
 *
 * A separate type rather than three more optionals on `User`, because the
 * difference is real: core/ puts these on `MeRecord`, not `MemberRecord`, so a
 * members-list row genuinely does not have them. Left optional on `User` alone,
 * every consumer would write `me.calendar ?? "auto"` — and that `??` silently
 * covers "this payload never carried it", which is how a preference that failed
 * to load renders as the default and looks like a choice the person made.
 *
 * **None of the three is nullable, and that is load-bearing.** `auto` IS the
 * reset, so there is no unset state to spell; core/ rejects `null` outright
 * (`calendar_unknown` / `timezone_unknown`). Typing them `string | null` here
 * would reintroduce at the client the two-spellings problem B1 removed at the
 * column — two ways to say "default", which is one too many.
 */
export interface Me extends User {
  locale: string;
  calendar: CalendarPreference;
  /** `"auto"` (follow the device, resolved at render) or an IANA zone name. */
  timezone: string;
  /**
   * M36's dial. ABSENT (not "assist") when the deployment predates db/0073 —
   * the Settings control renders the default but must not claim it is stored.
   */
  autonomy?: "watch" | "assist" | "act";
}

// ---- calls (SPEC "Call") ----------------------------------------------------

export type CallScope = "private" | "org";

/**
 * Status column IS the pipeline position (M7). These are the six values of
 * `echo.call_status` (db/0001), published by core/ as `CALL_STATUSES`.
 *
 * Per-part work — transcode → vad → transcribe → diarize — happens INSIDE
 * `processing`; the call-level status does not decompose it. There is no
 * `transcribing` and no `diarizing`, however reasonable those sound.
 * `linking` is link-speakers ACROSS all parts, so a call that has reached it
 * necessarily has every part transcribed.
 *
 * core/ types this as `string` on the wire on purpose, so that a later
 * migration adding a status cannot crash a client. This union is for
 * ergonomics only — consumers must still degrade gracefully on a value they
 * do not know, rather than assuming the list is exhaustive forever.
 */
export type CallStatus =
  | "recording"
  | "processing"
  | "linking"
  | "summarizing"
  | "ready"
  | "failed";

/**
 * `echo.part_status` — the per-part DAG, a DIFFERENT enum from `CallStatus`.
 * (`vad_done` is the spelling.)
 *
 * The distinction that matters more than the names: **a part's `failed` is
 * not a call's `failed`.** One failed part is a visible gap in a call that
 * otherwise succeeds (M20), so the call goes `ready`. Anything rendering part
 * status must not promote a part failure into a call failure.
 */
export type PartStatus =
  | "pending"
  | "uploaded"
  | "transcoded"
  | "vad_done"
  | "transcribed"
  | "diarized"
  | "failed";

/**
 * A ≤30-minute audio file; parts share ONE call and a continuous timeline.
 *
 * **Imported, not written.** The hand-written version said `index`,
 * `duration_seconds`, `starts_at_seconds` and `audio_url` against a wire of
 * `idx`, `duration_ms`, `offset_ms` and no url at all — four names wrong and
 * one field invented outright, and it rendered perfectly for weeks because the
 * fixtures were built from the same transcription. core/'s `wire.ts` lists
 * this as the third such invention; importing the shape is what stops there
 * being a fourth.
 *
 * `audio_url` is gone rather than renamed: a client never addresses storage
 * directly (audio is served through the api, which is what keeps the sealed-
 * object rule enforceable), so there was never a url to have.
 */
export type { CalendarPreference, CallPart };

export type TranscriptTiming = "full" | "mixed" | "none";

/**
 * `GET /v1/calls`, **inherited from the producer** rather than mirrored.
 *
 * Every wire field now comes from `CallSummary`. The mirrored copy had already
 * been corrected once by hand (`created_at`→`started_at`,
 * `duration_seconds`→`duration_ms`) after a human read the difference in a
 * message; inheriting means the NEXT rename arrives as a compile error here
 * instead of a runtime `undefined`. `vocabulary.guard.ts` asserts the two still
 * agree, and that assertion was verified red before it was trusted.
 *
 * Two consequences of taking the wire's word for it, both deliberate:
 *
 *  - `status` is `string`, not the `CallStatus` union. core/ types it that way
 *    on purpose so a value added by a later migration cannot crash a client.
 *    The union stays for labels and tones, where an unknown value falls back
 *    to neutral rather than throwing.
 *  - `source` is nullable. It was `string` here, which is the kind of
 *    difference that only surfaces as a blank where a word was expected.
 *
 * `transcript_timing` is inherited too. Keeping the prose because the trap it
 * describes is still live: it is `TranscriptTiming | null`, it EXPLAINS
 * provenance for the whole call, and it must never be used as a per-row gate.
 * A boolean version of this caught me once — AND-ing it with a row stripped
 * click-a-word from perfectly word-timed rows in a mixed call. The authority
 * for whether a row is clickable is that row's own `words` array, nothing else.
 *
 * The three optional fields below are NOT on the wire. They are optional
 * rather than deleted because the features reading them are shipped and
 * working: "erase the mocks" removes invented DATA where a wire exists, it
 * does not delete a feature because its endpoint isn't built. They are named
 * in the guard's `LocalOnly` list, so adding a fourth by accident fails the
 * build rather than quietly re-opening the invent-your-own-shape door.
 */
export interface Call extends CallSummary {
  // ---- still not on the wire (milestone-4 backend package) ----
  /**
   * Deliberately absent and staying that way: denormalising a display name
   * onto every call row goes stale the moment someone renames themselves,
   * with no invalidation path. Resolve `owner_id` against the member list —
   * same reasoning as the gateway keys' acts-as.
   */
  owner_name?: string;
  org_id?: string;
  parts?: CallPart[];
}

/** One annotation on a call (0079): a timestamped note or a named chapter.
 *  `at_ms` null = un-anchored (about the call, not a moment in it). */
export interface CallNote {
  id: string;
  kind: "note" | "chapter";
  at_ms: number | null;
  body: string;
  created_by: string;
  created_at: string;
}

// ---- transcript (SPEC: "This is the record") --------------------------------

/**
 * `w`, not `text` — terse on purpose. Word arrays are the largest payload in
 * the system (thousands per call), so the field name is a real fraction of
 * the bytes. The segment's own prose stays `text`.
 */
export interface TranscriptWord {
  w: string;
  start_ms: number;
  end_ms: number;
}

export interface TranscriptSegment {
  id: string;
  seq: number;
  /**
   * Which part this segment came from. The server knows it; inferring it by
   * comparing `start_ms` against part boundaries would be a client-side
   * reimplementation that mis-groups at exactly the boundary. Ordering comes
   * from `start_ms`/`seq` — this is only for grouping.
   */
  part_id: string | null;
  start_ms: number;
  end_ms: number;
  /**
   * Channel-derived for two-channel audio, diarized otherwise — and **null
   * on the wire** when neither has attributed the segment yet. Verified on a
   * live row. A roster lookup must render "unattributed" for null rather
   * than passing it through and printing `undefined`.
   */
  speaker_id: string | null;
  channel: number | null;
  text: string;
  /**
   * `[]` on a degraded row. THIS is the per-row M20 gate: a row's own words
   * decide whether click-a-word is live — never the call-level
   * `transcript_timing`, which describes the whole call and cannot speak for
   * an individual row.
   */
  words: TranscriptWord[];
  /** a corrected line keeps its identity and is marked */
  edited: boolean;
}

export interface TranscriptResponse {
  call_id: string;
  segments: TranscriptSegment[];
}

// ---- summaries (versioned; a new one never destroys the old) ----------------

/**
 * THE PRODUCER'S names (core/transcripts.ts): `body` and `model`. This type
 * said `content`/`model_id` — two hand-written beliefs about one wire, and
 * the live symptom was surgical: the Version chip rendered (version
 * matched) beside an EMPTY summary (content read undefined). Rule 10's
 * shape, caught by reading the row and the SELECT side by side.
 */
export interface SummaryVersion {
  id: string;
  version: number;
  /** summaries are always Persian (M6 ruling) */
  body: string;
  created_at: string;
  /** provenance: what produced it */
  model: string;
  agent_run_id: string | null;
}

// ---- speakers & directory ---------------------------------------------------

/** A directory person (0062): a name and an org-chart title code. */
export interface Person {
  id: string;
  display_name: string;
  /** Closed vocabulary code ('' = not chosen); the UI localizes it. */
  title: string;
  app_user_id: string | null;
}

export interface Speaker {
  id: string;
  call_id: string;
  /** display label: "گویندهٔ ۱" until linked */
  label: string;
  /** directory person, once the OWNER links it (M11 privacy ruling) */
  person_id: string | null;
  person_name: string | null;
  /** the linked person's title code (0062), null while unlinked */
  person_title?: string | null;
  /** short snippet for identification — null when no timing survived */
  sample_start_ms: number | null;
  /** NOT on the wire: nothing measures per-speaker talk time yet. Optional
   *  so a renderer must face the absence — a required number here is what
   *  painted NaN:NaN on the speakers card. */
  talk_seconds?: number;
}

export interface DirectoryPerson {
  id: string;
  org_id: string;
  name: string;
  /** how many calls this voice has been linked in */
  linked_calls: number;
}

// ---- skills (three levels; stored as data) ----------------------------------

export type SkillLevel = "system" | "org" | "user";

/**
 * `GET /v1/skills` returns `{id, slug, name, description, level}`.
 *
 * **`prompt` is deliberately absent and must stay absent.** A skill's prompt
 * is org configuration; a member who could read it could quote it back at the
 * model. It was on this type and rendered nowhere, which is the only reason
 * its absence costs nothing.
 *
 * `tools` IS included: the assistant stream already emits `tool_call` events
 * naming each tool while a skill runs, so hiding the list in the picker would
 * protect nothing and make the picker less informative than the thing it
 * launches.
 */
export interface Skill {
  id: string;
  level: SkillLevel;
  slug: string;
  name: string;
  description: string;
  /**
   * Kept behind a `?? []` at the render site even though it is not optional
   * here — a field can go absent for reasons other than policy, and a picker
   * showing no chips beats one that crashes.
   */
  tools: string[];
  /** the model this skill pins, or null = the caller's choice (M5) */
  model: string | null;
  /**
   * An AFFORDANCE HINT, not the wall. core/ computes it from `level` plus the
   * caller's role (org → admin only; user → always; system → never) rather
   * than having us re-derive the rule, so there is no hand-written copy of
   * their policy here. db/0013's `skill_org_write` / `skill_user_write` are
   * what actually decide. It is deliberately never a WIDER claim than the
   * policy — if the two disagree, RLS wins and the user gets a refusal, not a
   * silent success. So it may hide a button, and must never be trusted to
   * authorise one.
   */
  editable: boolean;
  /** Suggested opening questions (M29), rendered as hub chips when active. */
  starter_questions: string[];
}

/**
 * The EDITOR's row (M29) — the full definition including the prompt, served
 * only for rows the caller may edit (`/api/skills/manage`). Distinct from
 * `Skill` on purpose: the picker's prompt-off-the-wire posture stands, and a
 * type that carried `prompt?` optionally would blur exactly that line.
 */
export interface AuthoredSkill {
  id: string;
  level: "org" | "user";
  slug: string;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  tools: string[];
  starter_questions: string[];
  enabled: boolean;
  max_tool_calls: number | null;
  archived_at: string | null;
  created_at: string;
}

/**
 * An invitation row (D23–D25): the PREFIX identifies it in a list and can
 * never redeem it; the full token exists once, in `MintedInvitation`, on the
 * issuing response — the api-key show-once contract applied to onboarding.
 */
export interface Invitation {
  id: string;
  email: string;
  role: Role;
  token_prefix: string;
  expires_at: string;
  redeemed_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface MintedInvitation extends Invitation {
  /** Shown once. Not stored, not recoverable, not logged. */
  token: string;
  /** True when the platform emailed the invitation itself (the simple flow —
   *  no token shown to anyone). False carries `email_status` so the UI can
   *  offer the token link as the RESCUE, not the default. */
  emailed: boolean;
  email_status: "sent" | "already_registered" | "send_failed" | "unconfigured";
}

// ---- agent ------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  /** the model advertises reasoning */
  reasoning: boolean;
  /** this is the caller's current pick */
  selected: boolean;
}

/**
 * NOT a wire type — the admin allow-list row, a Phase-A view-model.
 *
 * core/ publishes no admin model-management endpoint yet (`/v1/admin/models`
 * doesn't exist), so the admin screen's allow-list section is mock-fed and
 * known-stale. It is kept separate from `ModelInfo` so the wire type stays
 * honest: `tool_capable`, `allowed`, `suggested` and `provider` are OUR
 * fields here, not core/'s, and none of them should migrate into `ModelInfo`.
 */
/**
 * The curation row — the WIRE's shape now (`GET /v1/admin/models`), not a
 * Phase-A view-model. `tools` is present only when the capability catalogue
 * was readable: absent means "not checked", never "no". Provider is derived
 * from the id at the render site; it is not a field the server owes us.
 */
export interface AdminModelRow {
  id: string;
  name: string;
  allowed: boolean;
  suggested: boolean;
  tools?: boolean;
}

export interface ModelsResponse {
  /** already intersected with the org allow-list by core/ — not our filter */
  models: ModelInfo[];
  /**
   * `null` is a REAL state meaning "has not chosen". M5 imposes no default,
   * so the UI must not pre-select one on the user's behalf — an unchosen
   * model is information, and silently picking one destroys it.
   */
  preferred_model: string | null;
  /** whether an admin has restricted the list. Empty allow-list = the WHOLE catalogue, not none of it. */
  curated: boolean;
  /**
   * Currently always FALSE, and the UI must not claim otherwise.
   *
   * SPEC says models that cannot call tools shouldn't be selectable, but the
   * catalogue carries no such field, and core/ refused to ship a heuristic
   * that would look like enforcement. This codebase used to filter on a
   * `tool_capable` field it invented and told users the list was
   * "tool-capable only" — a safety claim with nothing behind it. Where that
   * fact should come from is with the steward.
   */
  tool_capability_filtered: boolean;
}

/**
 * Backend-specified states. "denied" and "blocked" are DIFFERENT and both are
 * normal outcomes, not errors: denied = the tool's own scope check refused
 * (e.g. not your call); blocked = central policy vetoed before execution
 * (undeclared tool, admin-only, budget). Only "error" is a fault.
 */
export type ToolCallState = "started" | "ok" | "denied" | "blocked" | "error";

export interface AgentToolCall {
  id: string;
  name: string;
  /** human-facing label from core/ (no transcript content) */
  label: string;
  state: ToolCallState;
  ms?: number;
}

/**
 * A write the agent inferred: proposed, never applied silently (SPEC/M4).
 *
 * **Nothing has happened when this arrives.** The tool result the model sees
 * says `awaiting_confirmation`, so the assistant cannot claim it corrected
 * anything — and neither may the UI. Wording like "corrected" before a
 * confirm would be a lie the model itself isn't telling.
 */
export interface AgentProposal {
  id: string;
  /** closed set of three; an unknown kind renders as data, never a crash */
  kind: "correct_transcript" | "edit_speaker_roster" | "replace_summary";
  /** a Persian sentence written for a human — the card's headline */
  summary: string;
  payload: AgentProposalPayload;
}

/**
 * `before`/`after` are a MATCHED PAIR with identical keys per kind —
 * `{text}` for `correct_transcript`, `{label}` for `edit_speaker_roster`,
 * `{version, body}` for `replace_summary`. Same shape on both sides is
 * deliberate: a difference in shape is one the reader has to reconcile
 * before they can compare the values.
 *
 * **These are DISPLAY values and may be excerpted.** The authoritative
 * payload stays server-side and is re-read at confirm, so a 600-character
 * correction shows truncated in the card and applies in full. Never send
 * `after` back as the thing to write — that would silently truncate the
 * change to whatever the card had room for.
 */
export interface AgentProposalPayload {
  call_id: string;
  /**
   * The CURRENT value. Absent only for a first-ever summary, which has
   * nothing to replace. A card rendered without it is asking for consent,
   * not a decision.
   */
  before?: unknown;
  /**
   * The proposed value. **Never absent** — an absent `after` would mean "no
   * change proposed", which is not a state a proposal can be in.
   */
  after: unknown;
  [key: string]: unknown;
}

/**
 * The SSE vocabulary core/ emits, verbatim. The assistant reduces these into
 * message state, so swapping the mock generator for the real EventSource
 * changes transport only — not a line of rendering.
 *
 * `done` is ALWAYS last, including on failure (provider failures surface
 * in-band). A stream that ends without `done` is a TRANSPORT failure and must
 * not be read as success.
 */
/** Phase C: one run's reasoning trace — codes only, arguments never travel. */
export interface RunTrace {
  model: string;
  status: string;
  tokens_in: number | null;
  tokens_out: number | null;
  steps: { tool: string; outcome: string; detail: string; ms: number | null }[];
}

/** Phase C: org agent-governance aggregates. `cards: null` = signals not migrated. */
export interface AgentStats {
  window_days: number;
  runs: { total: number; failed: number; tokens_in: string; tokens_out: string; people: number };
  decisions: { approved: number; rejected: number };
  cards: { delivered: number; read: number } | null;
}

/** M35: an agent-INITIATED card in the proactivity channel (dock). */
export interface AgentCardItem {
  id: string;
  kind: "post_call_brief" | "weekly_digest";
  title: string;
  session_id: string | null;
  created_at: string;
  read: boolean;
}

export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; id: string; name: string; label: string; state: ToolCallState; ms?: number }
  /**
   * M33: the runtime asks THIS surface to perform an action (client-executed
   * tool) — the browser performs it under the user's own session, via the
   * same code path as the human control, and answers through
   * POST /api/assistant/tool-result. `requires_consent` = ask the person
   * first. `args` are model-authored: validate them exactly like human input.
   */
  | { type: "client_tool_call"; id: string; tool: string; label: string;
      args: unknown; effect: "ui" | "write"; requires_consent: boolean }
  | {
      type: "proposal";
      id: string;
      kind: AgentProposal["kind"];
      summary: string;
      payload: AgentProposalPayload;
    }
  /**
   * Sent FIRST, before any delta. Additive to the vocabulary, and safe
   * because the contract is unknown-types-ignorable — an older client that
   * has never heard of it drops it and still renders the answer.
   *
   * `created: false` means the turn joined an existing conversation; `true`
   * means this event is the only place the new id will ever appear. A client
   * that ignores it on a `created: true` turn has just lost the handle to a
   * conversation the server is now persisting.
   */
  | { type: "session"; id: string; created: boolean }
  | { type: "done"; runId: string; failed: boolean; error?: string };

/** A persisted conversation. */
/**
 * MIRRORS core's SessionRecord (sessions.ts) field for field. This type was
 * once hand-written with an invented `updated_at` and a `message_count`
 * nothing produced — the History table rendered the literal string
 * "undefined" (2026-08-20). If core renames a field, change it HERE too;
 * inventing one here is how the last bug happened.
 */
export interface AssistantSession {
  id: string;
  title: string | null;
  last_message_at: string | null;
  archived_at: string | null;
  created_at: string;
  message_count: number;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls: AgentToolCall[];
  proposal: AgentProposal | null;
  /**
   * The `runId` from this message's `done` event. Confirming or rejecting a
   * proposal REQUIRES it, so the reducer must keep it with the message — it
   * is the only state the card carries beyond the proposal itself, and the
   * proposal arrives mid-stream, before the id exists.
   */
  run_id?: string;
  /** the conversation this turn belongs to, from the `session` event */
  session_id?: string;
  /**
   * Shape B: the answer was cut off. Derived from the run's status while the
   * run lives, and **stamped by the database when the run is purged**, so the
   * fact outlives the evidence for it.
   *
   * Optional because it is absent when unreadable — and it must be read as
   * `=== true`, never truthiness. A falsy check would fold "we don't know"
   * into "not truncated", but the inverse is the dangerous one: annotating a
   * COMPLETE answer as cut off tells the reader to distrust something intact,
   * which is worse than staying silent about a real truncation.
   */
  truncated?: boolean;
  /** provenance for every derived artifact */
  model_id?: string;
  streaming?: boolean;
  /** run ended with failed:true, or the stream died without `done` */
  failed?: boolean;
  /**
   * CLIENT-ONLY (never on the wire): the Create chip active when this answer
   * was requested. The toolbar turns it into the promised deliverable —
   * Save as PDF / download — once the answer lands.
   */
  created?: "doc" | "pdf";
}

export interface AgentRun {
  id: string;
  skill_slug: string | null;
  model_id: string;
  started_at: string;
  tokens_in: number;
  tokens_out: number;
  outcome: "ok" | "error";
}

// ---- search -----------------------------------------------------------------

export interface SearchHit {
  call_id: string;
  call_title: string;
  /** "call" = the TITLE matched — a call is findable by name before it has words. */
  kind: "transcript" | "summary" | "call";
  /**
   * null for SUMMARY hits — a summary is about the whole call, and inventing
   * a timestamp for it would be a lie. Drive the seek affordance off
   * `start_ms !== null`, NOT off `kind`: the null is the fact, and `kind` is
   * only the usual reason for it.
   */
  start_ms: number | null;
  end_ms: number | null;
  /**
   * Contains `<mark>` tags and nothing else BY CONSTRUCTION — but it derives
   * from transcript text, which is untrusted input, so it is rendered
   * through a tag whitelist and never via innerHTML (see the search page).
   *
   * Marks are present-or-absent: matching is Persian-folded server-side, and
   * because folding deletes ZWNJ the highlight runs against the RAW text, so
   * a hit that matched only via the fold comes back correct but unmarked.
   * Never re-fold client-side to recover them — a second normalisation rule
   * would drift from the index, which is the exact failure centralising it
   * prevents.
   */
  snippet: string;
}

// ---- connectors & gateway (M17) ---------------------------------------------

export interface Connector {
  id: string;
  name: string;
  category: "chat" | "crm" | "documents" | "calendar" | "storage";
  description: string;
  /** v1: catalogue previews only */
  status: "preview";
}

/**
 * The M17 gateway wire types.
 *
 * Events are a CLOSED set: core/ 400s on an unknown one and names the bad
 * value, because subscribing to a typo would otherwise mean receiving nothing
 * forever and reasonably concluding the feature is broken. Any event picker
 * must therefore be a fixed list, never free text.
 */
export type GatewayEvent = "call.created" | "call.transcribed" | "call.summarized" | "call.failed";

export interface GatewayKey {
  id: string;
  name: string;
  /** six chars for display; the database holds only a sha256 of the token */
  token_prefix: string;
  /**
   * A key names a MEMBER, not the org: it carries exactly that person's
   * permissions and stops working the moment they are disabled, with no
   * rotation needed. Surface it — an admin removing an employee needs to see
   * which integrations die with them. It also means the honest thing to tell
   * a user is "acts as you", never "full API access".
   */
  actor_id: string;
  last_used_at: string | null;
  expires_at: string | null;
  /** revoked, never deleted — the record of what existed survives */
  revoked_at: string | null;
  created_at: string;
  /**
   * db/0022, M17 amendment. Default false, admin-granted, and **fixed at
   * mint**: there is no PATCH on a key and core/'s repo exposes only
   * create/list/revoke. An integration deployed with a read-only key must not
   * silently gain the ability to spend a model budget because someone flipped
   * a toggle, and the audit should read "one credential ended, a different
   * one began" rather than leaving a key whose meaning depends on when you
   * looked. So this is a decision at creation, never a switch in a list.
   */
  allow_assistant: boolean;
}

/**
 * ONLY returned by the create call, and never again — there is no reveal
 * endpoint and there never will be. Whatever consumes this must be a one-way
 * door: show it, offer copy, and make losing it by navigating away
 * unmistakable. If a user loses one, the answer is revoke-and-mint.
 */
export interface GatewayKeyCreated extends GatewayKey {
  token: string;
}

export interface GatewayWebhook {
  id: string;
  url: string;
  events: GatewayEvent[];
  enabled: boolean;
  created_at: string;
}

/** Same once-only rule as the key token. */
export interface GatewayWebhookCreated extends GatewayWebhook {
  secret: string;
}

export interface GatewayDelivery {
  id: string;
  webhook_id: string;
  event: GatewayEvent;
  attempts: number;
  response_code: number | null;
  delivered_at: string | null;
  failed_at: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

/**
 * NOT a wire type — a Phase-A view-model for the connectors screen, which was
 * built against an earlier single-key gateway shape and is now stale: it
 * offers to "reveal" a stored key, which the real API structurally cannot do.
 * Kept only so that frozen screen keeps compiling; it is replaced, not
 * migrated, when the screen is rebuilt against the types above.
 */
export interface GatewayConfig {
  api_key: string;
  webhook_url: string | null;
  docs_url: string;
}

// ---- audit trail (M25, Settings · COMPLIANCE) -------------------------------

/**
 * **Not mirrored — imported.** `AuditEntry` and `AuditSource` come straight
 * from core/'s published `@echo/core/wire`, so there is exactly one spelling
 * of this shape in the repo and a rename upstream is a compile error here.
 *
 * Every other type in this file is a hand-written belief about a wire, which
 * is how `created_at`/`started_at`, `duration_seconds`/`duration_ms` and an
 * invented `audio_url` all shipped green. The audit surface is new, so it has
 * no legacy to migrate and is simply born on the correct side of that line.
 * `export type` is erased at build time — nothing from core/ enters the
 * browser bundle, same construction as `vocabulary.guard.ts`.
 *
 * The runtime companion — the list of source VALUES, which a filter needs and
 * a type cannot provide — is `AUDIT_SOURCES` in `@echo/core/vocabulary`.
 * Imported, not copied, for the same reason: there is no second spelling to
 * keep true.
 */
export type { AuditEntry, AuditSource, AuditPage, AuditCursor } from "@echo/core/wire";

// ---- server health (M25, Management · Server) --------------------------------

/**
 * Imported for the same reason as the audit shapes, and more urgently.
 *
 * This shape's whole point is a THREE-state per metric — `measured` /
 * `not measured` / `unavailable with a reason` — expressed as a nullable
 * `measured_at` beside a nullable value. A hand-written copy of exactly that
 * distinction is the second-hand belief rule 10 exists to prevent, and the
 * distinction is the one a consumer collapses by reflex: `measured_at: null`
 * means we did not find out, and a real zero arrives WITH a timestamp.
 */
export type { ServerHealth, QueueHealth } from "@echo/core/wire";

/**
 * The org row as core/ actually serves it — `{id, name, status, locale,
 * allowed_models, created_at}`.
 *
 * **Additive on purpose.** The hand-written `Org` above declares a
 * `default_call_scope` that is not on this wire, and core's update accepts
 * `name`, `locale` and `allowed_models` and nothing else. Retiring `Org` is
 * FE1's migration (it reaches `mock-data.ts` too) and rides with their `Call`
 * work; this line only lets the org form consume the producer's shape in the
 * meantime, and removes nothing.
 *
 * `status` is read-only by core's own comment, and must never become a
 * control: org status is vendor-only at the guard (D27) precisely because an
 * admin could otherwise brick their own organization irreversibly.
 */
export type { OrgRecord } from "@echo/core/wire";
