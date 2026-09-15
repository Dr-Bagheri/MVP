/**
 * THE WORDS THE PRODUCT WRITES INTO SOMEBODY'S DOCK, IN BOTH LANGUAGES.
 *
 * Everything here is text the SERVER composes and then STORES — an
 * `agent_session.title` in the conversation list, an `agent_card.title` in
 * the bell, an `agent_message.content` a person reads as an assistant turn.
 * It is the unasked delivery (M35's brief and digest, M43's mail draft), and
 * it is model-free by design, so there is no "language of the conversation"
 * for it to follow: the composer picks, at write time, from the language the
 * recipient's own interface runs in (`db/reader-language.ts` explains the
 * ladder and what it refuses).
 *
 * ── THE SHAPE IS THE ONE THIS REPO ALREADY USES ───────────────────────────
 *
 * `{ fa, en }` beside each other in one place, exactly as `CLIENT_TOOLS`
 * carries its consent-card labels in `agent/client-tools.ts` ("shown to the
 * person as what the assistant is doing — in THEIR language; the ask's locale
 * picks the side"). Keeping the pair in one literal is what makes a missing
 * translation a TYPE ERROR instead of a silent fall-back to the language
 * whoever wrote it happened to speak — which is the failure mode
 * `seededCopy.guard.test.ts` exists to catch one layer up, where the two
 * halves live in two files and cannot check each other.
 *
 * ── THE PERSIAN IS BYTE-IDENTICAL TO WHAT SHIPPED ─────────────────────────
 *
 * Not a coincidence and not laziness. This is a bug about a language being
 * imposed, and the only fix that cannot BE the same bug pointed the other way
 * is one where the Persian reader's screen is provably unchanged. So the
 * Persian strings below are the literals that were in `signal-step.ts` and
 * `mail-poll.ts`, moved and not rewritten, and the tests assert them as
 * literals rather than as "some Persian" — a check that only asks whether
 * English appears for an English reader would pass just as happily against a
 * version that had quietly translated the Persian-first product into English.
 */
import type { ReaderLanguage } from "../db/reader-language.ts";

/** A record with no title of its own — `calls.untitled` in both catalogues. */
const UNTITLED: Record<ReaderLanguage, string> = {
  fa: "بدون عنوان",
  en: "Untitled",
};

export function untitledRecord(language: ReaderLanguage): string {
  return UNTITLED[language];
}

/**
 * M35's post-call brief. One title (it is the conversation's name AND the
 * card's, so it is one string by construction and cannot drift into two) and
 * one body, which has a summary or honestly says it has not.
 *
 * The English says "record" because that is what `echo.call` is called on the
 * English screen this lands on (`agents.tool.list_records` and its thirty
 * siblings in `messages/en.json`); the Persian says «تماس» because that is
 * what it has always said. A word that matches the catalogue on one screen
 * and not the other is the drift this whole change exists to remove.
 */
export function briefTitle(language: ReaderLanguage, name: string): string {
  return language === "en"
    ? `Summary ready — “${name}”`
    : `خلاصهٔ آمادهٔ «${name}»`;
}

export function briefBody(
  language: ReaderLanguage,
  name: string,
  summary: string | undefined,
): string {
  if (language === "en") {
    return summary
      ? `“${name}” has been processed. The summary:\n\n${summary}\n\nYou can ask about it right here.`
      : `“${name}” has been processed, but no summary was recorded (the reason is on the record's own page). You can ask about it right here.`;
  }
  return summary
    ? `تماس «${name}» پردازش شد. خلاصه:\n\n${summary}\n\nمی‌توانید همین‌جا درباره‌اش بپرسید.`
    : `تماس «${name}» پردازش شد، اما خلاصه‌ای ثبت نشده است (دلیل در صفحهٔ تماس آمده). می‌توانید همین‌جا درباره‌اش بپرسید.`;
}

/** M35's weekly digest. */
export function digestTitle(language: ReaderLanguage): string {
  return language === "en" ? "Weekly digest" : "گزارش هفتگی";
}

/**
 * The digest's body.
 *
 * THE COUNT STAYS AS THE SERVER RENDERS IT — ASCII in both languages, which
 * is what shipped. Persian digits are a DISPLAY rule this platform enforces
 * in `web/src/lib/format.ts`, where the reader's preference is known and the
 * same number can be re-rendered when it changes; changing the Persian bytes
 * here would put a second, frozen answer to that question inside a stored
 * paragraph, and it would do it inside a change whose whole claim is that the
 * Persian reader's screen is untouched. Named here so the next person can see
 * it was decided rather than missed.
 */
export function digestBody(
  language: ReaderLanguage,
  count: number,
  titles: readonly string[],
): string {
  if (language === "en") {
    if (count === 0) return "Nothing was recorded this week.";
    const listing = titles.length ? `\n\nThis week's records:\n- ${titles.join("\n- ")}` : "";
    /* one record is not "1 records"; Persian has no such agreement to make,
       which is why this branch exists on one side only */
    const noun = count === 1 ? "record" : "records";
    return `This week, ${count} ${noun} became available to you.`
      + `${listing}\n\nAsk here for the detail.`;
  }
  if (count === 0) return "این هفته تماسی ثبت نشد.";
  const listing = titles.length ? `\n\nتماس‌های هفته:\n- ${titles.join("\n- ")}` : "";
  return `این هفته ${count} تماس در دسترس شما ثبت شد.${listing}\n\nبرای جزئیات هرکدام، همین‌جا بپرسید.`;
}

/**
 * M43's mail draft: the line that stands in the thread when the model wrote a
 * draft but no note to go with it.
 *
 * The model's own note is NOT touched by any of this — it is written in the
 * language of the email it read, which is the third mechanism (the text
 * follows its source) and the right one there. Only the stand-in is ours to
 * choose a language for, which is exactly why it was the one string in that
 * file that could be wrong.
 */
export function mailDraftNote(language: ReaderLanguage): string {
  return language === "en"
    ? "A reply draft is ready."
    : "پیش‌نویس پاسخ آماده است.";
}
