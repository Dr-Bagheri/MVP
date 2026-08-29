import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/api/types";

/**
 * **Streaming costs one parse, not one parse per message in the thread.**
 *
 * `parseAnswerBlocks` is a global regex sweep plus a `JSON.parse` per block,
 * and it ran in the thread's render body for EVERY message. A stream replaces
 * the messages array ten to thirty times a second, so the price of typing one
 * answer scaled with the length of the whole conversation — a forty-turn
 * thread re-parsed forty answers to add one character to the last one.
 *
 * Counting the parses is the only way to see this. It is invisible on screen
 * (the output is identical either way), invisible to a typecheck, and
 * invisible to every other test in this directory — the defect is pure cost,
 * so the assertion has to be about cost.
 *
 * Verified red by deleting `memo(...)` from `MessageRow`: a delta that parses
 * ONE message parsed all six.
 */
const parseCalls: string[] = [];
vi.mock("@/lib/answerBlocks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/answerBlocks")>();
  return {
    ...real,
    parseAnswerBlocks: (text: string) => {
      parseCalls.push(text);
      return real.parseAnswerBlocks(text);
    },
  };
});

const { ConversationThread } = await import("./ConversationThread");

const assistant = (id: string, content: string): AgentMessage => ({
  id, role: "assistant", content, tool_calls: [], proposal: null,
});

/**
 * Six settled answers plus the one being written.
 *
 * **`applyDelta` is the hub's reducer, transcribed** — `prev.map(m => m.id ===
 * replyId ? {...m, content: m.content + delta} : m)`. That matters more than
 * it looks: the first version of this fixture rebuilt all seven objects on
 * every delta, which no memo can skip, and the test reported 35 parses against
 * a working implementation. A fixture written from my own idea of the shape
 * measured my idea. The producer's line is the fixture.
 */
function freshThread(): AgentMessage[] {
  return [
    assistant("a1", "نخست: قرارداد تا پایان مرداد اعتبار دارد."),
    assistant("a2", "دوم: پرداخت‌ها ماهانه است."),
    assistant("a3", "سوم: تمدید خودکار نیست."),
    assistant("a4", "چهارم: جریمهٔ تأخیر ندارد."),
    assistant("a5", "پنجم: فسخ با یک ماه اعلام."),
    assistant("a6", "ششم: دادگاه صالح تهران است."),
    { ...assistant("live", "پاسخ"), streaming: true },
  ];
}

function applyDelta(prev: AgentMessage[], delta: string): AgentMessage[] {
  return prev.map((m) => (m.id === "live" ? { ...m, content: m.content + delta } : m));
}

beforeEach(() => {
  parseCalls.length = 0;
});

describe("streaming does not re-parse the whole thread", () => {
  it("a delta re-parses only the message it changed", () => {
    let messages = freshThread();
    const { rerender } = render(<ConversationThread streaming messages={messages} />);

    /* the first paint legitimately parses all seven */
    expect(parseCalls).toHaveLength(7);
    parseCalls.length = 0;

    /* five deltas onto the last message — the six settled answers are handed
       back by reference, exactly as the hub's reducer hands them back */
    for (const delta of [" ", "د", "ر", "ح", "ا"]) {
      messages = applyDelta(messages, delta);
      rerender(<ConversationThread streaming messages={messages} />);
    }

    /*
     * The number that matters. Five deltas over a seven-message thread cost
     * five parses; before the memo they cost thirty-five, and the multiplier
     * was the length of the conversation.
     */
    expect(parseCalls).toHaveLength(5);
    expect(parseCalls.every((text) => text.startsWith("پاسخ"))).toBe(true);
  });

  it("an unchanged thread re-rendered for another reason parses nothing", () => {
    const messages = freshThread();
    const { rerender } = render(<ConversationThread streaming messages={messages} />);
    parseCalls.length = 0;

    /* same array, same objects — a parent re-render must cost nothing here */
    rerender(<ConversationThread streaming messages={messages} />);
    expect(parseCalls).toHaveLength(0);
  });

  /*
   * The control. Without this the two assertions above cannot distinguish "the
   * memo works" from "the mock never sees anything" — a spy wired to the wrong
   * module counts zero and reports success on both.
   */
  it("the counter really is watching the parser", () => {
    render(<ConversationThread messages={[assistant("solo", "یک پاسخ")]} />);
    expect(parseCalls).toEqual(["یک پاسخ"]);
  });
});
