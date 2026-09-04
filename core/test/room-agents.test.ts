import { describe, expect, it } from "vitest";
import { roomResponder } from "../src/agent/router.ts";
import { roomTranscript } from "../src/api/chat.ts";
import type { ChatMessageRecord } from "../src/api/chat.ts";

/**
 * THE ROOM'S AGENTS (2026-09-05 directive), and the reason both of these are
 * functions rather than lines inside the route: every rule here is invisible
 * from a chair.
 *
 * A hop cap that never fires shows up as a bill. A self-call shows up as an
 * agent talking to itself, which reads as the model being odd rather than as
 * a missing guard. A transcript that labels everybody the same makes an agent
 * answer "I could not find anything", which reads as an agent that looked.
 * None of the three is reproducible without spending money on two models —
 * and all three are reproducible by calling a function.
 */

const LIMITS = { chars: 20000, unknown: "همکار", agent: "دستیار" };

function message(over: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: "m-1", seq: 1, channel_id: "c-1", author_kind: "user", author_id: "u-1",
    agent_handle: null, body: "سلام", deleted: false, edited_at: null,
    created_at: "2026-09-05T08:00:00.000Z", mentions: [], reactions: [], reply_to: null,
    ...over,
  };
}

describe("who answers in a room", () => {
  it("answers when named, and stays silent when nobody is", () => {
    /* the rule that has not changed, and the control for everything below:
       a version that answered unconditionally would satisfy every positive
       assertion in this file */
    expect(roomResponder("roya", { hops: 0, max: 4 })).toBe("roya");
    expect(roomResponder(null, { hops: 0, max: 4 })).toBeNull();
  });

  it("treats ANSWERING an agent as naming it", () => {
    /*
     * User directive: "when you reply on a bot message it must answer you, it
     * does not always need to put @ yourself".
     *
     * The composer also writes the handle into the draft, which is the
     * visible half — but a person who deletes it before sending still meant
     * to answer Roya, and this is the half that keeps that true.
     */
    expect(roomResponder(null, { replyTo: "roya", hops: 0, max: 4 })).toBe("roya");
  });

  it("lets a written name beat the message being answered", () => {
    /* press reply on Roya, then name Ava: the sentence wins. Without this,
       handing a question on inside a reply would be impossible — the reply
       target would swallow every mention. */
    expect(roomResponder("ava", { replyTo: "roya", hops: 0, max: 4 })).toBe("ava");
  });

  it("never lets an agent answer ITSELF", () => {
    /* an agent's own sentence carries its own name often enough that without
       this the first hand-off is usually a self-call, and a self-call is a
       loop that looks like a conversation */
    expect(roomResponder("roya", { speaker: "roya", hops: 1, max: 4 })).toBeNull();
    /* and the discriminating half: naming somebody ELSE is exactly what the
       hand-off is for, so it must survive */
    expect(roomResponder("ava", { speaker: "roya", hops: 1, max: 4 })).toBe("ava");
  });

  it("stops the chain at the cap, however loudly it is named", () => {
    /* the guard that is only ever visible as money. `written` is non-null and
       `speaker` is somebody else — every other rule says answer — so this
       assertion can only be about the cap. */
    expect(roomResponder("ava", { speaker: "roya", hops: 4, max: 4 })).toBeNull();
    expect(roomResponder("ava", { speaker: "roya", hops: 3, max: 4 })).toBe("ava");
  });

  it("counts a person's turn as hop zero, so a chain of four is four answers", () => {
    /* walked rather than reasoned about, because off-by-one here is either a
       chain that stops one short or one that costs an extra model call */
    const reached: string[] = [];
    let speaker: string | null = null;
    for (let hops = 0; hops < 10; hops += 1) {
      const next = roomResponder(speaker === "roya" ? "ava" : "roya",
        { speaker, hops, max: 4 });
      if (next === null) break;
      reached.push(next);
      speaker = next;
    }
    expect(reached).toEqual(["roya", "ava", "roya", "ava"]);
  });
});

describe("the room's words, as an agent reads them", () => {
  it("names the speaker, so an answer can say who decided what", () => {
    const out = roomTranscript(
      [
        message({ id: "m-1", author_id: "u-1", body: "من جلسه را می‌گیرم" }),
        message({ id: "m-2", author_id: "u-2", body: "باشد" }),
      ],
      new Map([["u-1", "سارا"], ["u-2", "مریم"]]),
      LIMITS,
    );
    expect(out).toBe("سارا: من جلسه را می‌گیرم\nمریم: باشد");
    /* the defect this replaces: every human flattened to one label, so an
       agent asked "what did Sara decide" read the sentence and could not
       tell whose it was */
    expect(out).not.toContain("همکار:");
  });

  it("falls back to a word rather than to an empty name", () => {
    /* somebody who left the org is not in the roster any more, and «: سلام»
       with nothing in front of it reads as a formatting bug */
    const out = roomTranscript(
      [message({ author_id: "gone", body: "سلام" })],
      new Map(),
      LIMITS,
    );
    expect(out).toBe("همکار: سلام");
  });

  it("marks an agent's turn with its handle", () => {
    const out = roomTranscript(
      [message({ author_kind: "agent", author_id: null, agent_handle: "roya", body: "بله" })],
      new Map(),
      LIMITS,
    );
    expect(out).toBe("roya: بله");
  });

  it("leaves a REMOVED message out entirely", () => {
    /* «[حذف‌شده]» in a prompt tells a model there was something there, which
       is the one thing a tombstone exists not to say */
    const out = roomTranscript(
      [
        message({ id: "m-1", author_id: "u-1", body: "اول" }),
        message({ id: "m-2", author_id: "u-1", body: null, deleted: true }),
        message({ id: "m-3", author_id: "u-1", body: "سوم" }),
      ],
      new Map([["u-1", "سارا"]]),
      LIMITS,
    );
    expect(out).toBe("سارا: اول\nسارا: سوم");
  });

  it("trims the OLDEST lines when the window is too long", () => {
    /*
     * The direction is the whole assertion. A budget spent on the oldest
     * lines answers yesterday's question, and the version that trims the
     * other way passes any test that only checks the length.
     */
    const many = Array.from({ length: 50 }, (_, i) =>
      message({ id: `m-${i}`, author_id: "u-1", body: `پیام شمارهٔ ${i}` }));
    const out = roomTranscript(many, new Map([["u-1", "س"]]), { ...LIMITS, chars: 120 });

    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("شمارهٔ 49");
    expect(out).not.toContain("شمارهٔ 0");
  });

  it("keeps the last line even when it alone is over budget", () => {
    /* the loop must not empty the transcript: an agent with no context at all
       is worse than one with a long line, and "" would render as if the room
       had never been used */
    const out = roomTranscript(
      [message({ author_id: "u-1", body: "ی".repeat(500) })],
      new Map([["u-1", "س"]]),
      { ...LIMITS, chars: 50 },
    );
    expect(out.length).toBeGreaterThan(50);
  });
});
