/**
 * THE ONE PI INTERFACE FILE (M4: "all harness contact behind one interface").
 *
 * Nothing else in core/ imports @earendil-works/*. If Pi is ever replaced,
 * this file is the blast radius.
 *
 * Spike findings baked in here so they can't be re-learned the hard way:
 * - `builtinModels()` is the catalogue (39 providers / 335 OpenRouter models).
 *   Hand-rolling `createProvider({api: "openai-completions"})` compiles and
 *   then fails at stream time with "Unknown provider".
 * - Reasoning-mandatory models (gemini-3.x on OpenRouter) 400 unless a
 *   thinking level is passed; Pi defaults to none. `reasoningFor()` handles it.
 * - LLM failures are IN-BAND: the loop returns normally and the assistant
 *   message carries `stopReason: "error"`. Unsurfaced, that looks like a
 *   silent empty answer — `runPi` turns it into an explicit failure.
 */
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { builtinModels, getBuiltinModel, getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

export { Type } from "@earendil-works/pi-ai";

export interface PiModelRef {
  /** Provider id in the catalogue, e.g. "openrouter". */
  provider: string;
  /** Model id, e.g. "google/gemini-3.6-flash". */
  id: string;
}

export type BeforeToolCall = (
  ctx: { toolCall: { name: string }; args: unknown },
) => Promise<{ block?: boolean; reason?: string } | undefined>;

export interface PiRunOptions {
  model: PiModelRef;
  systemPrompt: string;
  userText: string;
  tools: unknown[];
  // `| undefined` explicitly: the repo runs exactOptionalPropertyTypes, so an
  // optional property and a present-but-undefined one are different types.
  beforeToolCall?: BeforeToolCall | undefined;
  signal?: AbortSignal | undefined;
  /** Called for streamed assistant text (SSE bridge). */
  onText?: ((delta: string) => void) | undefined;
  apiKey?: string | undefined;
}

export interface PiRunResult {
  text: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Set when the provider failed — the loop returns normally on error. */
  error?: string;
}

/** The M5 catalogue source: filter this, don't build one. */
export function catalogue(provider = "openrouter"): { id: string; name: string; reasoning: boolean }[] {
  const list = getBuiltinModels(provider as never) as unknown as {
    id: string; name?: string; reasoning?: boolean;
  }[];
  return list.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    reasoning: Boolean(m.reasoning),
  }));
}

export function resolveModel(ref: PiModelRef): { model: unknown; reasoningRequired: boolean } {
  const model = getBuiltinModel(ref.provider as never, ref.id as never) as { reasoning?: boolean };
  if (!model) throw new Error(`unknown model: ${ref.provider}/${ref.id}`);
  return { model, reasoningRequired: Boolean(model.reasoning) };
}

/**
 * Some providers reject reasoning-disabled requests outright. Pi sends none
 * by default, so a reasoning-capable model needs an explicit level.
 */
export function reasoningFor(reasoningRequired: boolean): "low" | undefined {
  return reasoningRequired ? "low" : undefined;
}

/**
 * Pi's agent loop NEVER emits stream events at the top level: every provider
 * event arrives WRAPPED as `{type: "message_update", assistantMessageEvent}`
 * (agent-loop.js re-emits them that way). The first version of this bridge
 * matched `event.type === "text_delta"` at the top level — which never
 * matches — so the assistant streamed nothing and persisted nothing while
 * every run finished `ok` with billed output tokens. Four live "unanswered"
 * questions in the thread, zero errors anywhere: the boundary-fixture class
 * (rule 10), between us and a dependency this time.
 *
 * Extracted and exported so the wrapped fixture can be asserted in a test
 * rather than re-learned in production.
 */
export function bridgeAgentEvent(
  raw: unknown,
  hooks: {
    onText?: ((delta: string) => void) | undefined;
    onError: (message: string) => void;
    onUsage: (input: number, output: number) => void;
  },
): void {
  const event = raw as {
    type: string;
    delta?: string;
    assistantMessageEvent?: { type: string; delta?: string };
    message?: {
      stopReason?: string;
      errorMessage?: string;
      usage?: { input?: number; output?: number };
    };
  };
  // the wrapped shape — the one the loop actually sends
  if (
    event.type === "message_update"
    && event.assistantMessageEvent?.type === "text_delta"
    && event.assistantMessageEvent.delta
  ) {
    hooks.onText?.(event.assistantMessageEvent.delta);
  }
  // kept for a future Pi that flattens its events; harmless today because
  // the top-level type is never "text_delta"
  if (event.type === "text_delta" && event.delta) hooks.onText?.(event.delta);
  if (event.type !== "message_end" || !event.message) return;
  // IN-BAND ERRORS: surface, never swallow
  if (event.message.stopReason === "error") {
    hooks.onError(event.message.errorMessage ?? "provider error");
  }
  if (event.message.usage) {
    hooks.onUsage(event.message.usage.input ?? 0, event.message.usage.output ?? 0);
  }
}

/**
 * The loop's input, in one place so a test can hold it against Pi's own
 * combination rule. `runAgentLoop(prompts, context, …)` APPENDS the prompts
 * to `context.messages` (agent-loop.js: `[...context.messages, ...prompts]`),
 * so the user turn must live in exactly ONE of the two. It lived in both:
 * every model saw every question twice, and the translator — whose task is
 * to echo its input in another language — was the first surface honest
 * enough to show it (a doubled transcript, joined mid-line).
 */
export function loopInput(userText: string, systemPrompt: string, tools: unknown[]): {
  prompts: { role: "user"; content: { type: "text"; text: string }[]; timestamp: string }[];
  context: { systemPrompt: string; messages: never[]; tools: unknown[] };
} {
  return {
    prompts: [{
      role: "user" as const,
      content: [{ type: "text" as const, text: userText }],
      timestamp: new Date().toISOString(),
    }],
    context: { systemPrompt, messages: [], tools },
  };
}

export async function runPi(options: PiRunOptions): Promise<PiRunResult> {
  const { model, reasoningRequired } = resolveModel(options.model);
  const models = builtinModels();

  let text = "";
  let errorMessage: string | undefined;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;

  const { prompts, context } = loopInput(options.userText, options.systemPrompt, options.tools);

  const config = {
    model,
    reasoning: reasoningFor(reasoningRequired),
    convertToLlm: (messages: unknown[]) => messages as never,
    beforeToolCall: options.beforeToolCall
      ? async (ctx: { toolCall: { name: string }; args: unknown }) => options.beforeToolCall!(ctx)
      : undefined,
    toolExecutionMode: "sequential" as const,
    ...(options.apiKey ? { getApiKey: () => options.apiKey } : {}),
  };

  const onEvent = (raw: unknown): void =>
    bridgeAgentEvent(raw, {
      onText: options.onText,
      onError: (message) => { errorMessage = message; },
      onUsage: (input, output) => {
        tokensIn = (tokensIn ?? 0) + input;
        tokensOut = (tokensOut ?? 0) + output;
      },
    });

  const messages = await runAgentLoop(
    prompts as never,
    context as never,
    config as never,
    onEvent as never,
    options.signal,
    ((m: never, ctx: never, opts: never) => models.streamSimple(m, ctx, opts)) as never,
  );

  for (const message of messages as { role: string; content?: { type: string; text?: string }[] }[]) {
    if (message.role !== "assistant") continue;
    for (const part of message.content ?? []) {
      if (part.type === "text" && part.text) text = part.text;
    }
  }

  return {
    text,
    model: (model as { id: string }).id,
    tokensIn,
    tokensOut,
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}
