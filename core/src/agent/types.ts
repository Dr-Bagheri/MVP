/**
 * Agent runtime types — the vocabulary of M4.
 *
 * The runtime holds no authority of its own (invariant 3). Everything it may
 * do is bounded by an `Identity` it is handed, and every tool it can call is
 * built through the wrapper in `tools.ts`.
 */

/** Who a run acts as. Never a service account (M3/M4). */
export interface Identity {
  /** echo.app_user.id — the value the connection factory SET LOCALs. */
  userId: string;
  orgId: string;
  role: "admin" | "member";
  /** Active users only; a pending/disabled person cannot run an agent (M15). */
  isActive: boolean;
  /**
   * Present only when `isActive` is false, and purely so the api can tell the
   * caller WHICH refusal this is — the three lead to different screens and,
   * for "suspended", to a different person to contact.
   *
   * Never a capability: nothing anywhere is permitted because of a value
   * here. `isActive` is the gate; this explains it.
   */
  inactiveReason?: "pending" | "suspended" | "disabled";
}

export type AgentRunKind = "assistant" | "summarizer";

/** A skill is data: prompt + model + tool list (M4, echo.skill). */
export interface Skill {
  id: string;
  level: "system" | "org" | "user";
  slug: string;
  name: string;
  description: string;
  prompt: string;
  /** NULL in the DB = use the caller's chosen model (M5: no imposed default). */
  model: string | null;
  tools: string[];
  enabled: boolean;
  /**
   * Per-skill tool-call ceiling (steward ruling): the summarizer can carry
   * its own. NULL/absent = the runtime default. Tune from agent_run.steps,
   * not from vibes.
   */
  maxToolCalls?: number | null;
}

/** One recorded tool interaction — an element of echo.agent_run.steps. */
export interface AgentStep {
  seq: number;
  tool: string;
  args: unknown;
  /** "ok" | "denied" | "blocked" | "error" — denied/blocked are policy outcomes. */
  outcome: "ok" | "denied" | "blocked" | "error";
  /** Short, non-content summary for the audit trail (no transcript text). */
  detail?: string;
  ms: number;
  startedAt: string;
}

/**
 * The values of `echo.agent_run_status` (db/0001), NOT a vocabulary of ours.
 *
 * This union used to read `running | succeeded | failed`, which no database
 * has ever accepted: every terminal write threw `22P02 invalid input value
 * for enum`, so every agent run inserted as `running` and could never leave.
 * Invariant 5 — runs are replayable — was false in practice, and the audit
 * trail recorded starts with no endings.
 *
 * Seven green run-store tests never saw it: **a fake cannot disagree with a
 * schema.** `test/agent-run-status.live.test.ts` closes that by reading
 * `pg_enum` on a real connection, so the two can never drift again without a
 * test failing (rule 10: the boundary shape comes from the producer, and the
 * producer here is the catalogue).
 *
 * TypeScript adopted the schema's labels rather than the reverse: the enum is
 * deployed through 22 migrations and `ok`/`error` are exactly what it means.
 */
export { AGENT_RUN_STATUSES, type AgentRunStatus } from "../api/vocabulary.ts";
import type { AgentRunStatus } from "../api/vocabulary.ts";

export interface AgentRunRecord {
  id: string;
  orgId: string;
  actorId: string;
  callId: string | null;
  skillId: string | null;
  kind: AgentRunKind;
  status: AgentRunStatus;
  model: string;
  request: unknown;
  steps: AgentStep[];
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
}

/** Where agent_run rows go. The runtime never writes SQL itself. */
export interface AgentRunStore {
  begin(run: Omit<AgentRunRecord, "id" | "status" | "steps" | "tokensIn" | "tokensOut" | "error">): Promise<string>;
  appendStep(runId: string, step: AgentStep): Promise<void>;
  finish(runId: string, outcome: {
    /** Terminal only — `running` is what begin() wrote. */
    status: Exclude<AgentRunStatus, "running">;
    tokensIn?: number | null;
    tokensOut?: number | null;
    error?: string | null;
  }): Promise<void>;
}

/** Result of one agent run. */
export interface AgentResult {
  runId: string;
  text: string;
  model: string;
  steps: AgentStep[];
  /** True when the provider failed and the run degraded (M6 degrade-and-flag). */
  failed: boolean;
  error?: string;
  /**
   * Set when the run SUCCEEDED but lost a capability it was meant to have —
   * currently: tools were offered and none was called (M21's loud-forfeit
   * clause). Distinct from `failed`: the output is real and usable, it was
   * just produced with less than intended, and that must be visible rather
   * than inferred from an absence.
   */
  degraded?: string;
}
