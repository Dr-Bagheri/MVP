import { describe, expect, it } from "vitest";
import { appendLaneItem, summaryLanes } from "./summaryLanes";

/**
 * The lane WRITER (2026-08-28): a manual action item / decision is one new
 * line inserted into the summary document, at the place the lane READER
 * claims it from. Every test here closes the loop through `summaryLanes`
 * itself — the reader is the consumer, so "the reader claims the appended
 * item" is the property, and the exact-string asserts pin that nothing
 * ELSE about the document moved (the version diff must show one line).
 *
 * The main fixture is the models' own house style — `**…:**` bold-colon
 * headings (SummaryBody's parser names it as the dialect they actually
 * produce) — not the tidy `## ` markdown a hand-written fixture would
 * reach for (rule 9: the input must be able to come from where the bug
 * would).
 */
const MODEL_STYLE = [
  "**خلاصه:**",
  "جلسه دربارهٔ بودجهٔ فصل بعد بود.",
  "",
  "**اقدام‌ها:**",
  "- تهیهٔ گزارش هزینه‌ها",
  "- هماهنگی با تیم فروش",
  "",
  "**تصمیم‌ها:**",
  "- بودجهٔ بازاریابی ثابت می‌ماند",
].join("\n");

describe("appendLaneItem", () => {
  it("inserts an action after the lane's last bullet, moving nothing else", () => {
    const out = appendLaneItem(MODEL_STYLE, "actions", "پیگیری قرارداد");
    expect(out).toBe([
      "**خلاصه:**",
      "جلسه دربارهٔ بودجهٔ فصل بعد بود.",
      "",
      "**اقدام‌ها:**",
      "- تهیهٔ گزارش هزینه‌ها",
      "- هماهنگی با تیم فروش",
      "- پیگیری قرارداد",
      "",
      "**تصمیم‌ها:**",
      "- بودجهٔ بازاریابی ثابت می‌ماند",
    ].join("\n"));
    // and the reader claims it back — in ITS lane, the other untouched
    expect(summaryLanes(out).actions).toEqual([
      "تهیهٔ گزارش هزینه‌ها", "هماهنگی با تیم فروش", "پیگیری قرارداد",
    ]);
    expect(summaryLanes(out).decisions).toEqual(["بودجهٔ بازاریابی ثابت می‌ماند"]);
  });

  it("inserts a decision under the decisions heading, not the actions one", () => {
    const out = appendLaneItem(MODEL_STYLE, "decisions", "قرارداد تمدید شود");
    expect(out.endsWith("**تصمیم‌ها:**\n- بودجهٔ بازاریابی ثابت می‌ماند\n- قرارداد تمدید شود")).toBe(true);
    expect(summaryLanes(out).decisions).toEqual([
      "بودجهٔ بازاریابی ثابت می‌ماند", "قرارداد تمدید شود",
    ]);
    expect(summaryLanes(out).actions).toEqual([
      "تهیهٔ گزارش هزینه‌ها", "هماهنگی با تیم فروش",
    ]);
  });

  it("rides the reader's mode rule: a paragraph between heading and bullets does not end the lane", () => {
    /* a real paragraph — a first draft used a short colon-terminated line
       here, and the writer refused to treat it as prose because the READER
       doesn't either (the dialect calls that a heading): the shared
       classifier catching its own test's fixture */
    const body = "## اقدامات\nاین موارد در جلسه مطرح شدند.\n- مورد اول";
    const out = appendLaneItem(body, "actions", "مورد دوم");
    expect(out).toBe("## اقدامات\nاین موارد در جلسه مطرح شدند.\n- مورد اول\n- مورد دوم");
  });

  it("creates the lane heading when the document declares none — and the reader claims it", () => {
    const body = "**خلاصه:**\nمتن جلسه.";
    const out = appendLaneItem(body, "actions", "پیگیری قرارداد");
    expect(out).toBe("**خلاصه:**\nمتن جلسه.\n\n## اقدامات\n- پیگیری قرارداد");
    expect(summaryLanes(out).actions).toEqual(["پیگیری قرارداد"]);
    expect(summaryLanes(out).decisions).toEqual([]);
  });

  it("writes a whole document from nothing — the record whose summarizer never ran", () => {
    const out = appendLaneItem("", "decisions", "بودجه ثابت بماند");
    expect(out).toBe("## تصمیم‌ها\n- بودجه ثابت بماند");
    expect(summaryLanes(out).decisions).toEqual(["بودجه ثابت بماند"]);
  });

  it("collapses a multi-line item — a newline would escape the bullet as unclaimed prose", () => {
    const out = appendLaneItem("## اقدامات\n- الف", "actions", "خط اول\nخط دوم");
    expect(out).toBe("## اقدامات\n- الف\n- خط اول خط دوم");
    expect(summaryLanes(out).actions).toEqual(["الف", "خط اول خط دوم"]);
  });
});
