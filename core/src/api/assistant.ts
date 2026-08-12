/**
 * The assistant endpoint: POST /v1/assistant/ask (SSE).
 *
 * This is the api half of "one agent runtime serves both situations" (M4) —
 * the same `run()` the worker's summarizer calls, handed the assistant's
 * toolset and streamed to the caller.
 *
 * Failure posture: a run that fails still ends with `done{failed:true}`
 * rather than a dropped stream, because the client cannot distinguish a
 * silent end from a clean finish and must not have to guess. That includes
 * the case where the agent runtime throws before producing any text.
 */
import { createAgentRuntime } from "../agent/runtime.ts";
import { createAgentRunStore } from "../agent/run-store.ts";
import { createSseStream, stepToEvent, type SseSink } from "./sse.ts";
import type { DomainTool } from "../agent/tools.ts";
import type { Db } from "../db/identity.ts";
import type { Identity, Skill } from "../agent/types.ts";

export interface AskRequest {
  identity: Identity;
  /** Already-quoted user text. Content never becomes instructions (M4). */
  question: string;
  /** Resolved skill, when the caller invoked one (/slug). */
  skill?: Skill | undefined;
  /** The caller's model choice (M5: no default is imposed). */
  model?: string | undefined;
  callId?: string | null | undefined;
  signal?: AbortSignal | undefined;
}

export interface AssistantDeps<TDeps> {
  db: Db;
  tools: DomainTool<TDeps, never>[];
  deps: TDeps;
  adminOnlyTools?: ReadonlySet<string> | undefined;
  apiKey?: string | undefined;
}

export function createAssistant<TDeps>(config: AssistantDeps<TDeps>) {
  return {
    /**
     * Streams one assistant turn. Resolves when the stream is closed; never
     * throws for a failed run — the failure rides the `done` event instead,
     * because by then the response has already begun and an HTTP status can
     * no longer be changed.
     */
    async ask(request: AskRequest, sink: SseSink): Promise<void> {
      const stream = createSseStream(sink);
      const labels = new Map(config.tools.map((t) => [t.name, t.label]));

      // Each run records itself as the caller — the store is bound to the
      // identity, so it cannot record under anyone else's.
      const runs = createAgentRunStore({ db: config.db, identity: request.identity });
      const runtime = createAgentRuntime({ runs });

      let seenSteps = 0;
      try {
        const result = await runtime.run({
          identity: request.identity,
          kind: "assistant",
          skill: request.skill,
          callerModel: request.model,
          input: request.question,
          tools: config.tools,
          deps: config.deps,
          callId: request.callId ?? null,
          adminOnlyTools: config.adminOnlyTools,
          signal: request.signal,
          apiKey: config.apiKey,
          onText: (delta) => stream.send({ type: "text_delta", delta }),
          onToolStart: ({ id, tool, label }) =>
            stream.send({ type: "tool_call", id, name: tool, label, state: "started" }),
        });

        // Terminal tool_call events, in the order the steps were recorded.
        // (The runtime hands back the same steps it wrote to agent_run, so
        // what the UI saw and what the audit holds cannot disagree.)
        for (const step of result.steps.slice(seenSteps)) {
          stream.send(stepToEvent(step, labels.get(step.tool) ?? step.tool));
          seenSteps += 1;
        }

        stream.finish({
          runId: result.runId,
          failed: result.failed,
          error: result.error,
        });
      } catch (error) {
        // Thrown before/instead of a result — e.g. an inactive actor slipping
        // past the route guard. The stream still ends properly.
        stream.finish({
          runId: "",
          failed: true,
          error: error instanceof Error ? error.message : "assistant failed",
        });
      }
    },
  };
}
