import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/api/types";
import { ConversationThread } from "./ConversationThread";

/**
 * The rule under test is a NEGATIVE one: **a failed run must not put words in
 * the assistant's mouth.**
 *
 * That is hard to catch by looking, because the wrong version looks *better* —
 * a tidy "Sorry, something went wrong" bubble reads as polish. It is only wrong
 * on the axis nobody checks: a week later, in a persisted record, it is
 * indistinguishable from something the assistant actually said.
 *
 * So these assert what is ABSENT, which is the direction that fails when a
 * future edit "improves" the empty state.
 */
const user = (id: string, content: string): AgentMessage => ({
  id, role: "user", content, tool_calls: [], proposal: null,
});
const assistant = (id: string, content: string, extra: Partial<AgentMessage> = {}): AgentMessage => ({
  id, role: "assistant", content, tool_calls: [], proposal: null, ...extra,
});

describe("ConversationThread", () => {
  it("renders a question that was never answered — and invents no reply", () => {
    render(<ConversationThread messages={[user("m1", "قرارداد کی تمدید می‌شود؟")]} />);

    expect(screen.getByText("قرارداد کی تمدید می‌شود؟")).toBeTruthy();
    // the annotation is present…
    expect(screen.getByText(/ناتمام|unfinished/i)).toBeTruthy();
    // …and it is NOT a message: exactly one bubble in the thread
    expect(screen.queryAllByText(/./, { selector: ".rounded-2xl" }).length).toBe(1);
  });

  it("does not mark a question unanswered while the answer is still streaming", () => {
    /*
     * The live case. Without this guard every question would flash "unfinished"
     * for the second before the first delta lands — an error state shown for
     * the normal path, which teaches users to ignore it.
     */
    render(<ConversationThread streaming messages={[user("m1", "سلام")]} />);
    expect(screen.queryByText(/ناتمام|unfinished/i)).toBeNull();
  });

  it("renders an answered exchange with no annotation", () => {
    render(
      <ConversationThread
        messages={[user("m1", "سؤال"), assistant("m2", "پاسخ")]}
      />,
    );
    expect(screen.getByText("پاسخ")).toBeTruthy();
    expect(screen.queryByText(/ناتمام|unfinished/i)).toBeNull();
  });

  it("annotates an assistant turn that itself failed, without replacing its text", () => {
    render(
      <ConversationThread
        messages={[user("m1", "سؤال"), assistant("m2", "نیمه‌کاره", { failed: true })]}
      />,
    );
    // whatever the model DID say survives — we annotate, we don't overwrite
    expect(screen.getByText("نیمه‌کاره")).toBeTruthy();
    expect(screen.getByText(/ناتمام|unfinished/i)).toBeTruthy();
  });

  it("shows the server's failure REASON inside the annotation — never as a bubble", () => {
    /*
     * 2026-08-20: two live runs failed in ~800ms and the person saw only "the
     * run did not finish" — the server had SENT the reason on `done` and the
     * client discarded it, so diagnosing meant an operator reading the
     * database. The reason renders as part of the annotation (no role, no
     * bubble), so it can never later read as something the assistant said.
     */
    render(
      <ConversationThread
        messages={[user("m1", "سؤال", ), { ...user("m1b", "سؤال دوم"), failed: true, error: "model refused: example_code" } as AgentMessage]}
      />,
    );
    expect(screen.getByText(/model refused: example_code/)).toBeTruthy();
    // still exactly the bubbles the messages account for — the reason adds none
    expect(screen.queryAllByText(/./, { selector: ".rounded-2xl" }).length).toBe(2);
  });

  /**
   * **Shape B — the dangerous one.** A run that failed AFTER producing text
   * leaves a partial answer persisted, and on reload it reads exactly like a
   * complete answer the model chose to give. Nothing on screen is false; the
   * whole thing is.
   *
   * The marker is asserted in BOTH directions, because a marker that appears
   * on every assistant turn would pass a one-sided test while telling every
   * reader their complete answers were cut off — B1's rule that a false "cut
   * off" is its own lie, made into a check.
   */
  it("marks a truncated answer — on the real turn, as an annotation", () => {
    render(
      <ConversationThread
        messages={[
          user("m1", "چه چیزهایی مطرح شد؟"),
          assistant("m2", "سه موضوع مطرح شد: نخست", { truncated: true } as Partial<AgentMessage>),
        ]}
      />,
    );

    // the partial text is kept — it is what the assistant really said
    expect(screen.getByText("سه موضوع مطرح شد: نخست")).toBeTruthy();
    expect(screen.getByText(/ناتمام ماند؛ ادامه‌اش نوشته نشد/)).toBeTruthy();
    // annotation, not a turn: still exactly two messages in the record
    expect(screen.getAllByText(/./, { selector: "div.rounded-2xl" })).toHaveLength(2);
  });

  it("does NOT mark a complete answer as truncated", () => {
    render(
      <ConversationThread
        messages={[user("m1", "چه چیزهایی مطرح شد؟"), assistant("m2", "سه موضوع مطرح شد.")]}
      />,
    );
    expect(screen.queryByText(/ناتمام ماند؛ ادامه‌اش نوشته نشد/)).toBeNull();
  });

  it("renders tool calls as chips, not as a trace", () => {
    render(
      <ConversationThread
        messages={[
          assistant("m1", "پاسخ", {
            tool_calls: [{ id: "t1", name: "search_transcripts", label: "جست‌وجو", state: "ok" }],
          }),
        ]}
      />,
    );
    expect(screen.getByText("جست‌وجو")).toBeTruthy();
    // the full trace belongs to the audit surface — no state, no timing here
    expect(screen.queryByText(/search_transcripts/)).toBeNull();
  });
});
