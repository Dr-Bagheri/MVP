import { describe, expect, it, vi } from "vitest";
import { composeMinutes, composeMinutesInput, wordBudget } from "../src/api/minutes-compose.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * THE MINUTES' PROSE, CUT TO THE PAGE (user directive, 2026-09-17: "all the
 * information in summarization must be fit inside it — use the agent to do it
 * as well").
 *
 * Two halves are worth asserting and neither is visible from a screen: what
 * the model is ASKED (a budget that follows the organisation's own letterhead,
 * and an instruction not to restate the ledger) and what is done with an
 * answer that is not prose.
 */
const identity = { userId: "u1", orgId: "o1", role: "member" } as unknown as Identity;

const runtime = (answer: { failed?: boolean; text?: string }) => ({
  run: vi.fn(async () => ({ failed: answer.failed === true, text: answer.text ?? "" })),
}) as unknown as Parameters<typeof composeMinutes>[0]["runtime"];

describe("how many words fit on the paper", () => {
  it("shrinks as the letterhead takes more of the page", () => {
    /* the whole point of reading db/0228's margins: a sheet with a deep
       header leaves less room, and a budget that ignored it would write the
       same length for every organisation */
    const shallow = wordBudget(20, 20);
    const deep = wordBudget(70, 40);
    expect(deep).toBeLessThan(shallow);
  });

  it("never falls to a sentence, and never runs past a page", () => {
    /* a budget of nine words is a refusal wearing a number, and one of ten
       thousand is no budget at all — both ends are clamped */
    expect(wordBudget(120, 120)).toBeGreaterThanOrEqual(60);
    expect(wordBudget(0, 0)).toBeLessThanOrEqual(600);
  });
});

describe("what the model is asked", () => {
  const input = () => composeMinutesInput({
    title: "جلسهٔ هفتگی", dateLabel: "۱۴۰۵/۰۶/۲۳",
    attendees: ["رؤیا", "سینا"],
    summary: "دربارهٔ بودجه گفت‌وگو شد.",
    decisions: ["قرارداد تمدید شود"],
    actions: ["دادهٔ نمونه تازه شود"],
    words: 240,
  });

  it("hands over the material and the budget", () => {
    const text = input();
    expect(text).toContain("دربارهٔ بودجه گفت‌وگو شد.");
    expect(text).toContain("رؤیا");
    expect(text).toContain("240");
  });

  it("forbids restating the ledger it was given for context", () => {
    /* the decisions and the actions are ROWS the document prints in their own
       sections. A model that retold them would put a second, differently
       worded copy of the ledger into a document people sign. */
    const text = input();
    expect(text).toContain("تکرارشان نکن");
    expect(text).toContain("هیچ عدد، تاریخ، نام یا تصمیمی اضافه نکن");
  });

  it("refuses to choose a language, in both languages", () => {
    /* the first line is where a model takes its own language from, so it has
       to be the line that says «answer in the language of the material» —
       db/0222's shape, and the extraction pass's */
    const text = input();
    const firstLines = text.split("\n").slice(0, 3).join("\n");
    expect(firstLines).toContain("زبانِ جواب همان زبانِ مطالبِ زیر است");
    expect(firstLines).toContain("Answer in the language of the material");
  });
});

describe("what comes back", () => {
  const call = (answer: { failed?: boolean; text?: string }) => composeMinutes({
    runtime: runtime(answer), identity, callId: "c1", input: "…", deps: {},
  });

  it("passes the prose through", async () => {
    expect((await call({ text: "  در این جلسه…  " })).body).toBe("در این جلسه…");
  });

  it("answers NULL when the provider refused", async () => {
    /* the null IS the forfeit (M21), and the caller renders it as one: a
       provider that refused is not a meeting with nothing to say */
    expect((await call({ failed: true, text: "" })).body).toBeNull();
  });

  it("answers null to an empty answer and to a JSON one", async () => {
    expect((await call({ text: "   " })).body).toBeNull();
    /* a model that replied with an object has not answered THIS question;
       writing it in would put braces in front of a reader */
    expect((await call({ text: '{"body": "…"}' })).body).toBeNull();
  });

  it("offers the pass NO tools", async () => {
    /* what this produces is addressed to people outside the room (M44's
       blast-radius rule), and it is being asked to re-tell material it was
       handed rather than to go and find more */
    const rt = runtime({ text: "…" });
    await composeMinutes({ runtime: rt, identity, callId: null, input: "…", deps: {} });
    const passed = (rt.run as unknown as { mock: { calls: Array<[{ tools: unknown[] }]> } }).mock.calls[0]![0];
    expect(passed.tools).toEqual([]);
  });
});
