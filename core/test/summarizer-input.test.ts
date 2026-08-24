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
  parseGroundingVerdict,
  SUMMARY_TEMPLATE_ADDENDA,
} from "../src/worker/summarizer.ts";

const base = { hasSkill: true, transcript: "الف: سلام" };

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
    expect(input.endsWith("خلاصه را بنویس.")).toBe(true);
  });
});
