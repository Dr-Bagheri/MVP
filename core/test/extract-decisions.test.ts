import { describe, expect, it } from "vitest";
import {
  composeExtractionInput, parseExtraction, resolveOwner,
} from "../src/worker/extract-decisions.ts";
import { foldName } from "../src/agent/router.ts";

/**
 * 0209 — the extraction pass, at the two places it can go wrong on its own:
 * reading a model's answer, and turning a spoken name into an account.
 *
 * The model call itself is not here. What IS here is every branch that
 * decides what reaches the organisation's record, because a wrong reading of
 * a transcript lands as a row somebody may later confirm.
 */

describe("reading the model's answer", () => {
  it("tells an UNREADABLE answer from a meeting that decided nothing", () => {
    /* THE ASSERTION THIS FILE EXISTS FOR (rule 12). Both are "no decisions"
       and they mean opposite things: one is a pass that failed, the other is
       a meeting where nothing was settled. Collapsing them tells somebody
       their meeting decided nothing when in fact nobody looked. */
    expect(parseExtraction("متأسفم، نمی‌توانم کمک کنم.")).toBeNull();
    /* AND the shape a model actually produces when it half-obeys: valid JSON
       that invents the field name. The prose case above exits at the "no
       braces" guard, so on its own it could never have caught a version that
       answered [] to a body it could not read — this is the branch the
       mutation lives on, and it was missing until the mutation said so. */
    expect(parseExtraction('{"decisions":[{"text":"بودجه"}]}')).toBeNull();
    expect(parseExtraction('{"items":"چند تا"}')).toBeNull();
    expect(parseExtraction('{"items":[]}')).toEqual([]);
  });

  it("reads a fenced answer, because models fence JSON", () => {
    const out = parseExtraction('```json\n{"items":[{"kind":"decision","text":"بودجه کم می‌شود"}]}\n```');
    expect(out).toHaveLength(1);
    expect(out![0]!.text).toBe("بودجه کم می‌شود");
  });

  it("drops a claim with no sentence rather than keeping a placeholder", () => {
    /* a row reading "—" in the decisions list is a fabricated decision
       wearing an ellipsis */
    const out = parseExtraction('{"items":[{"kind":"decision","text":"   "},{"kind":"decision","text":"واقعی"}]}');
    expect(out).toEqual([expect.objectContaining({ text: "واقعی" })]);
  });

  it("drops HALF a span rather than storing a citation that cannot be played", () => {
    const out = parseExtraction(
      '{"items":[{"kind":"decision","text":"الف","start_ms":1000},'
      + '{"kind":"decision","text":"ب","start_ms":5000,"end_ms":1000},'
      + '{"kind":"decision","text":"ج","start_ms":1000,"end_ms":5000}]}',
    );
    expect(out!.map((c) => [c.evidence_start_ms, c.evidence_end_ms])).toEqual([
      [null, null],   // one end only
      [null, null],   // backwards
      [1000, 5000],   // the control: a real span survives
    ]);
  });

  it("refuses a due date that is not a day", () => {
    const out = parseExtraction(
      '{"items":[{"kind":"commitment","text":"الف","due_on":"شنبه"},'
      + '{"kind":"commitment","text":"ب","due_on":"2026-10-02"}]}',
    );
    expect(out!.map((c) => c.due_on)).toEqual([null, "2026-10-02"]);
  });

  it("caps an enthusiastic model", () => {
    const many = Array.from({ length: 90 }, (_, i) => `{"kind":"decision","text":"t${i}"}`);
    expect(parseExtraction(`{"items":[${many.join(",")}]}`)).toHaveLength(40);
  });

  it("treats anything but 'commitment' as a decision", () => {
    const out = parseExtraction('{"items":[{"kind":"promise","text":"الف"},{"kind":"commitment","text":"ب"}]}');
    expect(out!.map((c) => c.kind)).toEqual(["decision", "commitment"]);
  });
});

describe("the prompt", () => {
  it("fences the transcript and names it as data", () => {
    const input = composeExtractionInput("سلام. تصمیم گرفتیم.", "2026-09-08");
    expect(input).toContain("<<<TRANSCRIPT");
    /* a meeting is a place strangers speak, and "ignore your instructions"
       said aloud in one is a sentence in the record — the fence is what makes
       that true rather than hoped for (M43's own reasoning) */
    expect(input.indexOf("<<<TRANSCRIPT")).toBeGreaterThan(input.indexOf("قواعد"));
    expect(input).toContain("2026-09-08");
  });

  it("tells the model not to guess a name", () => {
    /* the rule that keeps a commitment from being filed against a colleague
       who never made it — asserted because a prompt is the only place it is
       said, and a prompt nobody asserts is a prompt somebody trims */
    expect(composeExtractionInput("x", "2026-09-08")).toContain("اسم حدس نزن");
  });
});

describe("a spoken name becomes an account, or nobody", () => {
  /* TWO PEOPLE ANSWER TO «سینا». The first draft of this fixture gave them
     full names only, so a bare «سینا» matched NEITHER — and the ambiguity
     test passed for the same reason "a name nobody has" passes, which is to
     say it could never have failed. A roster where two colleagues carry the
     same short name is the ordinary case and the one the rule is about. */
  const people = [
    { id: "u-1", names: ["سینا", "سینا سپاسی", "Sina Sepasi", "sina"] },
    { id: "u-2", names: ["سینا", "سینا محمدی", "Sina Mohammadi", "sinam"] },
    { id: "u-3", names: ["بهناز بهجتی", "Behnaaz Behjati", "behnaaz"] },
  ];

  it("matches a whole name, in either script", () => {
    expect(resolveOwner("بهناز بهجتی", people, foldName)).toBe("u-3");
    expect(resolveOwner("Behnaaz Behjati", people, foldName)).toBe("u-3");
    expect(resolveOwner("behnaaz", people, foldName)).toBe("u-3");
  });

  it("refuses an AMBIGUOUS first name rather than picking one", () => {
    /* «سینا» is two people. On 2026-09-06 a lone prefix match made «ali» the
       only Alireza and a consent card named somebody else's handle; here the
       cost of guessing is a commitment filed against a colleague who never
       made it, so the answer is nobody. */
    expect(resolveOwner("سینا", people, foldName)).toBeNull();
    /* the discriminating half: an unambiguous name in the SAME fixture still
       resolves, so "refuses everything" cannot pass the line above */
    expect(resolveOwner("سینا سپاسی", people, foldName)).toBe("u-1");
  });

  it("refuses a name nobody has, and a name at all when none was heard", () => {
    expect(resolveOwner("کسی که نیست", people, foldName)).toBeNull();
    expect(resolveOwner(null, people, foldName)).toBeNull();
    expect(resolveOwner("   ", people, foldName)).toBeNull();
  });

  it("folds the way the rest of the platform folds", () => {
    /* ي/ك and ZWNJ: the router already folds them before matching an agent's
       name, and a second folding rule here would be a second answer to "is
       this the same name" */
    expect(resolveOwner("بهناز بهجتي", people, foldName)).toBe("u-3");
  });
});
