/**
 * The tool wrapper — layer 1 of the scope wall (M4).
 *
 * Every domain tool the agent can reach is constructed HERE, closed over the
 * caller's identity. Pi never receives an unwrapped tool, so there is no path
 * by which a tool executes without an identity attached (invariant 2) or
 * without leaving a step in agent_run (invariant 5).
 *
 * Deliberate shapes:
 * - A denial is a normal tool result, not a thrown error: the model reads it
 *   and adapts ("I can't see that call"), which is what makes the wall usable
 *   rather than a dead end.
 * - Not-found and not-yours return the SAME text. Ownership must not be
 *   probeable through the assistant.
 * - Tools receive `identity`, never raw connection credentials; the data layer
 *   is reached through the caller-scoped handle the factory hands us.
 */
import type { AgentStep, Identity } from "./types.ts";

export class ToolDenied extends Error {}

/** What a domain tool implementation gets. No credentials, no god handle. */
export interface ToolContext<TDeps> {
  identity: Identity;
  deps: TDeps;
  signal?: AbortSignal | undefined;
}

export interface DomainTool<TDeps, TArgs = Record<string, unknown>> {
  name: string;
  label: string;
  description: string;
  /** TypeBox schema (pi-ai re-exports `Type`). */
  parameters: unknown;
  /** Throw ToolDenied for policy refusals; anything else is an error. */
  run(ctx: ToolContext<TDeps>, args: TArgs): Promise<unknown>;
}

export interface WrapOptions<TDeps> {
  identity: Identity;
  deps: TDeps;
  /**
   * Called once per attempt when it RESOLVES — allowed, denied or errored.
   * This is the audit record: one step per completed attempt.
   */
  onStep(step: Omit<AgentStep, "seq">): void | Promise<void>;
  /**
   * Called when execution BEGINS, for the SSE `tool_call` started event.
   * Deliberately separate from onStep so the audit trail keeps exactly one
   * row per attempt while the UI can render a tool as it runs.
   */
  onStart?: ((info: { id: string; tool: string; label: string }) => void) | undefined;
}

const MAX_RESULT_CHARS = 24_000;

/**
 * Wrap domain tools into Pi `AgentTool`s bound to one identity.
 * Returns tools Pi can call and nothing else.
 */
export function wrapTools<TDeps>(
  tools: DomainTool<TDeps, never>[],
  { identity, deps, onStep, onStart }: WrapOptions<TDeps>,
): unknown[] {
  if (!identity.isActive) {
    // M15: a pending or disabled person gets no tools at all. Not an empty
    // result from each tool — no tools, so nothing can be attempted.
    return [];
  }

  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (toolCallId: string, args: unknown, signal?: AbortSignal) => {
      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      onStart?.({ id: toolCallId, tool: tool.name, label: tool.label });
      try {
        const result = await tool.run({ identity, deps, signal }, args as never);
        const text = serialize(result);
        await onStep({
          tool: tool.name, args, outcome: "ok",
          detail: `${text.length}b`, ms: Date.now() - t0, startedAt,
        });
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const denied = error instanceof ToolDenied;
        await onStep({
          tool: tool.name, args,
          outcome: denied ? "denied" : "error",
          // never the message body for unexpected errors — could carry content
          detail: denied ? String(error.message) : errorName(error),
          ms: Date.now() - t0, startedAt,
        });
        return {
          content: [{
            type: "text",
            text: denied ? String(error.message) : "tool failed",
          }],
          isError: true,
        };
      }
    },
  }));
}

function serialize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated]`
    : text;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "UnknownError";
}
