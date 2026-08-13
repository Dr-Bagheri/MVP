/**
 * Types mirroring the SPEC objects one-for-one. When core/ lands, these are
 * replaced by the generated/shared contract — screens never change because
 * everything goes through src/api/client.ts.
 *
 * Naming follows the schema shape in ARCHITECTURE.md (snake_case fields as
 * they cross the wire; camelCase only where it never leaves the client).
 */

// ---- org & people (M2, M15) -------------------------------------------------

export type OrgStatus = "active" | "suspended";

export interface Org {
  id: string;
  name: string;
  status: OrgStatus;
  /** default scope applied to new calls */
  default_call_scope: CallScope;
}

export type Role = "admin" | "member";
/** M15: self-registration lands in `pending` until an admin accepts. */
export type UserStatus = "pending" | "active" | "disabled";

export interface User {
  id: string;
  org_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: Role;
  status: UserStatus;
  locale: "fa" | "en";
  /** each user picks their own model (M5) */
  model_id: string | null;
  created_at: string;
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

/** A ≤30-minute audio file; parts share ONE call and a continuous timeline. */
export interface CallPart {
  id: string;
  index: number;
  duration_seconds: number;
  /** offset of this part on the call's continuous timeline */
  starts_at_seconds: number;
  audio_url: string;
  /** `echo.part_status` — NOT `CallStatus`; the two enums are different. */
  status: PartStatus;
}

export type TranscriptTiming = "full" | "mixed" | "none";

/**
 * Mirrors `GET /v1/calls` as it actually serves — verified against the live
 * api, not against a spec. Where the two disagreed the WIRE won (rule 10:
 * the producer names the shape), which is why this says `started_at` and
 * `duration_ms` rather than the `created_at`/`duration_seconds` this file
 * used to invent.
 *
 * Fields below the divider are NOT on the wire yet. They are optional rather
 * than deleted because the features reading them are shipped and working:
 * "erase the mocks" removes invented DATA where a wire exists, it does not
 * delete a feature because its endpoint isn't built. Each is in milestone
 * 4's named backend package; `?` here is the honest statement that a live
 * response will not carry them.
 */
export interface Call {
  id: string;
  owner_id: string;
  title: string;
  scope: CallScope;
  status: CallStatus;
  /** language tag; "fa" on the dev rows */
  language: string;
  /** wire name — NOT `created_at` */
  started_at: string;
  /**
   * Milliseconds, and **null on live rows today**. Suspected to be declared
   * and served but never written (the worker maintains per-part durations;
   * something may need to aggregate the call total) — Backend 1 is checking
   * with Backend 2 rather than assuming. Treat null as "unknown", never 0.
   */
  duration_ms: number | null;

  /** where the call came from; "web" on dev rows */
  source: string;
  /**
   * TIMESTAMPS, not booleans — the wire says *when*, which carries strictly
   * more than *whether*. These were never missing from the database; the api
   * shipped a narrower SELECT, so the archive/delete/restore/purge UI was
   * built against real columns the wire simply wasn't sending.
   */
  archived_at: string | null;
  /** soft delete (M11): visible to admins with a purge window */
  deleted_at: string | null;
  purge_after: string | null;
  /** pointer to the current summary — an ID, not a version number */
  current_summary_id: string | null;

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
  /**
   * M6/M20 provenance for the WHOLE call — "full" = every part came off the
   * primary lane, "mixed" = some part fell back, "none" = none has word
   * timing. `null` when no transcript exists yet (queued, failed, deleted):
   * absent is not the same claim as "none", which asserts a transcript that
   * is genuinely prose-only.
   *
   * This replaced a boolean deliberately. The boolean was structurally
   * temptable as a per-row gate — and it caught me: AND-ing it with a row
   * stripped click-a-word from perfectly word-timed rows in a mixed call.
   * An enum has no truthy value to AND against, so that mistake can no
   * longer be written. It is for EXPLAINING provenance only; the authority
   * for whether a row can be clicked word-by-word is that row's own `words`
   * array, and nothing else (see the call detail page).
   */
  transcript_timing: TranscriptTiming | null;
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

export interface SummaryVersion {
  version: number;
  /** summaries are always Persian (M6 ruling) */
  content: string;
  created_at: string;
  /** provenance: what produced it */
  model_id: string;
  agent_run_id: string;
}

// ---- speakers & directory ---------------------------------------------------

export interface Speaker {
  id: string;
  call_id: string;
  /** display label: "گویندهٔ ۱" until linked */
  label: string;
  /** directory person, once the OWNER links it (M11 privacy ruling) */
  person_id: string | null;
  person_name: string | null;
  /** short snippet for identification */
  sample_start_ms: number;
  talk_seconds: number;
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
export interface AdminModelRow {
  id: string;
  label: string;
  provider: string;
  tool_capable: boolean;
  allowed: boolean;
  suggested: boolean;
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
export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; id: string; name: string; label: string; state: ToolCallState; ms?: number }
  | {
      type: "proposal";
      id: string;
      kind: AgentProposal["kind"];
      summary: string;
      payload: AgentProposalPayload;
    }
  | { type: "done"; runId: string; failed: boolean; error?: string };

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
  /** provenance for every derived artifact */
  model_id?: string;
  streaming?: boolean;
  /** run ended with failed:true, or the stream died without `done` */
  failed?: boolean;
  error?: string;
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
  kind: "transcript" | "summary";
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
