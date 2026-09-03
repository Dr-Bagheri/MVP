/**
 * SSE bridge for the assistant (M9 streaming).
 *
 * The event vocabulary is a CONTRACT with the frontend session — they built
 * a reducer against it, so the names and shapes here are not free to drift:
 *
 *   session     {id, created}      — FIRST event when the turn has a thread
 *   text_delta  {delta}
 *   tool_call   {id, name, label, state: started|ok|denied|blocked|error, ms?}
 *   proposal    {id, kind, summary, payload}
 *   done        {runId, failed, error?}
 *
 * `session` was ADDED, not changed — an unknown event type is ignorable, so a
 * client built before it keeps working and simply never learns its
 * conversation id. It carries the id because conversations open lazily: a
 * person typing on the hub has no id to send back as `session_id`, so without
 * this every message would start a new conversation. `created` distinguishes
 * "this ask opened a thread" from "you are in the one you named", which is
 * what tells a sidebar whether to insert a row or select an existing one.
 *
 * Two rules the frontend depends on, and the reasons they exist:
 *
 * 1. `done` is ALWAYS the last event, including on failure. Provider errors
 *    arrive in-band (Pi returns normally with an error field), so a failed
 *    run that simply stopped streaming would look like a clean finish. The
 *    client treats stream-end-without-done as a transport failure — which is
 *    only correct if we never drop the stream silently.
 *
 * 2. `denied` and `blocked` are distinct terminal states and both are NORMAL:
 *    denied = the tool's own scope check refused (not your call);
 *    blocked = the central policy vetoed before execution (undeclared tool,
 *    admin-only, budget). Only `error` is a fault. The UI renders the first
 *    two as neutral refusals.
 */
import type { AgentStep } from "../agent/types.ts";

export type SseEvent =
  | { type: "session"; id: string; created: boolean }
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; id: string; name: string; label: string;
      state: "started" | "ok" | "denied" | "blocked" | "error"; ms?: number }
  | { type: "proposal"; id: string; kind: string; summary: string; payload: unknown }
  /**
   * M33: the runtime asks the SURFACE to perform an action (client-executed
   * tool). The browser performs it under the user's own session — via the
   * same code path as the human control — and answers through
   * POST /v1/assistant/tool-result. `requires_consent` means the surface
   * must ask the person before performing. `args` are model-authored and
   * the surface validates them exactly as it validates human input.
   */
  | { type: "client_tool_call"; id: string; tool: string; label: string;
      args: unknown; effect: "ui" | "write"; requires_consent: boolean }
  | { type: "done"; runId: string; failed: boolean; error?: string };

/** Minimal sink so this is testable without a live socket. */
export interface SseSink {
  write(chunk: string): void;
  end(): void;
}

/**
 * The FRAMING, for any named event.
 *
 * `formatSse` below is the assistant's typed door onto this. The rooms
 * surface (db/0164) has its own vocabulary — a room's events are turns and
 * who is taking one, not deltas — and deliberately does not join the union
 * above: widening the assistant's contract to carry a second surface's events
 * is the same mistake 0164 refused when it declined to widen
 * `agent_message_role`. What the two DO share is the wire format, so a fix to
 * the framing lands in one place rather than in whichever copy someone
 * remembers.
 */
export function formatEvent(event: { type: string }): string {
  // `event:` lets EventSource listeners subscribe by name; `data:` carries
  // the same discriminated union the reducer switches on.
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function formatSse(event: SseEvent): string {
  return formatEvent(event);
}

export function createSseStream(sink: SseSink) {
  let closed = false;

  function send(event: SseEvent): void {
    if (closed) return;
    sink.write(formatSse(event));
  }

  return {
    send,
    /** Proxy keep-alive as a comment, not a vocabulary item. */
    keepAlive(): void {
      if (!closed) sink.write(":ka\n\n");
    },
    /**
     * The ONLY way this stream ends. Always emits `done` first, so the
     * client never has to guess whether a silent end meant success.
     */
    finish(result: { runId: string; failed: boolean; error?: string | undefined }): void {
      if (closed) return;
      send({
        type: "done",
        runId: result.runId,
        failed: result.failed,
        ...(result.error ? { error: result.error } : {}),
      });
      closed = true;
      sink.end();
    },
    get isClosed() { return closed; },
  };
}

export type SseStream = ReturnType<typeof createSseStream>;

/** A completed step → its terminal `tool_call` event. */
export function stepToEvent(step: AgentStep, label: string): SseEvent {
  return {
    type: "tool_call",
    id: `${step.seq}`,
    name: step.tool,
    label,
    state: step.outcome,
    ms: step.ms,
  };
}
