import { describe, expect, it, vi } from "vitest";
import { bridgeAgentEvent } from "../src/agent/pi.ts";

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
