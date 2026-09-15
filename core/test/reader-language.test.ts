/**
 * THE LADDER, AND THE CONTROL THAT MAKES IT MEAN SOMETHING.
 *
 * The defect this covers (2026-09-09): an English organisation's assistant
 * wrote «خلاصهٔ آمادهٔ «Weekly meeting with NAI»» into its conversation list.
 * The obvious test — "an English reader gets English" — cannot fail for the
 * right reason on its own: a resolver that answered "en" unconditionally
 * would pass it, and that resolver is the SAME BUG with the languages
 * swapped, in a Persian-first product, where nobody would find it for a week.
 *
 * So every assertion below is paired with the Persian one it has to be
 * distinguishable from, and the pack's Persian is asserted as the LITERAL
 * that shipped rather than as "contains Persian" — the property being
 * defended is that the Persian reader's screen did not move.
 */
import { describe, expect, it } from "vitest";

import { readerLanguage, readerLanguageOf } from "../src/db/reader-language.ts";
import {
  briefBody, briefTitle, digestBody, digestTitle, mailDraftNote, untitledRecord,
} from "../src/worker/delivered-copy.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

const identity: Identity = { userId: OWNER, orgId: ORG, role: "member", isActive: true };

/**
 * A db that answers the locale join and nothing else.
 *
 * `rows: null` is the "there is no such row" case, which is a real one here
 * (an owner tombstoned between the enqueue and the delivery) and is NOT the
 * same nothing as "the value is not a language we ship".
 */
function fakeDb(rows: { person: unknown; org: unknown } | null) {
  let asked = 0;
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
        if (sql.includes("u.locale as person")) { asked += 1; return rows === null ? [] : [rows]; }
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), asked: () => asked };
}

describe("readerLanguageOf — a stored locale becomes a language we can write", () => {
  it("takes the base subtag, because the column is validated by SHAPE not by a list", () => {
    /* PATCH /v1/me accepts `en-GB` and `fa-IR` on purpose (members.ts); a
       resolver that compared whole strings would send an en-GB reader to the
       Persian rung while their interface renders English */
    expect(readerLanguageOf("en")).toBe("en");
    expect(readerLanguageOf("en-GB")).toBe("en");
    expect(readerLanguageOf("fa-IR")).toBe("fa");
    expect(readerLanguageOf("FA")).toBe("fa");
  });

  it("a language we do not ship is NULL, not a guess", () => {
    /* the discriminating half: null sends the caller to the next RUNG. A
       version that answered "fa" here would look identical on every English
       and Persian input above and would silently skip the org's own language
       for every other reader in the world. */
    expect(readerLanguageOf("de")).toBeNull();
    expect(readerLanguageOf("")).toBeNull();
    expect(readerLanguageOf(null)).toBeNull();
    expect(readerLanguageOf(undefined)).toBeNull();
    expect(readerLanguageOf(7)).toBeNull();
  });
});

describe("readerLanguage — the person, then the org, then Persian", () => {
  it("the reported case: an English person in an English org reads English", async () => {
    const { db } = fakeDb({ person: "en", org: "en" });
    expect(await readerLanguage(db, identity)).toBe("en");
  });

  it("THE REVERSE, which matters most: a Persian person in a Persian org still reads Persian", async () => {
    const { db } = fakeDb({ person: "fa", org: "fa" });
    expect(await readerLanguage(db, identity)).toBe("fa");
  });

  it("the person outranks the org — an English reader inside a Persian org (a real row: demo@pishrodata.demo)", async () => {
    const { db } = fakeDb({ person: "en", org: "fa" });
    expect(await readerLanguage(db, identity)).toBe("en");
  });

  it("and the same rung the other way — a Persian reader inside an English org", async () => {
    /* the control for the rule above: a resolver that simply preferred
       whichever value was English would pass the previous case and fail here */
    const { db } = fakeDb({ person: "fa", org: "en" });
    expect(await readerLanguage(db, identity)).toBe("fa");
  });

  it("the org is the SECOND rung, reached only when the person's value is not one of ours", async () => {
    const { db } = fakeDb({ person: "de", org: "en" });
    expect(await readerLanguage(db, identity)).toBe("en");
  });

  it("nothing usable anywhere falls to Persian — the product's default locale, not the last value read", async () => {
    expect(await readerLanguage(fakeDb({ person: "de", org: "de" }).db, identity)).toBe("fa");
    expect(await readerLanguage(fakeDb(null).db, identity)).toBe("fa");
  });

  it("one round trip per delivery — the language is read, not re-read per string", async () => {
    const { db, asked } = fakeDb({ person: "en", org: "en" });
    await readerLanguage(db, identity);
    expect(asked()).toBe(1);
  });
});

describe("the delivered copy pack", () => {
  it("the Persian is the literal that shipped — byte for byte", () => {
    /* If this file ever has to be rewritten, this is the assertion that
       stops the rewrite from being the same defect pointed the other way.
       These are the exact strings that were inline in signal-step.ts and
       mail-poll.ts before 2026-09-09. */
    expect(untitledRecord("fa")).toBe("بدون عنوان");
    expect(briefTitle("fa", "جلسهٔ هفتگی")).toBe("خلاصهٔ آمادهٔ «جلسهٔ هفتگی»");
    expect(briefBody("fa", "ج", "خ")).toBe(
      "تماس «ج» پردازش شد. خلاصه:\n\nخ\n\nمی‌توانید همین‌جا درباره‌اش بپرسید.");
    expect(briefBody("fa", "ج", undefined)).toBe(
      "تماس «ج» پردازش شد، اما خلاصه‌ای ثبت نشده است (دلیل در صفحهٔ تماس آمده)."
      + " می‌توانید همین‌جا درباره‌اش بپرسید.");
    expect(digestTitle("fa")).toBe("گزارش هفتگی");
    expect(digestBody("fa", 0, [])).toBe("این هفته تماسی ثبت نشد.");
    expect(digestBody("fa", 2, ["الف", "ب"])).toBe(
      "این هفته 2 تماس در دسترس شما ثبت شد.\n\nتماس‌های هفته:\n- الف\n- ب"
      + "\n\nبرای جزئیات هرکدام، همین‌جا بپرسید.");
    expect(mailDraftNote("fa")).toBe("پیش‌نویس پاسخ آماده است.");
  });

  it("every string has an English side, and it carries no Persian at all", () => {
    /* the half-translated shape is the one that reads as fixed: a title that
       localizes over a body that did not. So the sweep is over ALL of them,
       and it asks the question a screenshot would — is there Persian script
       on this English screen? */
    const persian = /[؀-ۿ]/;
    const english = [
      untitledRecord("en"),
      briefTitle("en", "Weekly meeting with NAI"),
      briefBody("en", "Weekly meeting with NAI", "We agreed to ship on Friday."),
      briefBody("en", "Weekly meeting with NAI", undefined),
      digestTitle("en"),
      digestBody("en", 0, []),
      digestBody("en", 1, ["Weekly meeting with NAI"]),
      digestBody("en", 3, ["a", "b", "c"]),
      mailDraftNote("en"),
    ];
    for (const line of english) {
      expect(line.trim()).not.toBe("");
      expect(line, `Persian on the English side: ${line}`).not.toMatch(persian);
    }
  });

  it("the two sides are actually different strings — the control for a pack that returns one language", () => {
    /* without this, a `delivered-copy.ts` whose `en` branch returned the
       Persian would satisfy "has an English side" for every entry that
       happens to be checked by identity elsewhere */
    expect(briefTitle("en", "x")).not.toBe(briefTitle("fa", "x"));
    expect(digestTitle("en")).not.toBe(digestTitle("fa"));
    expect(mailDraftNote("en")).not.toBe(mailDraftNote("fa"));
  });

  it("the record's own name is carried through untranslated, in both languages", () => {
    /* the bug's own signature was an English meeting title inside a Persian
       sentence; the fix must not become "translate the meeting title", which
       is a person's words and never ours */
    expect(briefTitle("fa", "Weekly meeting with NAI")).toContain("Weekly meeting with NAI");
    expect(briefTitle("en", "جلسهٔ هفتگی")).toContain("جلسهٔ هفتگی");
  });

  it("one record is not «1 records» — and the Persian has no agreement to get wrong", () => {
    expect(digestBody("en", 1, [])).toContain("1 record became available");
    expect(digestBody("en", 2, [])).toContain("2 records became available");
  });
});
