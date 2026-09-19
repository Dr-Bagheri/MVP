import { describe, expect, it } from "vitest";
import { sliceSummary, splitOwner } from "../src/api/meetings.ts";

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

/**
 * An ENGLISH summary, shaped like what a model writes when the transcript
 * is English or the org's skill override asks for English — the headings
 * are the ones seen in real regenerate output, not the ones the parser would
 * prefer. Before 2026-09-08 this sliced into nothing at all.
 */
const SUMMARY_EN = `## Summary
The product team discussed the sign-up drop.

## Decisions
- Remove the second step of the form
- Add a second SMS provider

## Action items
1. Migrate 1,200 locked accounts — owner: Sina
2. Run the A/B test for two weeks

## Risks
- Single provider with no fallback

## Open questions
- What is the status of the mobile build?

## Projects
- Second SMS provider rollout

## People & entities
- Acme Telecom
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

  it("slices an ENGLISH summary into the same kinds, owner and all", () => {
    const rows = sliceSummary(SUMMARY_EN);
    const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.body);

    expect(of("decision")).toEqual([
      "Remove the second step of the form",
      "Add a second SMS provider",
    ]);
    expect(of("action")).toEqual([
      "Migrate 1,200 locked accounts",
      "Run the A/B test for two weeks",
    ]);
    expect(of("risk")).toEqual(["Single provider with no fallback"]);
    expect(of("question")).toEqual(["What is the status of the mobile build?"]);
    /* 2026-09-19: projects joined the set and entities left it (db/0234). A
       «People & entities» heading is no kind now, so its line is filed
       NOWHERE — asserted as an absence, because a slicer that kept an
       `entity` bucket would render perfectly and write a row the check
       refuses */
    expect(of("project")).toEqual(["Second SMS provider rollout"]);
    expect(rows.map((r) => r.body)).not.toContain("Acme Telecom");
    /* the marker became the OWNER and left the body; the unmarked line
       carries none — the parser names nobody it was not told */
    expect(rows.filter((r) => r.kind === "action").map((r) => r.owner)).toEqual(["Sina", null]);
    /* the opening paragraph belongs to «Summary», which is no kind */
    expect(rows.map((r) => r.body)).not.toContain("The product team discussed the sign-up drop.");
  });

  it("reads the Persian owner marker off an action line and only off an action line", () => {
    const rows = sliceSummary([
      "## تصمیم‌ها",
      "- قرارداد امضا شود — مسئول: سینا",
      "## اقدامات بعدی",
      "- مهاجرت حساب‌ها — مسئول: سینا احمدی",
      "- تست A/B تا دو هفته",
    ].join("\n"));
    expect(rows).toEqual([
      /* a decision keeps its text whole: whoever is named on it is not an
         assignee, and stripping the name would change what was decided */
      { kind: "decision", body: "قرارداد امضا شود — مسئول: سینا", owner: null },
      { kind: "action", body: "مهاجرت حساب‌ها", owner: "سینا احمدی" },
      { kind: "action", body: "تست A/B تا دو هفته", owner: null },
    ]);
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
    expect(sliceSummary("**تصمیم‌ها**\n- الف")).toEqual([{ kind: "decision", body: "الف", owner: null }]);
    expect(sliceSummary("تصمیم‌ها:\n- ب")).toEqual([{ kind: "decision", body: "ب", owner: null }]);
  });

  it("returns nothing for a summary with no sections, rather than guessing", () => {
    expect(sliceSummary("یک پاراگراف ساده بدون هیچ عنوانی.")).toEqual([]);
  });

  it("survives CRLF, because a summary can arrive with either line ending", () => {
    /* this line broke once already — a `\r?\n` that lost its backslashes and
       became a literal newline still SPLIT, just not on carriage returns, so
       every item on a CRLF summary would have carried an invisible \r */
    const rows = sliceSummary("## تصمیم‌ها\r\n- الف\r\n");
    expect(rows).toEqual([{ kind: "decision", body: "الف", owner: null }]);
  });
});

describe("splitOwner", () => {
  it("reads the fixed marker in either language, bracketed or not, dash or not", () => {
    expect(splitOwner("Migrate accounts — owner: Sina")).toEqual({ body: "Migrate accounts", owner: "Sina" });
    expect(splitOwner("Migrate accounts (owner: Sina Ahmadi)")).toEqual({ body: "Migrate accounts", owner: "Sina Ahmadi" });
    expect(splitOwner("مهاجرت حساب‌ها — مسئول: سینا")).toEqual({ body: "مهاجرت حساب‌ها", owner: "سینا" });
    expect(splitOwner("مهاجرت حساب‌ها (مسئول: سینا)")).toEqual({ body: "مهاجرت حساب‌ها", owner: "سینا" });
    expect(splitOwner("مهاجرت حساب‌ها، مسئول: سینا.")).toEqual({ body: "مهاجرت حساب‌ها،", owner: "سینا" });
  });

  it("accepts the two natural shapes only when the name LOOKS like a name", () => {
    expect(splitOwner("Migrate accounts (Sina)")).toEqual({ body: "Migrate accounts", owner: "Sina" });
    expect(splitOwner("Sina: migrate the accounts")).toEqual({ body: "migrate the accounts", owner: "Sina" });
    expect(splitOwner("سینا: مهاجرت حساب‌ها")).toEqual({ body: "مهاجرت حساب‌ها", owner: "سینا" });
    /* the negative controls — each is a line a real summary writes, and each
       would have become a wrong assignee under a looser rule */
    expect(splitOwner("تست A/B: تا دو هفته").owner).toBeNull();
    expect(splitOwner("Note: check the budget").owner).toBeNull();
    expect(splitOwner("توجه: بودجه بررسی شود").owner).toBeNull();
    expect(splitOwner("Ship the build (by Friday 12)").owner).toBeNull();
    expect(splitOwner("Ship the build (see appendix / notes)").owner).toBeNull();
    expect(splitOwner("Deadline: 2026-10-01").owner).toBeNull();
  });

  it("names nobody on a plain line", () => {
    expect(splitOwner("مهاجرت حساب‌ها")).toEqual({ body: "مهاجرت حساب‌ها", owner: null });
  });
});

/**
 * A PLACEHOLDER IS NOT AN OWNER (2026-09-09).
 *
 * The fixture is the summary a live take actually produced — call
 * 224a1511…, org 89d4301e…, where two voices were on the roster and neither
 * was linked to anybody. The model was handed `S1·1` as a speaker's name (the
 * summarize step's own bug, fixed beside this) and wrote it back into the
 * owner line, which this parser filed as `meeting_item.owner`. Six such rows
 * were in the database before db/0220 cleared them.
 *
 * Both spellings are covered, because both are reachable: `S1·1` from a
 * pipeline that has not been redeployed yet, and «Speaker 1» / «گویندهٔ ۱»
 * from one that has — the transcript now says Speaker 1, so a model that
 * cannot tell who is doing something will echo exactly that.
 */
describe("splitOwner: the recording's own name for a voice is not a person", () => {
  it("drops the diarizer's label AND still strips the marker from the sentence", () => {
    /* the body matters as much as the owner: leaving «— Owner: S1·1» in the
       sentence moves the leak one field over rather than closing it */
    expect(splitOwner("Refresh the demo data — Owner: S1·1"))
      .toEqual({ body: "Refresh the demo data", owner: null });
    expect(splitOwner("تازه‌سازی داده‌ها — مسئول: S2·1"))
      .toEqual({ body: "تازه‌سازی داده‌ها", owner: null });
  });

  it("drops the ORDINAL HANDLE the transcript now hands the model, in both languages", () => {
    expect(splitOwner("Send the proposal — owner: Speaker 1").owner).toBeNull();
    expect(splitOwner("Send the proposal — owner: speaker 12").owner).toBeNull();
    expect(splitOwner("ارسال پیشنهاد — مسئول: گویندهٔ ۱").owner).toBeNull();
    expect(splitOwner("ارسال پیشنهاد — مسئول: گوینده ۲").owner).toBeNull();
  });

  it("NEGATIVE CONTROL: a real name in the same shape still becomes the owner", () => {
    /* without this the rule is indistinguishable from "no action item ever
       has an owner", which passes every assertion above and is a worse
       product than the bug */
    expect(splitOwner("Refresh the demo data — Owner: Sarah Mitchell"))
      .toEqual({ body: "Refresh the demo data", owner: "Sarah Mitchell" });
    expect(splitOwner("تازه‌سازی داده‌ها — مسئول: سینا سپاسی"))
      .toEqual({ body: "تازه‌سازی داده‌ها", owner: "سینا سپاسی" });
    /* and a name that merely CONTAINS the word is a person: «Speaker» alone
       is a surname nobody here has, but «Ali Speaker» is a name shape and the
       rule is about the placeholder, not about the word */
    expect(splitOwner("Ship it — owner: Ali Speaker").owner).toBe("Ali Speaker");
  });

  it("the whole summary slices with the owner dropped and the decision untouched", () => {
    const rows = sliceSummary(`## Next steps with owners
*   Refresh the Harbor Bank demo data before Tuesday's demo — Owner: S1·1
*   Send the pricing proposal to Harbor Bank by Tuesday — Owner: Sarah Mitchell

## Decisions
*   The demo data will be refreshed before Tuesday's demo
`);
    expect(rows).toEqual([
      { kind: "action", body: "Refresh the Harbor Bank demo data before Tuesday's demo", owner: null },
      { kind: "action", body: "Send the pricing proposal to Harbor Bank by Tuesday", owner: "Sarah Mitchell" },
      { kind: "decision", body: "The demo data will be refreshed before Tuesday's demo", owner: null },
    ]);
  });

  /* Headings a REAL summary of a REAL recording actually wrote, in both
     languages — each one produced zero rows before the pattern list learned it,
     which on screen reads as "this meeting had no action items" rather than as
     "that heading is not recognised". The control is the last case: a heading
     that genuinely names no kind must still slice to nothing, or the list has
     simply been widened until it matches everything. */
  it("recognises the headings the shipped summaries write, in both languages", () => {
    const fa = sliceSummary(`**گام‌های بعدی**
*   داده‌های دموی را تازه کن — مسئول: سارا

**مشکلات و موانع**
*   محیط استیجینگ هنوز ریسک دارد
`);
    expect(fa).toEqual([
      { kind: "action", body: "داده‌های دموی را تازه کن", owner: "سارا" },
      { kind: "risk", body: "محیط استیجینگ هنوز ریسک دارد", owner: null },
    ]);

    const en = sliceSummary(`**Next Steps**
*   Refresh the demo data — owner: Sarah Mitchell

**Obstacles and Problems**
*   The staging environment is the remaining risk
`);
    expect(en).toEqual([
      { kind: "action", body: "Refresh the demo data", owner: "Sarah Mitchell" },
      { kind: "risk", body: "The staging environment is the remaining risk", owner: null },
    ]);

    // the control
    expect(sliceSummary(`**Work Status**
*   Megan finished the environment
`)).toEqual([]);
  });
});
