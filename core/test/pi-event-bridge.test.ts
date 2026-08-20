import { describe, expect, it, vi } from "vitest";
import { bridgeAgentEvent, loopConfig, loopInput, MAX_OUTPUT_TOKENS } from "../src/agent/pi.ts";

/**
 * The Pi event bridge — the seam that silently ate every assistant answer.
 *
 * The fixture below is the PRODUCER's shape (rule 10): pi-agent-core's
 * agent-loop re-emits provider stream events wrapped as
 * `{type:"message_update", assistantMessageEvent: <the event>}` — it never
 * emits `text_delta` at the top level. The first bridge matched the top
 * level, so `onText` never fired: nothing streamed, nothing persisted,
 * every run finished `ok` with billed tokens, and the thread said
 * "unanswered". Four live questions proved it before this file existed.
 */

const WRAPPED_TEXT_DELTA = {
  // transcribed from agent-loop.js's emit for a streaming text event
  type: "message_update",
  assistantMessageEvent: {
    type: "text_delta",
    contentIndex: 0,
    delta: "سلام! ",
    partial: { role: "assistant", content: [{ type: "text", text: "سلام! " }] },
  },
  message: { role: "assistant", content: [{ type: "text", text: "سلام! " }] },
};

describe("bridgeAgentEvent", () => {
  it("surfaces text deltas from the WRAPPED shape the loop actually sends", () => {
    const onText = vi.fn();
    bridgeAgentEvent(WRAPPED_TEXT_DELTA, { onText, onError: vi.fn(), onUsage: vi.fn() });
    expect(onText).toHaveBeenCalledWith("سلام! ");
  });

  it("does not double-fire when a delta event carries no top-level delta field", () => {
    const onText = vi.fn();
    bridgeAgentEvent(WRAPPED_TEXT_DELTA, { onText, onError: vi.fn(), onUsage: vi.fn() });
    expect(onText).toHaveBeenCalledTimes(1);
  });

  it("ignores wrapped THINKING deltas — reasoning is not the answer", () => {
    const onText = vi.fn();
    bridgeAgentEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hmm" },
      },
      { onText, onError: vi.fn(), onUsage: vi.fn() },
    );
    expect(onText).not.toHaveBeenCalled();
  });

  it("surfaces in-band provider errors from message_end", () => {
    const onError = vi.fn();
    bridgeAgentEvent(
      { type: "message_end", message: { stopReason: "error", errorMessage: "quota" } },
      { onText: vi.fn(), onError, onUsage: vi.fn() },
    );
    expect(onError).toHaveBeenCalledWith("quota");
  });

  it("accumulates usage from message_end", () => {
    const onUsage = vi.fn();
    bridgeAgentEvent(
      { type: "message_end", message: { usage: { input: 677, output: 100 } } },
      { onText: vi.fn(), onError: vi.fn(), onUsage },
    );
    expect(onUsage).toHaveBeenCalledWith(677, 100);
  });
});

/**
 * The loop's input seam — the doubled-transcript bug.
 *
 * Pi's `runAgentLoop(prompts, context, …)` APPENDS the prompts to the
 * context (agent-loop.js: `messages: [...context.messages, ...prompts]` —
 * the combination below is transcribed from that line, rule 10). runPi
 * passed `context.messages` as the prompts with the user turn already
 * inside, so every model received every question TWICE. Question-shaped
 * tasks absorbed it silently; the translator echoed its input back and
 * shipped a transcript translated twice, joined mid-line.
 */
describe("loopInput", () => {
  it("yields exactly ONE user turn after Pi's own append", () => {
    const { prompts, context } = loopInput("سلام", "system", []);
    // the producer's combination, verbatim
    const wire = [...context.messages, ...prompts] as { role: string }[];
    expect(wire.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("keeps the text intact on the single turn", () => {
    const { prompts, context } = loopInput("[0:01] متن", "system", []);
    const wire = [...context.messages, ...prompts] as {
      role: string; content: { type: string; text: string }[];
    }[];
    const texts = wire.flatMap((m) => m.content.map((c) => c.text));
    expect(texts).toEqual(["[0:01] متن"]);
  });
});

/**
 * The output ceiling travels on EVERY loop config. Left unset, Pi's adapter
 * substitutes the model's own maximum (65,536 for gemini-3.1-pro) and
 * OpenRouter's affordability precheck runs against that worst case — with a
 * thin credit balance, every ask died in ~800ms with 402 while generating
 * nothing (live, 2026-08-20). This holds the field itself in place: deleting
 * it from loopConfig reverts to the model's spec sheet, silently.
 */
describe("loopConfig", () => {
  it("always carries an explicit finite maxTokens", () => {
    const cfg = loopConfig(
      { model: { provider: "openrouter", id: "m" }, systemPrompt: "s", userText: "u", tools: [] },
      { id: "m" },
      false,
    );
    expect(cfg.maxTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(Number.isFinite(cfg.maxTokens)).toBe(true);
    expect(cfg.maxTokens as number).toBeGreaterThan(0);
  });
});
