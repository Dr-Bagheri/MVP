import { describe, expect, it } from "vitest";
import {
  carriedConversations, CARRY_LIMITS, CLIP_MARK, conversationHistory, HISTORY_LIMITS,
  type CarryLimits, type PriorConversation, type ThreadRow,
} from "../src/agent/history.ts";

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
/**
 * AND WHAT IT IS SHOWN OF THE SESSION (user directive, 2026-09-08: "make the
 * memory per session not per thread").
 *
 * The thread above is one conversation. This is the tail of the person's
 * OTHER recent ones, rendered as a labelled block for the system prompt
 * rather than as more turns — so it cannot be mistaken for the conversation
 * they are looking at. Every rule below is invisible from a rendered screen.
 */
const convo = (title: string, ...rows: Partial<ThreadRow>[]): PriorConversation => ({
  title,
  rows: rows.map((over) => ({ role: "user", content: "…", author: null, ...over })),
});

/* explicit limits wherever a rule is about a boundary: the shipped numbers
   are chosen for a real conversation, and a fixture that has to be 3,000
   characters long to reach one of them is a fixture nobody can read */
const SMALL: CarryLimits = { windowHours: 12, conversations: 2, turnsEach: 3, maxChars: 400, turnChars: 60 };

describe("what a model is shown of the session", () => {
  it("gives every conversation its own title and every line its speaker", () => {
    const block = carriedConversations([
      convo("بودجه",
        { role: "user", content: "بودجه چقدر شد؟" },
        { role: "assistant", content: "دوازده میلیون" }),
    ]);
    expect(block).toBe([
      "[conversation: بودجه]",
      "user: بودجه چقدر شد؟",
      "assistant: دوازده میلیون",
    ].join("\n"));
  });

  it("names a colleague, because the roles are gone in a flat transcript", () => {
    /* the thread carries "who" in the role; here every line is text, so a
       turn of Roya's that reads `assistant:` is Echo claiming her answer */
    const block = carriedConversations([
      convo("گزارش", { role: "assistant", content: "من نگاه کردم", author: "roya" }),
    ]);
    expect(block).toContain("roya: من نگاه کردم");
    expect(block).not.toContain("assistant: من نگاه کردم");
  });

  it("carries the NEWEST conversations, and the END of each", () => {
    const block = carriedConversations(
      [
        convo("قدیمی‌ترین", { content: "الف" }),
        convo("میانی", { content: "ب" }),
        convo("تازه", { content: "شروع" }, { content: "میان" }, { content: "پایان" }, { content: "آخرین" }),
      ],
      { ...SMALL, turnsEach: 2 },
    );
    /* the oldest conversation went; the newest kept its last two turns and
       not its first — both halves, because a version that took the FIRST
       conversations and the FIRST turns satisfies neither */
    expect(block).not.toContain("قدیمی‌ترین");
    expect(block).toContain("میانی");
    expect(block).toContain("میان");
    expect(block).toContain("آخرین");
    expect(block).not.toContain("شروع");
    /* chronological: the conversation talked to most recently reads last,
       nearest the question being asked */
    expect(block.indexOf("میانی")).toBeLessThan(block.indexOf("تازه"));
  });

  it("drops tool rows and blanks — and does not announce a conversation left with nothing", () => {
    const block = carriedConversations([
      convo("ابزارها", { role: "tool", content: "list_tasks" }, { content: "   " }),
      convo("واقعی", { content: "سلام" }),
    ]);
    expect(block).not.toContain("ابزارها");
    expect(block).not.toContain("list_tasks");
    expect(block).toContain("[conversation: واقعی]");
  });

  it("clips a carried turn and MARKS the cut", () => {
    const block = carriedConversations([convo("طولانی", { content: "ب".repeat(500) })], SMALL);
    expect(block).toContain(CLIP_MARK);
    /* the clip is on the WORDS: the line is the speaker, the words, the mark */
    expect(block).toContain(`user: ${"ب".repeat(SMALL.turnChars)}${CLIP_MARK}`);
  });

  it("drops WHOLE conversations, oldest first, when the block is over budget", () => {
    const long = (n: number) => "ت".repeat(n);
    const block = carriedConversations(
      [convo("اول", { content: long(50) }), convo("دوم", { content: long(50) })],
      { ...SMALL, conversations: 2, maxChars: 90 },
    );
    expect(block).not.toContain("اول");
    expect(block).toContain("دوم");
    /* whole conversations: no half of the dropped one survives */
    expect(block.split("[conversation:")).toHaveLength(2);
  });

  it("keeps the heading and drops the oldest LINES when one conversation is still too big", () => {
    const block = carriedConversations(
      [convo("تنها", { content: "الف".repeat(20) }, { content: "ب".repeat(20) }, { content: "پایانی" })],
      { ...SMALL, conversations: 1, turnsEach: 3, maxChars: 60, turnChars: 60 },
    );
    /* an unattributed tail is worse than a short one, so the title stays */
    expect(block.startsWith("[conversation: تنها]")).toBe(true);
    expect(block).toContain("پایانی");
    expect(block.length).toBeLessThanOrEqual(60);
  });

  it("answers nothing with nothing — the caller renders no heading at all", () => {
    expect(carriedConversations([])).toBe("");
    expect(carriedConversations([convo("خالی", { role: "tool", content: "x" })])).toBe("");
  });

  it("ships a window that is a working day, and a budget more than one turn fits in", () => {
    /* the relationship, not the numbers (the thread's own rule one file up):
       a per-turn ceiling at or above the block's budget would make every
       carried conversation exactly one clipped line */
    expect(CARRY_LIMITS.turnChars * 2).toBeLessThan(CARRY_LIMITS.maxChars);
    /* and it is BACKGROUND: cheaper than the thread it sits beside, or a
       feature about other conversations costs more than this one */
    expect(CARRY_LIMITS.maxChars).toBeLessThan(HISTORY_LIMITS.maxChars);
    expect(CARRY_LIMITS.turnChars).toBeLessThan(HISTORY_LIMITS.turnChars);
    /* "session" is a working stretch: long enough to survive lunch, short
       enough that last week never arrives wearing the word "recent" */
    expect(CARRY_LIMITS.windowHours).toBeGreaterThanOrEqual(8);
    expect(CARRY_LIMITS.windowHours).toBeLessThanOrEqual(24);
  });
});
