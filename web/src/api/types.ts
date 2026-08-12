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

/** Status column IS the pipeline position (M7). */
export type CallStatus =
  | "queued"
  | "uploading"
  | "transcoding"
  | "transcribing"
  | "diarizing"
  | "summarizing"
  | "ready"
  | "failed";

/** A ≤30-minute audio file; parts share ONE call and a continuous timeline. */
export interface CallPart {
  id: string;
  index: number;
  duration_seconds: number;
  /** offset of this part on the call's continuous timeline */
  starts_at_seconds: number;
  audio_url: string;
  status: CallStatus;
}

export interface Call {
  id: string;
  org_id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  scope: CallScope;
  status: CallStatus;
  duration_seconds: number;
  created_at: string;
  archived: boolean;
  /** soft delete (M11): visible to admins with a 30-day purge window */
  deleted_at: string | null;
  parts: CallPart[];
  /** pointer to the current summary version */
  current_summary_version: number | null;
  /**
   * M6: false when the transcript came from the FALLBACK ASR lane, which
   * emits no word-level timestamps. The view degrades click-a-word to
   * click-a-line and shows a provenance flag; the call is re-transcribed
   * later and the flag clears.
   */
  word_timestamps: boolean;
}

// ---- transcript (SPEC: "This is the record") --------------------------------

export interface TranscriptWord {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface TranscriptRow {
  id: string;
  call_id: string;
  part_index: number;
  start_ms: number;
  end_ms: number;
  /** channel-derived for two-channel audio, diarized otherwise */
  speaker_id: string;
  channel: number | null;
  text: string;
  words: TranscriptWord[];
  /** a corrected line keeps its identity and is marked */
  edited: boolean;
  edited_by: string | null;
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

export interface Skill {
  id: string;
  level: SkillLevel;
  slug: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model_id: string | null;
  editable: boolean;
}

// ---- agent ------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  /** models that cannot call tools are not selectable (SPEC) */
  tool_capable: boolean;
  /** admin allow-list (M5) */
  allowed: boolean;
  /** the steward-maintained suggestion, not a default (M5) */
  suggested: boolean;
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

/** A write the agent inferred: proposed, never applied silently (SPEC/M4). */
export interface AgentProposal {
  id: string;
  kind: "correct_transcript" | "edit_speakers" | "replace_summary";
  summary: string;
  payload: unknown;
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
  | { type: "proposal"; id: string; kind: AgentProposal["kind"]; summary: string; payload: unknown }
  | { type: "done"; runId: string; failed: boolean; error?: string };

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls: AgentToolCall[];
  proposal: AgentProposal | null;
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
  source: "transcript" | "summary";
  start_ms: number | null;
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

export interface GatewayConfig {
  api_key: string;
  webhook_url: string | null;
  docs_url: string;
}
