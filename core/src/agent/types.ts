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

export interface AgentRunRecord {
  id: string;
  orgId: string;
  actorId: string;
  callId: string | null;
  skillId: string | null;
  kind: AgentRunKind;
  status: "running" | "succeeded" | "failed";
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
    status: "succeeded" | "failed";
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
}
