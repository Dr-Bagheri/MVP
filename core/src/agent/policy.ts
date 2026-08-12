/**
 * The central veto — layer 2 of the scope wall (M4).
 *
 * Phase-0 spike finding: Pi ships no permission system, but it does ship the
 * mount points for one — `beforeToolCall` fires for EVERY tool call before
 * execution, and returning `{block:true}` stops it dead (the loop hands the
 * model an error result it can read). That gives us a single place to enforce
 * cross-cutting rules without wrapping each tool twice.
 *
 * What belongs here (cross-cutting, tool-independent):
 * - the skill's declared tool list — a skill may only call what it declares
 * - role gates (admin-only tools)
 * - run-wide budgets, so a loop can't grind forever
 *
 * What does NOT belong here: row-level scoping. That lives in the tool
 * wrapper and, beneath it, in RLS. Defense in depth means each layer assumes
 * the others might be wrong.
 *
 * Termination, deliberately: EVERY attempt counts against the budget —
 * allowed or blocked. Counting only successes would let a model grinding
 * against denials (spamming an undeclared or admin-only tool) loop without
 * ever exhausting anything. A separate, tighter cap on consecutive refusals
 * ends that pattern fast and sets Pi's `terminate` hint so the run stops
 * deterministically instead of burning the turn ceiling.
 */
import type { AgentStep, Identity } from "./types.ts";

export interface PolicyDecision {
  block?: boolean;
  reason?: string;
  /** Pi honours this when every result in the batch sets it. */
  terminate?: boolean;
}

export interface PolicyOptions {
  identity: Identity;
  /** Tools the resolved skill declared. Empty/undefined = no restriction. */
  allowedTools?: string[] | undefined;
  /** Tools only an admin may call. */
  adminOnlyTools?: ReadonlySet<string> | undefined;
  /** Ceiling on TOTAL attempts (allowed + blocked). */
  maxToolCalls?: number | undefined;
  /** Ceiling on blocked attempts alone — ends a denial-grind early. */
  maxBlockedAttempts?: number | undefined;
  onStep(step: Omit<AgentStep, "seq">): void | Promise<void>;
}

export const DEFAULT_MAX_TOOL_CALLS = 24;
export const DEFAULT_MAX_BLOCKED_ATTEMPTS = 8;

export function createPolicy({
  identity,
  allowedTools,
  adminOnlyTools = new Set<string>(),
  maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
  maxBlockedAttempts = DEFAULT_MAX_BLOCKED_ATTEMPTS,
  onStep,
}: PolicyOptions) {
  let attempts = 0;
  let blocked = 0;
  const declared = allowedTools && allowedTools.length > 0 ? new Set(allowedTools) : null;

  return async function beforeToolCall(
    ctx: { toolCall: { name: string }; args: unknown },
  ): Promise<PolicyDecision | undefined> {
    const name = ctx.toolCall.name;

    const block = async (reason: string, terminate = false): Promise<PolicyDecision> => {
      blocked += 1;
      await onStep({
        tool: name, args: ctx.args, outcome: "blocked",
        detail: reason, ms: 0, startedAt: new Date().toISOString(),
      });
      // once the grind cap is hit, every further refusal asks Pi to stop
      const stop = terminate || blocked >= maxBlockedAttempts;
      return stop ? { block: true, reason, terminate: true } : { block: true, reason };
    };

    // every attempt counts, refused ones included
    attempts += 1;
    if (attempts > maxToolCalls) {
      return block(`tool-call budget exhausted (${maxToolCalls})`, true);
    }
    if (blocked >= maxBlockedAttempts) {
      return block(`too many refused tool calls (${maxBlockedAttempts})`, true);
    }

    if (!identity.isActive) return block("account is not active");
    if (declared && !declared.has(name)) {
      return block(`tool "${name}" is not in this skill's tool list`);
    }
    if (adminOnlyTools.has(name) && identity.role !== "admin") {
      // same shape as any other refusal — capability isn't probeable
      return block(`tool "${name}" is not available`);
    }
    return undefined;
  };
}

/**
 * Token economy (steward ruling): hand Pi only the tools the skill declared,
 * so the model never spends a turn discovering a wall. This is an
 * OPTIMIZATION — `createPolicy` still blocks anything undeclared, and the
 * enforcement must never depend on this filter having run.
 */
export function filterDeclaredTools<T extends { name: string }>(
  tools: T[],
  allowedTools: string[] | undefined,
): T[] {
  if (!allowedTools || allowedTools.length === 0) return tools;
  const declared = new Set(allowedTools);
  return tools.filter((tool) => declared.has(tool.name));
}
