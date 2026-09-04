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

  it("offers the promised deliverable on a Create-tagged answer — and ONLY there", () => {
    /*
     * Create → PDF used to only prefix the prompt: the person got
     * document-shaped prose and no document. The toolbar now keeps the
     * promise; an untagged answer must NOT offer it (the button would claim
     * every answer is a document).
     */
    render(
      <ConversationThread
        messages={[
          user("m1", "سؤال"),
          assistant("m2", "متن سند", { created: "pdf" }),
          user("m3", "سؤال دوم"),
          assistant("m4", "پاسخ عادی"),
        ]}
      />,
    );
    expect(screen.getAllByText(/ذخیره به‌صورت PDF|Save as PDF/)).toHaveLength(1);
  });

  it("shows ONLY the human annotation on a failed run — never a raw provider error", () => {
    /*
     * The server's failure sentence was briefly rendered here and REMOVED by
     * user directive (2026-08-20, "remove the log"): a provider's JSON under
     * a chat message reads as debug output, not as product. The reason still
     * reaches the operator (audit surface + server log). This is the absence
     * half: it fails if the raw sentence quietly returns.
     */
    render(
      <ConversationThread
        messages={[
          user("m1", "سؤال"),
          { ...user("m1b", "سؤال دوم"), failed: true, error: "model refused: example_code" } as AgentMessage,
        ]}
      />,
    );
    expect(screen.getByText("این پرسش بی‌پاسخ ماند؛ اجرا ناتمام ماند.")).toBeTruthy();
    expect(screen.queryByText(/model refused/)).toBeNull();
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
    // annotation, not a turn: still exactly two messages in the record.
    // Counted on `.message-arrives`, which is one element PER MESSAGE, not
    // on a style class: this line used to count `div.rounded-2xl` and broke
    // the day answers stopped being boxed (2026-08-27) — the styling
    // changed and the claim did not, which is the whole reason a structural
    // marker beats a visual one here.
    expect(document.querySelectorAll("div.message-arrives")).toHaveLength(2);
  });

  it("does NOT mark a complete answer as truncated", () => {
    render(
      <ConversationThread
        messages={[user("m1", "چه چیزهایی مطرح شد؟"), assistant("m2", "سه موضوع مطرح شد.")]}
      />,
    );
    expect(screen.queryByText(/ناتمام ماند؛ ادامه‌اش نوشته نشد/)).toBeNull();
  });

  it("shows the answer, and NOT the tools it took to get there", () => {
    /*
     * User directive, 2026-09-04: "remove the tools text name in the chat box,
     * it does not need to show what tools they are using, all the page now is
     * full of this tools names." A turn that searched, listed and wrote wore
     * four chips under two lines of answer.
     *
     * Asserted as an ABSENCE, and both spellings of it: the label a person
     * would read AND the identifier, because a version that rendered the raw
     * name instead of the label would look like a regression to whoever sees
     * it and like a pass to a test that only banned the label. The data is
     * untouched — `tool_calls` still arrive, and the agent-run surface still
     * draws them, where a trace is the subject rather than the margin.
     */
    render(
      <ConversationThread
        messages={[
          assistant("m1", "پاسخ", {
            tool_calls: [{ id: "t1", name: "search_transcripts", label: "جست‌وجو", state: "ok" }],
          }),
        ]}
      />,
    );
    expect(screen.getByText("پاسخ"), "the answer itself must still render").toBeTruthy();
    expect(screen.queryByText("جست‌وجو")).toBeNull();
    expect(screen.queryByText(/search_transcripts/)).toBeNull();
  });
});
