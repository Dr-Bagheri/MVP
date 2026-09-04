import { describe, expect, it } from "vitest";
import { decide, ECHO, nameIn, namesFor, rosterFor } from "../src/agent/router.ts";

/**
 * WHO ANSWERS, under the rule the user drew:
 *
 *     handler → echo | roya | ava        and        echo → roya | ava
 *
 * "The default response must come from Echo if I didn't ask for any agent. If
 * asked for an agent, the handler should not give it to Echo to give it to the
 * agent — the agent comes up by itself."
 *
 * The bug that produced this rule is the first test: the person wrote
 * «می‌خوام ببینم که اکو دسترسی داره…» — Echo, by name, in the first six words
 * — and Roya answered, because the message was ABOUT tasks and the classifier
 * weighed the topic against the name. A router that CAN override a name is a
 * router that will.
 */
const ROSTER = rosterFor([
  { handle: "roya", name: "رؤیا" },
  { handle: "ava", name: "آوا" },
]);
const KNOWN = new Set([ECHO, "roya", "ava"]);

const answers = (question: string, incumbent: string | null = null): string =>
  decide(nameIn(question, ROSTER), incumbent, KNOWN).agent;

describe("a named agent takes the turn", () => {
  it("THE REPORTED BUG: naming Echo about a task subject gets Echo", () => {
    /* the exact message, verbatim. Every word after «اکو» is about tasks,
       which is what the old classifier routed on. */
    const asked = "می‌خوام ببینم که اکو دسترسی داره به صفحه تسک‌ها و تسک خلاصه سازی شرکت رو برای من به حالت در حال انجام بذاره";
    expect(answers(asked)).toBe(ECHO);
  });

  it("names a specialist and gets the specialist, in either script", () => {
    expect(answers("رؤیا لطفاً جلسه‌های امروز را بگو")).toBe("roya");
    expect(answers("roya, what meetings are today?")).toBe("roya");
    expect(answers("آوا این را خلاصه کن")).toBe("ava");
    expect(answers("ava, summarise this")).toBe("ava");
  });

  it("takes the hamza-less spelling, because that is what keyboards produce", () => {
    /* «رویا» is «رؤیا» without the hamza, and it is what most people type. A
       name the product does not answer to is this file's bug pointed the other
       way: "I asked for Roya" becomes "nobody was named". */
    expect(answers("رویا این تسک را ببند")).toBe("roya");
  });

  it("an @handle is the same pass — @ is not a letter", () => {
    expect(answers("@ava please look at this")).toBe("ava");
  });

  it("the FIRST name wins when two are present", () => {
    /* "ask Roya, or Ava if she is busy" addresses Roya; the last-match rule
       would answer the aside */
    expect(answers("از رؤیا بپرس، یا آوا اگر سرش شلوغ است")).toBe("roya");
  });
});

describe("nobody named means Echo", () => {
  it("an ordinary question goes to the generalist", () => {
    expect(answers("جلسه‌های این هفته چطور بود؟")).toBe(ECHO);
    expect(answers("summarise last week")).toBe(ECHO);
  });

  it("even when a specialist answered the previous turn", () => {
    /*
     * The directive read literally. An incumbent that keeps the turn would be
     * a SECOND rule about who speaks, and two rules is how somebody ends up
     * unable to predict which colleague replies — which is the complaint this
     * whole file exists to answer.
     */
    expect(answers("و بعدش؟", "roya")).toBe(ECHO);
    const decision = decide(null, "roya", KNOWN);
    expect(decision.rule).toBe("default");
    /* the change of voice is still REPORTED, so the log can show it even
       though it no longer decides anything */
    expect(decision.switched).toBe(true);
  });

  it("a name nobody in the roster has is not a name", () => {
    expect(answers("سارا این را نگاه کن")).toBe(ECHO);
    expect(decide("nobody", null, KNOWN).agent).toBe(ECHO);
  });
});

describe("a name is a word, not a substring", () => {
  it("does not find «آوا» inside «آواز»", () => {
    /*
     * The substring trap this repo has already shipped once, when «دی» matched
     * inside a surname and was reported as a date. Persian has no word
     * boundary `\b` understands, so the boundary is "any letter or digit on
     * either side" — and these are the words that prove it.
     */
    expect(answers("این آواز را برایم پیدا کن")).toBe(ECHO);
    expect(answers("اکوسیستم ما چطور است؟")).toBe(ECHO);
  });

  it("but finds it beside punctuation", () => {
    expect(answers("آوا، این را ببین")).toBe("ava");
    expect(answers("(ava) look")).toBe("ava");
  });

  it("does not match a Latin name inside a longer word", () => {
    expect(answers("the avalanche report")).toBe(ECHO);
    expect(answers("echoing the last point")).toBe(ECHO);
  });
});

describe("the roster", () => {
  it("always contains Echo, even with no agents at all", () => {
    const bare = rosterFor([]);
    expect(bare.map((entry) => entry.handle)).toEqual([ECHO]);
    expect(nameIn("اکو سلام", bare)).toBe(ECHO);
  });

  it("gives an org's own agent its stored name", () => {
    const roster = rosterFor([{ handle: "hesabdar", name: "حسابدار" }]);
    expect(nameIn("حسابدار این فاکتور را ببین", roster)).toBe("hesabdar");
  });

  it("refuses a stored name too short to be safe", () => {
    /* a two-letter name matches inside half the words in a Persian sentence,
       and a false positive here hands the turn to the wrong colleague */
    expect(namesFor("x", "با")).not.toContain("با");
    expect(namesFor("x", "حسابدار")).toContain("حسابدار");
  });

  it("does not duplicate an agent whose handle is echo's", () => {
    const roster = rosterFor([{ handle: ECHO, name: "Echo" }]);
    expect(roster).toHaveLength(1);
  });
});
