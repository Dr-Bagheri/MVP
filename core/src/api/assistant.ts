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
  /** Trusted configuration resolved server-side from the selected M30 agent/workflow. */
  systemInstructions?: string | undefined;
  /**
   * The complete server-recorded prompt used only to regenerate an existing
   * run. Browser clients can never provide this field.
   */
  systemPromptOverride?: string | undefined;
  agentModel?: string | null | undefined;
  allowedTools?: string[] | undefined;
  provenance?: Record<string, unknown> | undefined;
  /** The caller's model choice (M5: no default is imposed). */
  model?: string | undefined;
  callId?: string | null | undefined;
  /** Plural context — the Sources chips. Wins over `callId` when present. */
  callIds?: string[] | undefined;
  /** Web search via the provider's online variant (validated base model). */
  web?: boolean | undefined;
  signal?: AbortSignal | undefined;
  /** The conversation this turn belongs to (M4, db/0018). */
  sessionId?: string | undefined;
  /**
   * True when the ask opened the conversation implicitly.
   *
   * Streamed as the first event so a client that started typing on the hub
   * learns the id it is now in — without it, every message starts a NEW
   * conversation, because the client has nothing to send back as
   * `session_id`. Lazy creation only works if creation is announced.
   */
  sessionCreated?: boolean | undefined;
  /**
   * Called once the run is done, with the assistant's turn. The api uses it
   * to append to the thread; it is a callback rather than a return value
   * because `ask` resolves when the STREAM closes, and the turn must be
   * recorded before that resolution is observed.
   */
  onTurn?: ((turn: { runId: string; text: string; toolCalls: unknown[]; failed: boolean }) => Promise<void>) | undefined;
}

export interface AssistantDeps<TDeps> {
  db: Db;
  tools: DomainTool<TDeps, never>[];
  deps: TDeps;
  adminOnlyTools?: ReadonlySet<string> | undefined;
  apiKey?: string | undefined;
  /** Structured log hook for pre-run failures (codes only, never content). */
  log?: ((fields: Record<string, unknown>) => void) | undefined;
}

/**
 * The interface language rides the ask (user directive, 2026-08-20): the
 * assistant answers in the language the person is READING the product in —
 * the en interface answers in English, fa in Persian. The shipped skill's
 * prompt is Persian-first, so without this an English-interface user gets
 * Persian answers. Appended after agent/workflow instructions so the
 * interface fact wins on LANGUAGE while everything else stands. Unknown
 * values return undefined — additive wire, never a 400.
 */
export function languageInstruction(locale: unknown): string | undefined {
  if (locale === "fa") {
    return "پاسخ را به زبان فارسی بنویس — زبان رابط کاربریِ کاربر فارسی است.";
  }
  if (locale === "en") {
    return "Write your answer in English — the user's interface language is English.";
  }
  return undefined;
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
      /**
       * The turn's text, accumulated from the same deltas the client sees.
       *
       * Taken from the stream rather than re-read from `agent_run` on
       * purpose: what is stored and what was shown are then the same string
       * by construction, and cannot drift into a thread that disagrees with
       * the conversation the person actually had.
       */
      let answer = "";
      const toolCalls: unknown[] = [];

      // Announced before anything else: a client typing on the hub has no id
      // to send back until we give it one (see `sessionCreated`).
      if (request.sessionId) {
        stream.send({
          type: "session",
          id: request.sessionId,
          created: request.sessionCreated === true,
        });
      }
      try {
        const result = await runtime.run({
          identity: request.identity,
          kind: "assistant",
          skill: request.skill,
          systemInstructions: request.systemInstructions,
          systemPromptOverride: request.systemPromptOverride,
          agentModel: request.agentModel,
          allowedTools: request.allowedTools,
          provenance: request.provenance,
          callerModel: request.model,
          input: request.question,
          tools: config.tools,
          deps: config.deps,
          callId: request.callId ?? null,
          callIds: request.callIds,
          web: request.web,
          adminOnlyTools: config.adminOnlyTools,
          signal: request.signal,
          apiKey: config.apiKey,
          onText: (delta) => {
            answer += delta;
            stream.send({ type: "text_delta", delta });
          },
          onToolStart: ({ id, tool, label }) => {
            // Codes only. Arguments quote the transcript the person asked
            // about, and a conversation thread is a far wider surface than
            // the audit screen where the full trace already lives.
            toolCalls.push({ id, name: tool });
            stream.send({ type: "tool_call", id, name: tool, label, state: "started" });
          },
          /**
           * A write tool proposed a change (M4) — the approval card. Streamed
           * as it happens rather than at the end, because the run continues:
           * the model may propose, explain, and keep talking, and the card
           * should appear beside the sentence that motivated it.
           */
          onProposal: (proposal) => stream.send({
            type: "proposal",
            id: proposal.id,
            kind: proposal.kind,
            summary: proposal.summary,
            /**
             * before AND after. I first emitted only `before`, which made the
             * card's whole reason for existing unreachable: a change shown
             * from one side asks for consent while looking like it asks for
             * judgement. The frontend found it by noticing their fixture
             * could never take that branch.
             *
             * Both are DISPLAY values and may be excerpted — the authoritative
             * payload stays server-side and is re-read at confirm, so nothing
             * here can be applied even if a client edited it.
             */
            payload: {
              call_id: proposal.call_id,
              ...(proposal.before === undefined ? {} : { before: proposal.before }),
              ...(proposal.after === undefined ? {} : { after: proposal.after }),
            },
          }),
        });

        // Terminal tool_call events, in the order the steps were recorded.
        // (The runtime hands back the same steps it wrote to agent_run, so
        // what the UI saw and what the audit holds cannot disagree.)
        for (const step of result.steps.slice(seenSteps)) {
          stream.send(stepToEvent(step, labels.get(step.tool) ?? step.tool));
          seenSteps += 1;
        }

        /**
         * Delivery floor: if the run produced text and NONE of it streamed,
         * deliver it whole rather than losing it. This is the branch that
         * would have saved four live "unanswered" questions — the delta
         * bridge matched an event name Pi never sends, so runs finished `ok`
         * with billed tokens while the thread stayed empty. The bridge is
         * fixed; this floor makes the failure mode "answer arrives all at
         * once, loudly logged" instead of "answer vanishes silently"
         * (rule 12: the fallback names itself in observability).
         */
        if (answer.trim() === "" && !result.failed && result.text.trim() !== "") {
          config.log?.({ event: "assistant_text_stream_fallback", runId: result.runId });
          stream.send({ type: "text_delta", delta: result.text });
          answer = result.text;
        }

        /**
         * Record the turn BEFORE finishing the stream.
         *
         * A client that reloads on `done` must find the message already in
         * the thread; appending afterwards is a race it loses often enough to
         * look like messages randomly vanishing. Its own failure must not
         * take down a completed run either — the answer was delivered, and
         * turning a persistence fault into a broken stream would lose the
         * text the person is reading.
         */
        if (request.onTurn) {
          try {
            await request.onTurn({
              runId: result.runId, text: answer, toolCalls, failed: result.failed,
            });
          } catch {
            // Swallowed deliberately: see above. The run is in agent_run.
          }
        }

        /**
         * A FINISHED run that failed gets a log line too (2026-08-20: two
         * live asks died in ~800ms and the journal held nothing — the reason
         * sat only in agent_run.error and the SSE `done` event, i.e. below
         * owner altitude and inside one browser tab; the operator watching
         * the logs saw two clean 200s). Codes only: the run id ties the
         * moment to the audit row that holds the full error.
         */
        if (result.failed) {
          config.log?.({ event: "assistant_run_failed", runId: result.runId });
        }
        stream.finish({
          runId: result.runId,
          failed: result.failed,
          error: result.error,
        });
      } catch (error) {
        /*
         * Thrown before/instead of a result — no run row exists, so this
         * catch is the ONLY record on our side. It used to ride the `done`
         * event alone, which meant a pre-run failure was invisible in the
         * logs while the user stared at "unanswered" (found diagnosing the
         * live no-model 400: one ask, no row, no log line, nothing to read).
         * Loud here per M21 — the CLASS only, never the message, which can
         * quote the question.
         */
        config.log?.(
          { event: "assistant_pre_run_failure",
            err: error instanceof Error ? error.constructor.name : typeof error },
        );
        stream.finish({
          runId: "",
          failed: true,
          error: error instanceof Error ? error.message : "assistant failed",
        });
      }
    },
  };
}
