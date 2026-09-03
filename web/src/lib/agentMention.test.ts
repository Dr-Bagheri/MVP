import { describe, expect, it } from "vitest";
import { mentionedAgent } from "./agentMention";

const ROSTER = ["roya", "ava", "sales-desk"];

describe("mentionedAgent", () => {
  it("routes a mention anywhere in the message", () => {
    expect(mentionedAgent("@roya این را برایم بنویس", ROSTER)?.handle).toBe("roya");
    expect(mentionedAgent("این را برایم بنویس @roya", ROSTER)?.handle).toBe("roya");
    expect(mentionedAgent("لطفاً @ava نگاه کن و بگو", ROSTER)?.handle).toBe("ava");
  });

  it("only counts a handle somebody answers to — the control", () => {
    /*
     * The whole reason this takes a roster. Without it "@lunch" routes to an
     * agent that does not exist and the ask returns 400 — an error about a
     * word the person did not think was a command, which is worse than the
     * feature not firing.
     */
    expect(mentionedAgent("let's discuss @lunch tomorrow", ROSTER)).toBeNull();
    expect(mentionedAgent("email me at me@example.com", ROSTER)).toBeNull();
    expect(mentionedAgent("no mention at all", ROSTER)).toBeNull();
  });

  it("matches the way a person types, not the way a column is stored", () => {
    /* handles are lowercase in the database; `@Roya` at the start of a
       sentence is the one place people capitalise by reflex */
    expect(mentionedAgent("@Roya please", ROSTER)?.handle).toBe("roya");
    expect(mentionedAgent("@SALES-DESK", ROSTER)?.handle).toBe("sales-desk");
  });

  it("takes the first and REPORTS the rest rather than refusing", () => {
    const found = mentionedAgent("@ava و @roya نظرتان چیست", ROSTER);
    expect(found?.handle).toBe("ava");
    /* a run has one persona, so the alternative to picking is refusing a
       message because it named two colleagues — and a surface that wants to
       say "Roya was not asked" now has the fact to say it with */
    expect(found?.alsoMentioned).toEqual(["roya"]);
  });

  it("does not repeat a handle mentioned twice", () => {
    expect(mentionedAgent("@roya … @roya", ROSTER)?.alsoMentioned).toEqual([]);
  });

  it("answers null when the roster has not loaded", () => {
    /*
     * The temporal case, and the one a real user hits: the agents list is a
     * separate request, and a message sent in the second before it lands must
     * go to the ordinary assistant rather than to `undefined`. Silent, because
     * an assistant answering is the correct outcome — the mention is still in
     * the text the model reads.
     */
    expect(mentionedAgent("@roya سلام", [])).toBeNull();
  });
});
