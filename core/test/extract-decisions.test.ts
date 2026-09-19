import { describe, expect, it } from "vitest";
import {
  composeExtractionInput, normaliseKind, parseExtraction, resolveOwner,
} from "../src/worker/extract-decisions.ts";
import { MEETING_ITEM_KINDS } from "../src/api/vocabulary.ts";
import { foldName } from "../src/agent/router.ts";

/**
 * 0209 → 2026-09-19 — the extraction pass, at the places it can go wrong on
 * its own: reading a model's answer, deciding what KIND a row is, and turning
 * a spoken name into an account.
 *
 * The model call itself is not here. What IS here is every branch that
 * decides what reaches the organisation's record, because a wrong reading of
 * a transcript lands as a row somebody may later confirm.
 */

describe("reading the model's answer", () => {
  it("tells an UNREADABLE answer from a meeting that produced nothing", () => {
    /* THE ASSERTION THIS FILE EXISTS FOR (rule 12). Both are "no rows" and
       they mean opposite things: one is a pass that failed, the other is a
       meeting where nothing was settled. Collapsing them tells somebody their
       meeting decided nothing when in fact nobody looked. */
    expect(parseExtraction("متأسفم، نمی‌توانم کمک کنم.")).toBeNull();
    /* AND the shape a model actually produces when it half-obeys: valid JSON
       that invents the field name. The prose case above exits at the "no
       braces" guard, so on its own it could never have caught a version that
       answered [] to a body it could not read. */
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
      '{"items":[{"kind":"action","text":"الف","due_on":"شنبه"},'
      + '{"kind":"action","text":"ب","due_on":"2026-10-02"}]}',
    );
    expect(out!.map((c) => c.due_on)).toEqual([null, "2026-10-02"]);
  });

  it("caps an enthusiastic model", () => {
    const many = Array.from({ length: 90 }, (_, i) => `{"kind":"decision","text":"t${i}"}`);
    expect(parseExtraction(`{"items":[${many.join(",")}]}`)).toHaveLength(40);
  });
});

describe("what KIND a row is (2026-09-19: five kinds, not two)", () => {
  it("files every kind the ledger knows, as the ledger spells it", () => {
    /*
     * A FIXTURE IN THE SHAPE A MODEL ACTUALLY ANSWERS — fenced, every field
     * present, one row per kind, the owner and the day on the two kinds that
     * carry them. The `kind` values are the schema's own words; the aliases
     * are the next test's subject.
     */
    const answer = "```json\n" + JSON.stringify({
      items: [
        { kind: "decision", text: "قرار شد قرارداد امضا شود", detail: "سینا پیشنهاد داد، همه موافقت کردند", owner_name: null, due_on: null, start_ms: 1000, end_ms: 4000 },
        { kind: "action", text: "من گزارش هزینه‌ها را تا شنبه می‌فرستم", detail: "کارول قبول کرد", owner_name: "کارول", due_on: "2026-09-26", start_ms: 9000, end_ms: 12000 },
        { kind: "project", text: "برای دیتابیس صوتی یه پروژهٔ جدا باز کنیم", detail: "بهناز لید شد", owner_name: "بهناز", due_on: null, start_ms: 20000, end_ms: 26000 },
        { kind: "question", text: "بودجهٔ سرور از کجا می‌آید؟", detail: "کسی جواب نداد", owner_name: null, due_on: null, start_ms: 30000, end_ms: 33000 },
        { kind: "risk", text: "اگر دیتای لیبل‌خورده نرسه، فاز دوم عقب می‌افته", detail: "سینا هشدار داد", owner_name: null, due_on: null, start_ms: 40000, end_ms: 45000 },
      ],
    }) + "\n```";
    const out = parseExtraction(answer)!;
    expect(out.map((c) => c.kind)).toEqual([...MEETING_ITEM_KINDS]);
    /* the two owned kinds keep their person and day; the three others never
       carry one — a decision's owner would be its proposer, which is not an
       assignee */
    expect(out.map((c) => c.owner_name)).toEqual([null, "کارول", "بهناز", null, null]);
    expect(out.map((c) => c.due_on)).toEqual([null, "2026-09-26", null, null, null]);
  });

  it("maps the words a model plausibly uses — and DROPS a kind it did not name", () => {
    /*
     * THE DISCRIMINATING CASE is `suggestion`: the old parser filed anything
     * but 'commitment' as a decision, so a model's "suggestion" became a
     * decided thing in the ledger. It is gone now, and its neighbours survive
     * — a parser that dropped everything would pass the absence alone.
     */
    const out = parseExtraction(JSON.stringify({ items: [
      { kind: "commitment", text: "الف" },
      { kind: "task", text: "ب" },
      { kind: "concern", text: "پ" },
      { kind: "تصمیم", text: "ت" },
      { kind: "Open question", text: "ث" },
      { kind: "initiative", text: "ج" },
      { kind: "suggestion", text: "چ" },
      { kind: 7, text: "ح" },
    ] }))!;
    expect(out.map((c) => [c.text, c.kind])).toEqual([
      ["الف", "action"], ["ب", "action"], ["پ", "risk"], ["ت", "decision"],
      ["ث", "question"], ["ج", "project"],
    ]);
  });

  it("strips an owner and a day from a kind that has neither", () => {
    /* a question whose owner_name the model filled with the asker must not
       become a row that says the asker OWES something */
    const out = parseExtraction(JSON.stringify({ items: [
      { kind: "question", text: "کی؟", owner_name: "سینا", due_on: "2026-10-01" },
      { kind: "risk", text: "دیر", owner_name: "سینا", due_on: "2026-10-01" },
      { kind: "decision", text: "شد", owner_name: "سینا", due_on: "2026-10-01" },
      /* the control: the same fields on a task survive */
      { kind: "action", text: "بفرست", owner_name: "سینا", due_on: "2026-10-01" },
    ] }))!;
    expect(out.map((c) => [c.owner_name, c.due_on])).toEqual([
      [null, null], [null, null], [null, null], ["سینا", "2026-10-01"],
    ]);
  });

  it("normaliseKind is closed — spelling variants in, invented words out", () => {
    expect(normaliseKind(" Action-Item ")).toBe("action");
    expect(normaliseKind("follow up")).toBe("action");
    expect(normaliseKind("سؤال")).toBe("question");
    expect(normaliseKind("سوال")).toBe("question");
    expect(normaliseKind("PROJECT")).toBe("project");
    expect(normaliseKind("wish")).toBeNull();
    expect(normaliseKind(null)).toBeNull();
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

  it("asks for all five kinds, by the schema's own words, and puts them in the schema line", () => {
    /*
     * The user's report ("it is weak in understanding them") was a prompt
     * that asked for two kinds. A prompt nobody asserts is a prompt somebody
     * trims, so every kind is asserted TWICE: as a numbered definition and
     * inside the JSON line the model copies its `kind` values from — the
     * second is the one that decides what comes back.
     */
    const input = composeExtractionInput("x", "2026-09-19");
    for (const kind of MEETING_ITEM_KINDS) expect(input).toMatch(new RegExp(`\\) ${kind} — `));
    expect(input).toContain(`"kind":"${MEETING_ITEM_KINDS.join("|")}"`);
    /* and the implicit cases, which are what "weak in understanding" meant */
    expect(input).toContain("من فردا می‌فرستم");
    expect(input).toContain("کلِ گفتگو را بخوان");
  });

  it("tells the model not to guess a name, and to name nobody for a decision", () => {
    /* the rule that keeps a task from being filed against a colleague who
       never took it */
    const input = composeExtractionInput("x", "2026-09-08");
    expect(input).toContain("اسم حدس نزن");
    expect(input).toContain("owner_name فقط برای action و project");
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
       cost of guessing is a task filed against a colleague who never took
       it, so the answer is nobody. */
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
