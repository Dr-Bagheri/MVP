/**
 * The summarize prompt as a pure function: template addenda, the figures
 * ledger, the requester's instruction, and the roster preamble compose
 * predictably — and the ABSENT cases stay absent (an empty roster or an
 * unknown template must add nothing, not an empty header the model reads
 * as an instruction to invent).
 */
import { describe, expect, it } from "vitest";
import {
  composeGroundingInput,
  composeSummaryInput,
  formatPriorMeetingsBlock,
  FALLBACK_PROMPT,
  GROUNDING_PRIOR_RULE,
  LANGUAGE_ADDENDUM,
  parseGroundingVerdict,
  PRIOR_MEETINGS_ADDENDUM,
  PRIOR_MEETINGS_CLOSE,
  PRIOR_MEETINGS_OPEN,
  SCAFFOLD_EN,
  scaffoldLanguage,
  SUMMARY_TEMPLATE_ADDENDA,
  SUMMARY_TEMPLATE_ADDENDA_EN,
} from "../src/worker/summarizer.ts";

const base = { hasSkill: true, transcript: "الف: سلام" };

/**
 * PRIOR MEETINGS (2026-09-08): "let's continue the Simorgh checklist we
 * discussed last time" must come out as WHAT Simorgh is, cited by the
 * earlier meeting's title and date — and the verifier must not flag it.
 * Pinned as prose because the prompt is the mechanism; the block is pinned
 * as a shape because the step and both prompts must agree on the fence.
 */
describe("prior meetings in the prompt", () => {
  const prior = [{
    title: "بازبینی سیمرغ",
    started_at: "2026-08-20T10:15:00.000Z",
    terms: ["سیمرغ", "چک‌لیست"],
    snippets: ["… <mark>سیمرغ</mark> را\nبررسی کردیم …"],
    summary: "س".repeat(700),
  }];

  it("the addendum rides EVERY run — bilingual, cite-by-title-and-date, never invent", () => {
    const input = composeSummaryInput(base);
    expect(input).toContain(PRIOR_MEETINGS_ADDENDUM);
    // the load-bearing sentences, so a rewrite cannot quietly drop one
    expect(PRIOR_MEETINGS_ADDENDUM).toContain("PRIOR_MEETINGS");
    expect(PRIOR_MEETINGS_ADDENDUM).toContain("در حکم منبع‌اند");
    expect(PRIOR_MEETINGS_ADDENDUM).toContain("با عنوان و تاریخش");
    expect(PRIOR_MEETINGS_ADDENDUM).toContain("هیچ جلسه یا توافقی نساز");
    expect(PRIOR_MEETINGS_ADDENDUM).toContain("counts as source");
    expect(PRIOR_MEETINGS_ADDENDUM).toContain("Cite the earlier meeting by title and date");
    expect(PRIOR_MEETINGS_ADDENDUM).toContain("Never invent a reference");
  });

  it("the block is fenced data: title, ISO date, terms, a bounded summary, mark-free one-line snippets", () => {
    const block = formatPriorMeetingsBlock(prior)!;
    const lines = block.split("\n");
    expect(lines[0]).toBe(PRIOR_MEETINGS_OPEN);
    expect(lines.at(-1)).toBe(PRIOR_MEETINGS_CLOSE);
    expect(block).toContain("- عنوان: «بازبینی سیمرغ» | تاریخ: 2026-08-20 | واژه‌ها: سیمرغ، چک‌لیست");
    // the summary is cut at 600 — a whole earlier summary is the context budget spent twice
    const summaryLine = lines.find((l) => l.startsWith("  خلاصه: "))!;
    expect(summaryLine.length).toBe("  خلاصه: ".length + 600);
    // snippets lose their <mark>s and their newlines (a newline would be a new bullet)
    expect(block).toContain("  گزیده: … سیمرغ را بررسی کردیم …");
    expect(block).not.toContain("<mark>");
    // and NOTHING to quote is NO fence — an empty fence reads as "they said nothing"
    expect(formatPriorMeetingsBlock([])).toBeUndefined();
  });

  it("the block enters the summary prompt fenced, before the transcript — and is absent when absent", () => {
    const block = formatPriorMeetingsBlock(prior)!;
    const input = composeSummaryInput({ ...base, priorMeetings: block });
    expect(input).toContain(block);
    expect(input.indexOf(PRIOR_MEETINGS_OPEN)).toBeGreaterThan(input.indexOf(PRIOR_MEETINGS_ADDENDUM));
    expect(input.indexOf(PRIOR_MEETINGS_OPEN)).toBeLessThan(input.indexOf("<<<TRANSCRIPT"));
    expect(composeSummaryInput(base)).not.toContain(PRIOR_MEETINGS_OPEN);
  });

  it("the verifier sees the SAME block and its rule says the block counts as source", () => {
    const block = formatPriorMeetingsBlock(prior)!;
    const withPrior = composeGroundingInput("خلاصه", "متن", block);
    expect(withPrior).toContain(block);
    expect(withPrior).toContain(GROUNDING_PRIOR_RULE);
    expect(GROUNDING_PRIOR_RULE).toContain("در حکم منبع است");
    // the rule and the fence travel together: no block, no rule
    const without = composeGroundingInput("خلاصه", "متن");
    expect(without).not.toContain(PRIOR_MEETINGS_OPEN);
    expect(without).not.toContain(GROUNDING_PRIOR_RULE);
  });
});

/**
 * An English meeting in an English organisation came back with a Persian
 * summary — because every instruction the model receives is written in Persian,
 * headings included, and it answered the language it was addressed in.
 *
 * The rule therefore rides EVERY run and sits BEFORE the template, which is the
 * part worth pinning: a template names its sections in Persian, and a model that
 * has not yet been told those names are a structure will copy them and take the
 * whole document with them.
 */
/**
 * The rule alone did not work, and this is the record of that.
 *
 * An English meeting in an English organisation came back in Persian THREE
 * times: with the rule riding every run, then with it restated after the
 * transcript, then with a bilingual closing instruction. Every line around it
 * was Persian prose, and a model answers the language it is addressed in. So
 * the scaffold follows the transcript.
 */
describe("the model is addressed in the transcript's language", () => {
  const english = "Sarah: Morning. Did Alex get the acceptance checklist written?";
  const persian = "سارا: صبح بخیر. الکس چک‌لیست پذیرش را نوشت؟";

  it("an English transcript gets an English scaffold", () => {
    const input = composeSummaryInput({ hasSkill: false, transcript: english, template: "team", figures: true, speakers: [{ name: "Sarah", title: "lead" }] });
    expect(input).toContain(SCAFFOLD_EN.fallbackPrompt);
    expect(input).toContain(SCAFFOLD_EN.transcriptLabel);
    expect(input).toContain(SCAFFOLD_EN.write);
    expect(input).toContain(SUMMARY_TEMPLATE_ADDENDA_EN.team!);
    expect(input).toContain("The speakers in this conversation: Sarah");
    // …and the Persian scaffold is ABSENT, which is the half that matters:
    // adding English beside Persian would leave the model addressed in both.
    expect(input).not.toContain(SUMMARY_TEMPLATE_ADDENDA.team!);
    expect(input).not.toContain("متن گفتگو، نقل‌شده");
    expect(input).not.toContain("خلاصه را بنویس.");
  });

  it("a Persian transcript keeps the Persian scaffold, unchanged", () => {
    const input = composeSummaryInput({ hasSkill: false, transcript: persian, template: "team", figures: true, speakers: [{ name: "سارا", title: "lead" }] });
    expect(input).toContain(FALLBACK_PROMPT);
    expect(input).toContain(SUMMARY_TEMPLATE_ADDENDA.team!);
    expect(input).toContain("گویندگان این گفتگو: سارا (سرگروه)");
    expect(input).toContain("خلاصه را بنویس.");
    expect(input).not.toContain(SUMMARY_TEMPLATE_ADDENDA_EN.team!);
  });

  /* Persian-first: an English word inside a Persian meeting is ordinary — this
     product's own transcripts are full of "Harbor Bank" and "Lakeside" — so any
     real amount of Persian script means Persian, and the ambiguous case falls
     that way rather than the other. */
  it("a Persian meeting full of English product names is still Persian", () => {
    const mixed = "سارا: محیط دموی Harbor Bank را مگان روی داده‌های Lakeside ساخته، قبل از review باید refresh شود.";
    expect(scaffoldLanguage(mixed)).toBe("fa");
  });

  it("an empty or letterless transcript falls to Persian, not to English", () => {
    expect(scaffoldLanguage("")).toBe("fa");
    expect(scaffoldLanguage("00:01 — 00:02 …")).toBe("fa");
  });

  /* The structural mirror, for the same reason content-packs.test.ts asserts it
     of the demo packs: a template that exists in one language and not the other
     is a summary shape some organisations can never get. */
  it("the two template records name the same templates", () => {
    expect(Object.keys(SUMMARY_TEMPLATE_ADDENDA_EN).sort())
      .toEqual(Object.keys(SUMMARY_TEMPLATE_ADDENDA).sort());
    for (const key of Object.keys(SUMMARY_TEMPLATE_ADDENDA)) {
      // …and the control: they must not be the SAME STRING, or one of them is
      // the other wearing a different name.
      expect(SUMMARY_TEMPLATE_ADDENDA_EN[key]).not.toBe(SUMMARY_TEMPLATE_ADDENDA[key]);
      expect(SUMMARY_TEMPLATE_ADDENDA_EN[key]!.length).toBeGreaterThan(40);
    }
  });
});

describe("the summary speaks the meeting's language", () => {
  it("the rule rides every run, template or none, and says it in both languages", () => {
    for (const input of [composeSummaryInput(base), composeSummaryInput({ ...base, template: "team" })]) {
      expect(input).toContain(LANGUAGE_ADDENDUM);
    }
    expect(LANGUAGE_ADDENDUM).toContain("زبان خلاصه همان زبانِ گفتگوست");
    expect(LANGUAGE_ADDENDUM).toContain("ساختار است، نه واژگان");
    expect(LANGUAGE_ADDENDUM).toContain("in the language of the transcript");
    expect(LANGUAGE_ADDENDUM).toContain("a structure to follow, not words to copy");
  });

  it("it is read BEFORE the template that names its sections in Persian", () => {
    const input = composeSummaryInput({ ...base, template: "team" });
    expect(input.indexOf(LANGUAGE_ADDENDUM)).toBeLessThan(input.indexOf(SUMMARY_TEMPLATE_ADDENDA.team!));
  });

  /* The control: without it the composed prompt would have no language rule at
     all, which is the state that produced the Persian summary. If a rewrite
     empties the addendum, every assertion above still passes on "" — this is
     what catches that. */
  it("the addendum is not empty", () => {
    expect(LANGUAGE_ADDENDUM.trim().length).toBeGreaterThan(80);
  });
});

describe("composeSummaryInput", () => {
  it("a known template adds its addendum; an unknown one adds NOTHING", () => {
    const board = composeSummaryInput({ ...base, template: "board" });
    expect(board).toContain(SUMMARY_TEMPLATE_ADDENDA.board!);
    const unknown = composeSummaryInput({ ...base, template: "sales" });
    expect(unknown).toBe(composeSummaryInput(base));
  });

  it("the instruction rides its framing line, trimmed", () => {
    const input = composeSummaryInput({ ...base, instruction: "  کوتاه‌تر بنویس  " });
    expect(input).toContain("خواستهٔ درخواست‌کننده");
    expect(input).toContain("کوتاه‌تر بنویس");
    // blank instruction = no line at all
    expect(composeSummaryInput({ ...base, instruction: "   " })).toBe(composeSummaryInput(base));
  });

  it("the roster names speakers WITH their Persian titles — and only what it holds", () => {
    const input = composeSummaryInput({
      ...base,
      speakers: [
        { name: "سینا", title: "lead" },
        { name: "S2·1", title: null },
      ],
    });
    expect(input).toContain("سینا (سرگروه)");
    expect(input).toContain("S2·1");
    expect(input).not.toContain("(null)");
    // empty roster = no preamble
    expect(composeSummaryInput({ ...base, speakers: [] })).toBe(composeSummaryInput(base));
  });

  it("grounding: summary and transcript both enter as quoted data", () => {
    const input = composeGroundingInput("خلاصه", "متن");
    expect(input).toContain("<<<SUMMARY");
    expect(input).toContain("<<<TRANSCRIPT");
    expect(input).toContain('{"clean":true}');
  });

  it("grounding verdicts parse defensively — an unreadable verdict is NO verdict", () => {
    expect(parseGroundingVerdict('{"clean":true}')).toEqual({ clean: true, flags: [] });
    expect(parseGroundingVerdict('```json\n{"clean":false,"flags":[{"claim":"سه میلیارد","note":"عدد در متن نیست"}]}\n```'))
      .toEqual({ clean: false, flags: [{ claim: "سه میلیارد", note: "عدد در متن نیست" }] });
    // prose, malformed JSON, missing clean, and — the trap — "not clean"
    // with nothing flagged: all NULL, never a fabricated verdict
    expect(parseGroundingVerdict("همه چیز درست است.")).toBeNull();
    expect(parseGroundingVerdict('{"clean":"yes"}')).toBeNull();
    expect(parseGroundingVerdict('{"flags":[]}')).toBeNull();
    expect(parseGroundingVerdict('{"clean":false,"flags":[]}')).toBeNull();
  });

  it("the transcript stays quoted data at the end, whatever composes above it", () => {
    const input = composeSummaryInput({
      ...base, template: "interview", figures: true,
      instruction: "روی بودجه تمرکز کن", speakers: [{ name: "امید", title: "coo" }],
    });
    expect(input.indexOf("<<<TRANSCRIPT")).toBeGreaterThan(input.indexOf("امید"));
    /* The instruction to write is still the LAST line — the assertion's real
       subject — but it is no longer the only thing after the transcript, so
       `endsWith` on the Persian sentence alone would now be asserting the
       absence of the language rule that has to sit there. */
    expect(input.trimEnd().endsWith("(Now write the summary, in the transcript's own language.)")).toBe(true);
    expect(input.indexOf("خلاصه را بنویس.")).toBeGreaterThan(input.indexOf("TRANSCRIPT"));
  });

  /* The rule is stated TWICE on purpose, and the second time is the one that
     changed the outcome: an English meeting in an English organisation came
     back in Persian with the rule riding only at the top, because everything
     between it and the closing instruction is Persian prose and the last thing
     read is the thing answered. So this asserts a POSITION, not a count. */
  it("the language rule is the last thing before the instruction to write", () => {
    const input = composeSummaryInput({ ...base, template: "team" });
    const last = input.lastIndexOf(LANGUAGE_ADDENDUM);
    expect(last).toBeGreaterThan(input.indexOf("TRANSCRIPT"));
    expect(input.indexOf("خلاصه را بنویس.")).toBeGreaterThan(last);
    // …and it is still read before the template names its sections in Persian.
    expect(input.indexOf(LANGUAGE_ADDENDUM)).toBeLessThan(input.indexOf(SUMMARY_TEMPLATE_ADDENDA.team!));
  });
});
