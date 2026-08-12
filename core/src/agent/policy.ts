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
 * - run-wide budgets (tool-call ceiling), so a loop can't grind forever
 *
 * What does NOT belong here: row-level scoping. That lives in the tool
 * wrapper and, beneath it, in RLS. Defense in depth means each layer assumes
 * the others might be wrong.
 */
import type { AgentStep, Identity } from "./types.ts";

export interface PolicyDecision {
  block?: boolean;
  reason?: string;
}

export interface PolicyOptions {
  identity: Identity;
  /** Tools the resolved skill declared. Empty/undefined = no restriction. */
  allowedTools?: string[] | undefined;
  /** Tools only an admin may call. */
  adminOnlyTools?: ReadonlySet<string> | undefined;
  /** Hard ceiling on tool calls per run. */
  maxToolCalls?: number | undefined;
  onStep(step: Omit<AgentStep, "seq">): void | Promise<void>;
}

export const DEFAULT_MAX_TOOL_CALLS = 24;

export function createPolicy({
  identity,
  allowedTools,
  adminOnlyTools = new Set<string>(),
  maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
  onStep,
}: PolicyOptions) {
  let calls = 0;
  const declared = allowedTools && allowedTools.length > 0 ? new Set(allowedTools) : null;

  return async function beforeToolCall(
    ctx: { toolCall: { name: string }; args: unknown },
  ): Promise<PolicyDecision | undefined> {
    const name = ctx.toolCall.name;
    const block = async (reason: string): Promise<PolicyDecision> => {
      await onStep({
        tool: name, args: ctx.args, outcome: "blocked",
        detail: reason, ms: 0, startedAt: new Date().toISOString(),
      });
      return { block: true, reason };
    };

    if (!identity.isActive) return block("account is not active");
    if (declared && !declared.has(name)) {
      return block(`tool "${name}" is not in this skill's tool list`);
    }
    if (adminOnlyTools.has(name) && identity.role !== "admin") {
      // same shape as any other refusal — capability isn't probeable
      return block(`tool "${name}" is not available`);
    }
    calls += 1;
    if (calls > maxToolCalls) {
      return block(`tool-call budget exhausted (${maxToolCalls})`);
    }
    return undefined;
  };
}
