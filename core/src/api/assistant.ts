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
import { createClientTools } from "../agent/client-tools.ts";
import { createDelegationTools, createEchoTool } from "../agent/delegation.ts";

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
  /**
   * M33: client tools THIS surface advertised (validated names). The gateway
   * and API callers advertise none and get none — a UI tool must never be
   * offered into a surface that cannot perform it.
   */
  clientTools?: readonly string[] | undefined;
  /** M36: the caller's stored autonomy, resolved server-side by the route. */
  autonomy?: "watch" | "assist" | "act" | undefined;
  /** the asker's UI language — client-tool labels render in it */
  locale?: "fa" | "en" | undefined;
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
  onTurn?: ((turn: {
    runId: string; text: string; toolCalls: unknown[]; failed: boolean;
    /** db/0169: which assistant wrote it. Absent = Echo itself. */
    author?: string | undefined;
  }) => Promise<void>) | undefined;
  /**
   * db/0169 — may the colleagues Echo calls in search the open web.
   *
   * The PERSON's switch (`app_user.agents_web`), which is ANDed with each
   * agent's own `web` flag inside delegation.ts. Two switches rather than one
   * because they answer different questions: the agent's says "is this a
   * web-using persona", the person's says "do I want my helpers spending
   * outside the building today".
   */
  agentsWeb?: boolean | undefined;
  /**
   * Set when the person PICKED an agent for this turn (the agents screen's
   * «پرسیدن», or `@roya` in the message). Two consequences, both deliberate:
   * the turn is persisted under that handle so the thread shows their avatar,
   * and they get no delegation tools — a colleague somebody asked directly
   * does not get to convene the others.
   */
  agentHandle?: string | undefined;
  /** M48: who the router picked, and why. Absent = nothing was routed. */
  route?: {
    agent: string;
    rule: string;
    switched: boolean;
    confidence: number | null;
  } | undefined;
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
 * The answer's language MIRRORS the conversation (user directive,
 * 2026-08-20, superseding the same-day interface-language rule): reply in
 * the language of the user's MOST RECENT message — start in English, get
 * English; switch to Persian mid-conversation, it switches with you. The
 * interface locale is only the TIEBREAKER for messages with no readable
 * language ("ok", a bare number, an emoji). The shipped skill's prompt is
 * Persian-first, so without this instruction every conversation drifted to
 * Persian regardless of how the person was talking.
 *
 * The mirror rule is returned even with NO locale — an older client that
 * sends none still gets the right behavior; only the tiebreaker sentence
 * needs the locale.
 */
/**
 * db/0112 - the person's standing voice for their own assistant, composed
 * at ask time. The reply-language choice OVERRIDES the mirror rule (an
 * explicit choice beats an inference - M21's told-beats-inferred);
 * instructions are the user's own words to their own assistant, appended
 * as user-authored configuration under a label, bounded at the column.
 */
export function personalAssistantInstructions(prefs: {
  assistant_reply_language?: string | null;
  assistant_reply_length?: string | null;
  assistant_instructions?: string | null;
}): string {
  const parts: string[] = [];
  if (prefs.assistant_reply_language === "fa") {
    parts.push("\u0647\u0645\u06cc\u0634\u0647 \u0628\u0647 \u0641\u0627\u0631\u0633\u06cc \u067e\u0627\u0633\u062e \u0628\u062f\u0647\u060c \u0641\u0627\u0631\u063a \u0627\u0632 \u0632\u0628\u0627\u0646 \u067e\u06cc\u0627\u0645 \u06a9\u0627\u0631\u0628\u0631.");
  } else if (prefs.assistant_reply_language === "en") {
    parts.push("Always reply in English, regardless of the user's message language.");
  }
  if (prefs.assistant_reply_length === "short") {
    parts.push("\u067e\u0627\u0633\u062e\u200c\u0647\u0627 \u0631\u0627 \u06a9\u0648\u062a\u0627\u0647 \u0648 \u0641\u0634\u0631\u062f\u0647 \u0628\u062f\u0647 - \u0686\u0646\u062f \u062c\u0645\u0644\u0647\u060c \u0628\u062f\u0648\u0646 \u0645\u0642\u062f\u0645\u0647.");
  } else if (prefs.assistant_reply_length === "detailed") {
    parts.push("\u067e\u0627\u0633\u062e\u200c\u0647\u0627 \u0631\u0627 \u06a9\u0627\u0645\u0644 \u0648 \u0628\u0627 \u062c\u0632\u0626\u06cc\u0627\u062a \u0628\u062f\u0647.");
  }
  const custom = prefs.assistant_instructions?.trim();
  if (custom) {
    parts.push("\u062f\u0633\u062a\u0648\u0631\u0647\u0627\u06cc \u0647\u0645\u06cc\u0634\u06af\u06cc \u06a9\u0627\u0631\u0628\u0631:\n" + custom);
  }
  return parts.join("\n");
}

/**
 * WHAT TIME IT IS, AND WHICH CALENDAR THE PERSON IS COUNTING IN.
 *
 * User directive, 2026-09-04: "give access to the agents and Echo to
 * understand the calendar and the time, so when I ask to create a meeting for
 * this date and this hour they can select the right date and time."
 *
 * They had none. Nothing in the assembled instructions said what day it was,
 * so "Monday at nine" was answered out of a training corpus: the reported case
 * put the date on the day the person meant and the time at half past twelve,
 * which is the shape of a model that inferred a date from the surrounding
 * conversation and had nothing at all to say about the hour. There was no bug
 * to find — the fact was never sent.
 *
 * Three things go out, and each is load-bearing:
 *
 *   · THE INSTANT WITH ITS OFFSET. A meeting is stored as an instant, so the
 *     only thing that makes "nine in the morning" a fact is the zone it is
 *     nine in. Handing the model a bare UTC clock for a person in Tehran puts
 *     every meeting three and a half hours out — and the wrong-by-a-fixed-
 *     amount failure is the one nobody reads as a bug, because the date is
 *     right and the meeting is simply at the wrong time.
 *   · BOTH CALENDARS. The person says «۱۶ شهریور» and the wire speaks ISO;
 *     a model given only one of those has to convert unaided, and it is the
 *     Persian half it will get wrong. Giving it today in both means the
 *     mapping is read, not computed.
 *   · THE DAY OF THE WEEK, because "Monday" cannot be resolved without it.
 *
 * `zone` is the person's own: their explicit preference when they have set
 * one, the browser's resolved zone otherwise (M24's "auto follows the
 * language" rule, applied to time). When there is neither — an API caller
 * with no browser — this says UTC and SAYS SO, rather than guessing a zone
 * on someone's behalf.
 */
export function timeInstructions(now: Date, zone: string): string {
  /* Intl at runtime, never a list of our own: the zone was validated by the
     same mechanism when it was stored (members.ts), and a second spelling of
     "which zones exist" is a second thing to keep current. */
  let timeZone = zone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(now);
  } catch {
    timeZone = "UTC";
  }

  const at = (locale: string, options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(now);

  /* the wall clock in that zone, assembled from parts — `toISOString` is UTC
     by definition and would print the very number this exists to correct */
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  /* "GMT+03:30" → "+03:30"; UTC formats as plain "GMT", which is "+00:00" */
  const named = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = named === "GMT" ? "+00:00" : named.replace("GMT", "");
  const iso = `${get("year")}-${get("month")}-${get("day")}`
    + `T${get("hour")}:${get("minute")}:${get("second")}${offset}`;

  const gregorian = at("en-US", { dateStyle: "full", timeStyle: "short" });
  const jalali = at("fa-IR-u-ca-persian", { dateStyle: "full", timeStyle: "short" });

  return [
    `Right now it is ${iso} — ${gregorian} in the Gregorian calendar,`
    + ` ${jalali} in the Jalali (Persian) calendar.`,
    `The person's time zone is ${timeZone}${zone === timeZone ? "" : " (their own zone was not usable, so this is a fallback)"}.`,
    "Resolve every relative or spoken time — «فردا», «دوشنبه», «ساعت ۹ صبح»,"
    + " \"next week\", \"this afternoon\" — against that instant, and pass tools a"
    + " full ISO 8601 value carrying that same offset"
    + ` (a meeting at nine in the morning is "…T09:00:00${offset}", never a bare date).`,
    "A Jalali date the person gives you is a date in that calendar: convert it,"
    + " do not read its numbers as Gregorian.",
  ].join(" ");
}

export function languageInstruction(locale: unknown): string {
  const mirror =
    "Always reply in the language of the user's most recent message: an English"
    + " message gets an English answer, a Persian message gets a Persian answer —"
    + " and when the user switches language mid-conversation, switch with them.";
  if (locale === "fa") {
    return `${mirror} If the message has no clear language, answer in Persian.`;
  }
  if (locale === "en") {
    return `${mirror} If the message has no clear language, answer in English.`;
  }
  return mirror;
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
      /*
       * WHO IS ANSWERING, SAID FIRST (M48).
       *
       * Before a single token. The routing call is one extra round trip in
       * front of the answer, and the whole of what makes that acceptable is
       * that the screen can say «رؤیا در حال پاسخ…» while it happens —
       * perceived latency is what a person judges, and a name arriving in
       * 300ms reads as faster than silence followed by the same answer.
       *
       * Additive to the wire, like `session` before it: a client that has
       * never heard of this event drops it by contract and renders the reply
       * exactly as it did yesterday.
       *
       * `rule` rides along because the audit surface should be able to answer
       * "why did Roya take this one" — and because a route that FELL BACK and
       * one that confidently chose Echo look identical without it.
       */
      if (request.route) {
        stream.send({
          type: "route",
          agent: request.route.agent,
          rule: request.route.rule,
          switched: request.route.switched,
        });
      }
      /*
       * M33: build this request's client tools, closed over THIS stream's
       * sender. Empty for watch mode and for surfaces that advertised none.
       */
      const clientTools = createClientTools(request.clientTools ?? [], {
        userId: request.identity.userId,
        autonomy: request.autonomy ?? "assist",
        emit: (event) => stream.send(event),
        locale: request.locale,
      });

      /**
       * ECHO'S COLLEAGUES (db/0169). `ask_roya` / `ask_ava` join the tool set
       * for THIS turn, closed over this stream so a colleague's answer lands
       * in the thread as it happens rather than at the end.
       *
       * Only when a turn belongs to Echo: a run that already IS an agent
       * (`request.agentHandle`, set when somebody picked Roya from the agents
       * screen) gets none of these, which is guard 1 of three — no onward
       * delegation, as an absence rather than as a check.
       *
       * `delegateTurns` collects what was said so the turns can be PERSISTED
       * after the run, in the order they were spoken. They are appended
       * before Echo's own turn, because that is the order they happened in
       * and a thread that reorders itself on reload is a thread nobody trusts.
       */
      const delegateTurns: { author: string; text: string; failed: boolean }[] = [];
      /*
       * AN AGENT'S TURN GETS `ask_echo` INSTEAD (user directive, 2026-09-04:
       * "they also must have the ability to talk to echo and ask things from
       * echo as well").
       *
       * Still no onward delegation — Roya cannot reach Ava, which is guard 1
       * and stays an absence rather than a check. What she gains is the one
       * direction that was missing: the platform assistant, asked as a
       * colleague, with a read-only tool set and no voice in the thread. See
       * `createEchoTool` for why its reach is narrower than Echo's own.
       */
      const delegationTools = request.agentHandle
        ? await createEchoTool({
          db: config.db,
          identity: request.identity,
          web: request.agentsWeb === true,
          locale: request.locale,
          askedBy: request.agentHandle,
          onTurn: async () => { /* Echo answering its agent is not a turn */ },
          runNested: async (nested) => runtime.run({
            identity: request.identity,
            kind: "assistant",
            systemInstructions: nested.instructions,
            agentModel: nested.model,
            callerModel: request.model,
            input: nested.question,
            tools: nested.tools as never,
            clientTools: [] as never,
            deps: config.deps as never,
            callId: null,
            web: nested.web,
            signal: request.signal,
            apiKey: config.apiKey,
          }),
        })
        : await createDelegationTools({
          db: config.db,
          identity: request.identity,
          web: request.agentsWeb === true,
          locale: request.locale,
          onTurn: (turn) => {
            delegateTurns.push({ author: turn.author, text: turn.text, failed: turn.failed });
            stream.send({
              type: "agent_message",
              author: turn.author,
              name: turn.name,
              text: turn.text,
              failed: turn.failed,
            });
          },
          runNested: async (nested) => runtime.run({
            identity: request.identity,
            kind: "assistant",
            /* the agent's OWN instructions, resolved server-side from the
               database — never anything the browser sent (M30) */
            systemInstructions: nested.instructions,
            agentModel: nested.model,
            callerModel: request.model,
            input: nested.question,
            tools: nested.tools as never,
            /* NO client tools and NO write tools: guard 2. What an output can
               REACH decides what its author may hold, and a delegate's output
               is read by Echo before anybody acts on it. */
            clientTools: [] as never,
            deps: config.deps as never,
            callId: null,
            web: nested.web,
            signal: request.signal,
            apiKey: config.apiKey,
          }),
        });

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
          tools: [...config.tools, ...delegationTools] as never,
          clientTools: clientTools as never,
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
            /*
             * The colleagues first, in the order they spoke, then Echo.
             *
             * That is the order the reader watched them arrive in, and a
             * thread that reorders itself on reload is a thread nobody
             * trusts — the live stream showed Roya answering BEFORE Echo's
             * conclusion, because that is what happened.
             *
             * A failed delegate turn is persisted too: "Ava could not answer"
             * is part of the record of how this question went, and dropping
             * it would leave Echo's conclusion referring to a colleague the
             * thread never shows being asked.
             */
            for (const turn of delegateTurns) {
              await request.onTurn({
                runId: result.runId, text: turn.text, toolCalls: [],
                failed: turn.failed, author: turn.author,
              });
            }
            await request.onTurn({
              runId: result.runId, text: answer, toolCalls, failed: result.failed,
              ...(request.agentHandle ? { author: request.agentHandle } : {}),
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
