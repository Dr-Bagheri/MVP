import { describe, expect, it } from "vitest";
import { decide, ECHO, nameIn, namesFor, namesIn, rosterFor } from "../src/agent/router.ts";

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

/** who answers FIRST — with nobody on the floor unless the test says so */
const answers = (question: string, incumbent: string | null = null, floor: string[] = []): string =>
  decide(namesIn(question, ROSTER), floor, incumbent, KNOWN).agent;

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

  it("two names: the FIRST streams and BOTH answer, in the order they were said (user, 2026-09-06)", () => {
    /* "ask Roya, or Ava if she is busy" — Roya first, Ava after her; the
       last-match rule would have answered the aside alone */
    const decision = decide(namesIn("از رؤیا بپرس، یا آوا اگر سرش شلوغ است", ROSTER), [], null, KNOWN);
    expect(decision.agent).toBe("roya");
    expect(decision.responders).toEqual(["roya", "ava"]);
    expect(decision.floor, "both hold the floor now").toEqual(["roya", "ava"]);
  });
});

describe("nobody named means Echo", () => {
  it("an ordinary question goes to the generalist", () => {
    expect(answers("جلسه‌های این هفته چطور بود؟")).toBe(ECHO);
    expect(answers("summarise last week")).toBe(ECHO);
  });

  it("even when a specialist answered the previous turn WITHOUT being called", () => {
    /*
     * The incumbent still decides nothing (2026-09-04): who SPOKE last is a
     * log fact. What decides is who was CALLED — the floor, below. A thread
     * where Roya answered because Echo handed her a piece has an empty floor,
     * and «و بعدش؟» goes back to Echo.
     */
    expect(answers("و بعدش؟", "roya")).toBe(ECHO);
    const decision = decide([], [], "roya", KNOWN);
    expect(decision.rule).toBe("default");
    /* the change of voice is still REPORTED, so the log can show it */
    expect(decision.switched).toBe(true);
  });

  it("a name nobody in the roster has is not a name", () => {
    expect(answers("سارا این را نگاه کن")).toBe(ECHO);
    expect(decide(["nobody"], [], null, KNOWN).agent).toBe(ECHO);
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


/**
 * THE FLOOR (user directive, 2026-09-06: "when I ask for Roya she should keep
 * talking back until I say someone else's name — like humans: the person who
 * was called joins and answers until you address somebody else"). Rulings the
 * same day: two names → both answer; released only by a name or the ×.
 *
 * This REVERSES the 2026-09-04 reading for one case — a follow-up after a
 * CALLED colleague — and keeps every other rule: a name beats everything, and
 * nothing infers. Verified red against the old `decide`, which sent «و بعدش؟»
 * to Echo whatever the floor said.
 */
describe("the floor", () => {
  it("a called colleague keeps answering the messages that name nobody", () => {
    expect(answers("رؤیا بیا اینجا")).toBe("roya");
    const next = decide(namesIn("و بعدش؟", ROSTER), ["roya"], "roya", KNOWN);
    expect(next.agent).toBe("roya");
    expect(next.rule).toBe("floor");
    expect(next.floor).toEqual(["roya"]);
  });

  it("naming Echo hands the floor back, and the floor is stored as nothing", () => {
    const back = decide(namesIn("اکو، تو بگو", ROSTER), ["roya"], "roya", KNOWN);
    expect(back.agent).toBe(ECHO);
    expect(back.responders).toEqual([ECHO]);
    expect(back.floor, "[echo] is the default and is stored as []").toEqual([]);
    /* and the message after that is Echo's, with nobody on the floor */
    expect(answers("و بعدش؟", ECHO, back.floor)).toBe(ECHO);
  });

  it("the × releases it: an empty floor and no name is Echo", () => {
    expect(decide([], [], "roya", KNOWN).agent).toBe(ECHO);
  });

  it("a name always beats the floor — Ava called while Roya holds it takes it over", () => {
    const handoff = decide(namesIn("آوا، نظر تو چیه؟", ROSTER), ["roya"], "roya", KNOWN);
    expect(handoff.responders).toEqual(["ava"]);
    expect(handoff.floor).toEqual(["ava"]);
    expect(handoff.switched).toBe(true);
  });

  it("Echo named BESIDE a colleague: both answer, both hold the floor", () => {
    const both = decide(namesIn("اکو و رؤیا، هر دو بگید", ROSTER), [], null, KNOWN);
    expect(both.responders).toEqual([ECHO, "roya"]);
    expect(both.floor).toEqual([ECHO, "roya"]);
  });

  it("a holder the roster no longer has is dropped, and an empty floor falls to Echo", () => {
    const gone = decide([], ["someone_archived"], null, KNOWN);
    expect(gone.agent).toBe(ECHO);
    expect(gone.floor).toEqual([]);
    const half = decide([], ["someone_archived", "ava"], null, KNOWN);
    expect(half.responders).toEqual(["ava"]);
  });

  it("namesIn keeps the order of address and never repeats a name", () => {
    expect(namesIn("رؤیا و آوا و باز رؤیا", ROSTER)).toEqual(["roya", "ava"]);
    expect(namesIn("@ava then @roya", ROSTER)).toEqual(["ava", "roya"]);
    expect(namesIn("جلسه‌های این هفته", ROSTER)).toEqual([]);
    /* the one-name helper is the first of these, so the room keeps its rule */
    expect(nameIn("@ava then @roya", ROSTER)).toBe("ava");
  });
});
