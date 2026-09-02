import { describe, expect, it } from "vitest";
import { sliceSummary } from "../src/api/meetings.ts";

/**
 * The summary → items parser, which exists on the SERVER because it used to
 * exist twice in the browser — once in the review panel and once in the
 * minutes document, each with its own regexes. That is how the minutes came
 * to report "no decisions extracted" about decisions the review panel was
 * displaying at the same moment.
 *
 * The fixture is shaped like what the shipped team template actually writes,
 * not like what this parser would find convenient — a parser tested against
 * input its own author invented is the fixture-independence trap, and this
 * feature is where it bites, because a pattern matching no real heading is a
 * category that is permanently empty while reading as wired.
 */

const SUMMARY = `## خلاصهٔ جلسه
تیم محصول دربارهٔ افت ثبت‌نام تصمیم‌گیری کرد.

## تصمیم‌ها
- مرحلهٔ دوم فرم حذف شود
- سرویس‌دهندهٔ پیامک دوم اضافه شود

## اقدامات بعدی
1. مهاجرت ۱۲۰۰ حساب قفل‌شده
2. تست A/B تا دو هفته

## موانع و مشکلات
- اتکا به یک سرویس‌دهنده بدون جایگزین

## سؤالات باز
- وضعیت نسخهٔ موبایل چیست؟
`;

describe("sliceSummary", () => {
  it("finds each section under the headings the templates really write", () => {
    const rows = sliceSummary(SUMMARY);
    const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.body);

    expect(of("decision")).toEqual([
      "مرحلهٔ دوم فرم حذف شود",
      "سرویس‌دهندهٔ پیامک دوم اضافه شود",
    ]);
    expect(of("action")).toEqual([
      "مهاجرت ۱۲۰۰ حساب قفل‌شده",
      "تست A/B تا دو هفته",
    ]);
    expect(of("risk")).toEqual(["اتکا به یک سرویس‌دهنده بدون جایگزین"]);
    expect(of("question")).toEqual(["وضعیت نسخهٔ موبایل چیست؟"]);
  });

  it("keeps prose that belongs to no section OUT", () => {
    /*
     * The negative control, and the reason the whole check is not vacuous: a
     * parser that simply collected every non-heading line would satisfy every
     * assertion above and would also file the summary's opening paragraph as
     * a decision. The «خلاصه» section matches no item kind, so its sentence
     * must appear nowhere.
     */
    const bodies = sliceSummary(SUMMARY).map((r) => r.body);
    expect(bodies).not.toContain("تیم محصول دربارهٔ افت ثبت‌نام تصمیم‌گیری کرد.");
  });

  it("reads a bold heading and a trailing-colon heading, not only markdown hashes", () => {
    /* three heading shapes appear across the shipped templates; a parser that
       only knew `##` would return nothing at all for two of them, which looks
       exactly like "the meeting had no decisions" */
    expect(sliceSummary("**تصمیم‌ها**\n- الف")).toEqual([{ kind: "decision", body: "الف" }]);
    expect(sliceSummary("تصمیم‌ها:\n- ب")).toEqual([{ kind: "decision", body: "ب" }]);
  });

  it("returns nothing for a summary with no sections, rather than guessing", () => {
    expect(sliceSummary("یک پاراگراف ساده بدون هیچ عنوانی.")).toEqual([]);
  });

  it("survives CRLF, because a summary can arrive with either line ending", () => {
    /* this line broke once already — a `\r?\n` that lost its backslashes and
       became a literal newline still SPLIT, just not on carriage returns, so
       every item on a CRLF summary would have carried an invisible \r */
    const rows = sliceSummary("## تصمیم‌ها\r\n- الف\r\n");
    expect(rows).toEqual([{ kind: "decision", body: "الف" }]);
  });
});
