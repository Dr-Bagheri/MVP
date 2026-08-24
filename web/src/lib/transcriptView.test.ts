import { describe, expect, it } from "vitest";
import { isGenericTitle, lineDiff, mergeParagraphs, suggestTitleFrom, talkTimes } from "./transcriptView";

const row = (id: string, sp: string | null, s: number, e: number, text = "متن") =>
  ({ id, speaker_id: sp, start_ms: s, end_ms: e, text });

describe("mergeParagraphs", () => {
  it("merges consecutive same-speaker lines and splits on a change", () => {
    const blocks = mergeParagraphs([
      row("a", "s1", 0, 5), row("b", "s1", 5, 9), row("c", "s2", 9, 12), row("d", "s1", 12, 15),
    ]);
    expect(blocks.map((b) => [b.speaker_id, b.texts.length])).toEqual([
      ["s1", 2], ["s2", 1], ["s1", 1],
    ]);
    expect(blocks[0]!.end_ms).toBe(9);
  });
});

describe("talkTimes", () => {
  it("shares sum to 1 and sort by time spoken", () => {
    const shares = talkTimes([row("a", "s1", 0, 30), row("b", "s2", 30, 40)]);
    expect(shares[0]!.speaker_id).toBe("s1");
    expect(shares[0]!.share).toBeCloseTo(0.75);
    expect(shares.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1);
  });
});

describe("lineDiff", () => {
  it("names what changed, keeps what didn't", () => {
    const diff = lineDiff("یک\nدو\nسه", "یک\nدوی ویرایش‌شده\nسه");
    expect(diff).toEqual([
      { kind: "same", text: "یک" },
      { kind: "removed", text: "دو" },
      { kind: "added", text: "دوی ویرایش‌شده" },
      { kind: "same", text: "سه" },
    ]);
  });
  it("identical inputs diff to all-same — the negative control", () => {
    expect(lineDiff("الف\nب", "الف\nب").every((l) => l.kind === "same")).toBe(true);
  });
});

describe("title suggestion", () => {
  it("recognizes recorder-invented titles and NEVER a human one", () => {
    for (const g of ["Meeting 3", "جلسه 4", "یادداشت صوتی ۲۰:۰۱", "call 2"]) {
      expect(isGenericTitle(g), g).toBe(true);
    }
    for (const h of ["مذاکره قرارداد", "Kickoff with Sina", "جلسه بودجه ۱۴۰۵"]) {
      expect(isGenericTitle(h), h).toBe(false);
    }
  });

  it("suggests from a real heading, skips the genre word «خلاصه»", () => {
    expect(suggestTitleFrom("**خلاصه:**\n\n### تصمیم دربارهٔ قرارداد\nمتن…"))
      .toBe("تصمیم دربارهٔ قرارداد");
    // no heading: first sentence, bounded
    expect(suggestTitleFrom("دو نفر دربارهٔ آزمایش ضبط صحبت کردند. سپس…"))
      .toBe("دو نفر دربارهٔ آزمایش ضبط صحبت کردند");
    expect(suggestTitleFrom("")).toBeNull();
  });
});
