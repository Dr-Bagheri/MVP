/**
 * The parser's risk is both directions: raw asterisks surviving to the
 * screen, and prose being EATEN by an over-eager heading rule. The
 * negative controls are prose lines that merely resemble structure.
 */
import { describe, expect, it } from "vitest";
import { parseSummary } from "./SummaryBody";

describe("parseSummary", () => {
  it("the «**خلاصه:**» line — the exact artifact on the live page — is a heading", () => {
    const blocks = parseSummary("**خلاصه:**\nدر این تماس دو نفر صحبت کردند.");
    expect(blocks[0]).toEqual({ kind: "heading", text: "خلاصه" });
    expect(blocks[1]?.kind).toBe("para");
  });

  it("markdown headings and colon-titles both read as chapters", () => {
    const blocks = parseSummary("## تصمیم‌ها\nاقدامات بعدی:\n- پیگیری قرارداد");
    expect(blocks[0]).toEqual({ kind: "heading", text: "تصمیم‌ها" });
    expect(blocks[1]).toEqual({ kind: "heading", text: "اقدامات بعدی" });
    expect(blocks[2]).toEqual({ kind: "bullets", items: ["پیگیری قرارداد"] });
  });

  it("consecutive bullets and numbered lines group into ONE list each", () => {
    const blocks = parseSummary("- یک\n- دو\n1. اول\n2. دوم");
    expect(blocks).toEqual([
      { kind: "bullets", items: ["یک", "دو"] },
      { kind: "numbered", items: ["اول", "دوم"] },
    ]);
  });

  it("NEGATIVE: a long sentence with a colon stays prose; nothing is eaten", () => {
    const long = "نکتهٔ مهم این است: قرارداد باید تا پایان ماه امضا شود و تیم حقوقی آن را بررسی کند.";
    const blocks = parseSummary(long);
    expect(blocks).toEqual([{ kind: "para", text: long }]);
  });

  it("NEGATIVE: inline bold stays inside a paragraph, not a heading", () => {
    const blocks = parseSummary("این **بخش مهم** جلسه بود.");
    expect(blocks[0]?.kind).toBe("para");
  });
});
