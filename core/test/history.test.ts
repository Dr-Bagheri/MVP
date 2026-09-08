import { describe, expect, it } from "vitest";
import { CLIP_MARK, conversationHistory, HISTORY_LIMITS, type ThreadRow } from "../src/agent/history.ts";

/**
 * THE ASSISTANT'S MEMORY (user report, 2026-09-08: "when it answers you it
 * forgets").
 *
 * There was none: `loopInput` handed Pi `messages: []` on every run this
 * product had ever made, so the model saw one question and no conversation.
 * This file holds what the model is now shown of a thread — a decision with
 * rules, none of which are visible from the rendered conversation.
 */

const row = (over: Partial<ThreadRow>): ThreadRow =>
  ({ role: "user", content: "…", author: null, ...over });

describe("what a model is shown of the conversation", () => {
  it("keeps the turns in the order they were said, with their roles", () => {
    const turns = conversationHistory([
      row({ role: "user", content: "سلام" }),
      row({ role: "assistant", content: "سلام! چطور می‌توانم کمک کنم؟" }),
      row({ role: "user", content: "دیروز چه تصمیمی گرفتیم؟" }),
    ]);
    expect(turns).toEqual([
      { role: "user", text: "سلام" },
      { role: "assistant", text: "سلام! چطور می‌توانم کمک کنم؟" },
      { role: "user", text: "دیروز چه تصمیمی گرفتیم؟" },
    ]);
  });

  it("NAMES a colleague's turn and leaves Echo's own unlabelled", () => {
    /*
     * Roya's answer is an assistant turn in the same thread. Unnamed, Echo
     * reads her words as its own and says "as I explained" about something it
     * never said — the flattening the room fixed on 2026-09-05, here.
     */
    const turns = conversationHistory([
      row({ role: "assistant", content: "من نگاه کردم", author: "roya" }),
      row({ role: "assistant", content: "پس نتیجه این شد", author: null }),
    ]);
    expect(turns[0]?.text).toBe("roya: من نگاه کردم");
    expect(turns[1]?.text).toBe("پس نتیجه این شد");
  });

  it("drops tool rows and empty turns — neither is something somebody said", () => {
    /* the thread stores tool turns as CODES ONLY (arguments quote
       transcripts), so a tool row carries no words; and an assistant message
       with no content maps to a null-content wire message some providers
       refuse outright */
    const turns = conversationHistory([
      row({ role: "user", content: "سؤال" }),
      row({ role: "tool", content: "list_tasks" }),
      row({ role: "assistant", content: "   " }),
      row({ role: "assistant", content: "پاسخ" }),
    ]);
    expect(turns.map((t) => t.text)).toEqual(["سؤال", "پاسخ"]);
  });

  it("trims the OLDEST when the budget is spent, in whole turns", () => {
    /* a budget spent on the opening pleasantries answers yesterday's
       question — and half a turn is a sentence nobody said */
    const long = "x".repeat(3_000);
    const turns = conversationHistory(
      Array.from({ length: 8 }, (_, i) => row({ content: `${i}:${long}` })),
    );
    const total = turns.reduce((n, t) => n + t.text.length, 0);
    expect(total).toBeLessThanOrEqual(HISTORY_LIMITS.maxChars);
    /* the newest survived and the oldest went; a version trimming from the
       BACK passes the budget assertion above and keeps the wrong end */
    expect(turns.at(-1)?.text.startsWith("7:")).toBe(true);
    expect(turns.some((t) => t.text.startsWith("0:"))).toBe(false);
  });

  it("keeps only the newest turns when a thread is long", () => {
    const turns = conversationHistory(
      Array.from({ length: HISTORY_LIMITS.maxTurns + 10 }, (_, i) => row({ content: `t${i}` })),
    );
    expect(turns).toHaveLength(HISTORY_LIMITS.maxTurns);
    expect(turns[0]?.text).toBe("t10");
  });

  it("MARKS a clipped turn rather than trimming it silently", () => {
    /* a silent clip is a lie about what was said; an ellipsis is a fact */
    const turns = conversationHistory([row({ content: "ب".repeat(HISTORY_LIMITS.turnChars + 500) })]);
    expect(turns[0]?.text.endsWith(CLIP_MARK)).toBe(true);
    expect(turns[0]?.text).toHaveLength(HISTORY_LIMITS.turnChars + CLIP_MARK.length);
  });

  it("keeps the newest turn even when it alone exceeds the budget", () => {
    /*
     * "there is no history" and "there is one long turn" are different
     * answers, and the second one is the true one.
     *
     * The limits are EXPLICIT here because the shipped ones make this state
     * unreachable — which is the assertion below, and which is how this test
     * was found: written against `HISTORY_LIMITS` it could not fail, because
     * the per-turn clip lands every turn at 4k under a 12k budget.
     */
    const turns = conversationHistory(
      [row({ content: "قدیمی" }), row({ content: "ج".repeat(500) })],
      { maxTurns: 5, maxChars: 100, turnChars: 4_000 },
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text.startsWith("ج")).toBe(true);
  });

  it("ships limits where ONE turn always fits", () => {
    /* the relationship, not the numbers: a per-turn ceiling above the total
       budget would make the trim loop's own floor the ordinary case, and
       every conversation would arrive as a single clipped answer */
    expect(HISTORY_LIMITS.turnChars + CLIP_MARK.length).toBeLessThanOrEqual(HISTORY_LIMITS.maxChars);
  });

  it("answers an empty thread with an empty history", () => {
    expect(conversationHistory([])).toEqual([]);
  });
});
