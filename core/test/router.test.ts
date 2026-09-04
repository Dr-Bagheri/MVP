import { describe, expect, it } from "vitest";
import {
  decide, ECHO, KEEP_FLOOR, rosterFor, routerPrompt, SWITCH_FLOOR,
  type RouterVerdict,
} from "../src/agent/router.ts";

/**
 * THE ROUTER'S HYSTERESIS, WHICH IS WHERE THE INTERESTING FAILURES LIVE.
 *
 * The decision function is pure and separate from the model call for exactly
 * this reason: "which agent did the classifier name" is a model question, and
 * "what do we do when it names a different one than last time" is ours. Only
 * the second has failure modes worth a suite.
 *
 * The load-bearing case is the NEGATIVE CONTROL on stickiness. A test that
 * only asserts "a follow-up stays with the incumbent" passes perfectly against
 * a router that never switches at all — which is a worse product than the one
 * being fixed, and indistinguishable from it in every test you would naturally
 * write.
 */
const KNOWN = new Set([ECHO, "roya", "ava"]);

const verdict = (over: Partial<RouterVerdict> = {}): RouterVerdict => ({
  agent: "roya",
  confidence: 0.9,
  continues_previous_topic: false,
  ...over,
});

describe("who answers this turn", () => {
  it("first turn: a confident choice is taken", () => {
    const d = decide(verdict(), null, KNOWN);
    expect(d.agent).toBe("roya");
    expect(d.rule).toBe("model");
    expect(d.switched).toBe(false);   // nobody was displaced
  });

  it("first turn, unsure: Echo answers, and the rule says why", () => {
    /* Echo is the abstain target and a real surface — most routers have to
       invent an error state here. `floor` is distinguishable in the log from
       a confident route to Echo, which is the point of naming rules at all. */
    const d = decide(verdict({ confidence: KEEP_FLOOR - 0.01 }), null, KNOWN);
    expect(d.agent).toBe(ECHO);
    expect(d.rule).toBe("floor");
  });

  it("a follow-up stays with whoever is already speaking", () => {
    /*
     * «و بعدش؟» after an answer from Ava. The classifier will read that as
     * carrying no topic and may name anyone; the incumbent keeps it.
     */
    const d = decide(
      verdict({ agent: ECHO, confidence: 0.9, continues_previous_topic: true }),
      "ava",
      KNOWN,
    );
    expect(d.agent).toBe("ava");
    expect(d.rule).toBe("sticky");
    expect(d.switched).toBe(false);
  });

  it("THE CONTROL: a genuine topic change DOES switch", () => {
    /*
     * Without this, every assertion above is satisfied by a router that
     * returns the incumbent unconditionally — which would pass the whole file
     * and ship an agent nobody can ever hand a turn to.
     */
    const d = decide(
      verdict({ agent: "roya", confidence: SWITCH_FLOOR, continues_previous_topic: false }),
      "ava",
      KNOWN,
    );
    expect(d.agent).toBe("roya");
    expect(d.switched).toBe(true);
  });

  it("a lukewarm opinion does not take the turn away", () => {
    /* cheap to stay, expensive to move: the same confidence that WOULD win an
       empty thread is not enough to displace somebody */
    const c = (KEEP_FLOOR + SWITCH_FLOOR) / 2;
    expect(decide(verdict({ confidence: c }), null, KNOWN).agent).toBe("roya");
    expect(decide(verdict({ confidence: c }), "ava", KNOWN).agent).toBe("ava");
  });

  it("agreeing with the incumbent is not a switch", () => {
    const d = decide(verdict({ agent: "ava" }), "ava", KNOWN);
    expect(d.agent).toBe("ava");
    expect(d.switched).toBe(false);
  });

  it("an unknown agent name falls to Echo and does not throw", () => {
    /* a hallucinated handle is a 500 waiting to happen, and the model is free
       to invent one whatever the schema says */
    const d = decide(verdict({ agent: "میلاد" }), null, KNOWN);
    expect(d.agent).toBe(ECHO);
    expect(d.rule).toBe("fallback");
  });

  it("a router that could not answer is a DIFFERENT nothing from one that chose Echo", () => {
    /*
     * The two look identical in the product and mean opposite things about the
     * router's health, so they are different rules and the confidence is null
     * rather than zero — an absence, not a measurement.
     */
    const dead = decide(null, null, KNOWN);
    expect(dead.agent).toBe(ECHO);
    expect(dead.rule).toBe("fallback");
    expect(dead.confidence).toBeNull();

    const chose = decide(verdict({ agent: ECHO, confidence: 0.95 }), null, KNOWN);
    expect(chose.agent).toBe(ECHO);
    expect(chose.rule).toBe("model");
    expect(chose.confidence).toBe(0.95);
  });

  it("an outage keeps the incumbent rather than yanking the thread to Echo", () => {
    const d = decide(null, "roya", KNOWN);
    expect(d.agent).toBe("roya");
    expect(d.rule).toBe("fallback");
  });
});

describe("what the router is told", () => {
  it("does NOT carry the thread — only the roster, the incumbent and the shape", () => {
    /*
     * The regression case, from a router that shipped this bug: with the whole
     * conversation in the prompt, "looks good, commit it" routed to a tiny
     * model because the classifier read the acknowledgement instead of the
     * work. The prompt builder takes no messages at all — asserted as an
     * ABSENCE, because the version that quietly starts accepting them renders
     * perfectly.
     */
    const prompt = routerPrompt(
      [{ handle: "roya", owns: "کارها", examples: ["چه تسکی دارم؟"] }],
      "ava",
    );
    expect(prompt).toContain("roya");
    expect(prompt).toContain("ava");
    expect(routerPrompt.length, "the builder takes roster + incumbent, nothing else").toBe(2);
  });

  it("describes Echo in the reader's own language", () => {
    /*
     * Persian-first means the default path hides the bug: a roster written
     * only in English routes the two locales differently and nobody notices,
     * because the language nobody tests is the one that keeps working by
     * accident. Asserted on the locale that is NOT the default here — the one
     * a reader of this repo is less likely to open.
     */
    const fa = rosterFor([], "fa")[0]!;
    const en = rosterFor([], "en")[0]!;
    expect(fa.owns).not.toBe(en.owns);
    expect(en.owns).toMatch(/assistant/i);
    expect(fa.examples.length).toBeGreaterThan(0);
    expect(en.examples.length).toBeGreaterThan(0);
  });

  it("puts Echo first, as the obvious home for an unclassifiable message", () => {
    const roster = rosterFor([{ handle: "roya", description: "کارها" }], "fa");
    expect(roster[0]!.handle).toBe(ECHO);
    expect(roster.map((r) => r.handle)).toContain("roya");
  });

  it("carries each agent's OWN description — the routing contract", () => {
    /*
     * When two responders keep being confused for one another the fix is this
     * sentence, not the model. Derived from the agents the caller can see, so
     * a renamed or re-described agent re-describes itself to the router with
     * no second list to keep in step.
     */
    const roster = rosterFor([{ handle: "ava", description: "می‌خواند و گزارش می‌دهد" }], "fa");
    expect(roster.find((r) => r.handle === "ava")!.owns).toBe("می‌خواند و گزارش می‌دهد");
  });
});
