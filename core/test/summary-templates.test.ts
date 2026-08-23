/**
 * The regenerate extras (2026-08-23): templates shape the prompt, the
 * instruction rides bounded, and an UNKNOWN template must vanish rather
 * than leak a raw string into the prompt — the composer is the last line
 * where a bad key could become model input.
 */
import { describe, expect, it } from "vitest";
import {
  composeSummaryInput,
  SUMMARY_TEMPLATE_ADDENDA,
} from "../src/worker/summarizer.ts";
import { SUMMARY_TEMPLATES } from "../src/api/vocabulary.ts";

describe("composeSummaryInput", () => {
  it("every ruled template key has an addendum, and each restates the anti-fabrication floor", () => {
    for (const key of SUMMARY_TEMPLATES) {
      const addendum = SUMMARY_TEMPLATE_ADDENDA[key];
      expect(addendum, key).toBeTruthy();
      // a template that demands sections invites inventing them — each one
      // must carry its own "leave out what wasn't said" line
      expect(addendum, key).toMatch(/حذف کن|فقط آنچه گفته شد/);
    }
    // and the map holds EXACTLY the ruled keys — no sales, no standup
    expect(Object.keys(SUMMARY_TEMPLATE_ADDENDA).sort()).toEqual([...SUMMARY_TEMPLATES].sort());
  });

  it("weaves template and instruction in, before the quoted transcript", () => {
    const input = composeSummaryInput({
      hasSkill: true,
      transcript: "متن",
      template: "board",
      instruction: "کوتاه‌تر بنویس",
    });
    expect(input).toContain("هیئت‌مدیره");
    expect(input).toContain("کوتاه‌تر بنویس");
    expect(input.indexOf("هیئت‌مدیره")).toBeLessThan(input.indexOf("<<<TRANSCRIPT"));
    expect(input.indexOf("کوتاه‌تر بنویس")).toBeLessThan(input.indexOf("<<<TRANSCRIPT"));
  });

  it("an unknown template key adds NOTHING — never its own raw text", () => {
    const bare = composeSummaryInput({ hasSkill: true, transcript: "متن" });
    const withBad = composeSummaryInput({
      hasSkill: true,
      transcript: "متن",
      template: "sales_call_do_not_exist",
    });
    expect(withBad).toBe(bare);
    expect(withBad).not.toContain("sales_call_do_not_exist");
  });

  it("a blank instruction is absence, not an empty framing line", () => {
    const input = composeSummaryInput({ hasSkill: true, transcript: "متن", instruction: "   " });
    expect(input).not.toContain("خواستهٔ درخواست‌کننده");
  });
});
