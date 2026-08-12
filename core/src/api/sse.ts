/**
 * SSE bridge for the assistant (M9 streaming).
 *
 * The event vocabulary is a CONTRACT with the frontend session — they built
 * a reducer against it, so the names and shapes here are not free to drift:
 *
 *   text_delta  {delta}
 *   tool_call   {id, name, label, state: started|ok|denied|blocked|error, ms?}
 *   proposal    {id, kind, summary, payload}
 *   done        {runId, failed, error?}
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
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; id: string; name: string; label: string;
      state: "started" | "ok" | "denied" | "blocked" | "error"; ms?: number }
  | { type: "proposal"; id: string; kind: string; summary: string; payload: unknown }
  | { type: "done"; runId: string; failed: boolean; error?: string };

/** Minimal sink so this is testable without a live socket. */
export interface SseSink {
  write(chunk: string): void;
  end(): void;
}

export function formatSse(event: SseEvent): string {
  // `event:` lets EventSource listeners subscribe by name; `data:` carries
  // the same discriminated union the reducer switches on.
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
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
