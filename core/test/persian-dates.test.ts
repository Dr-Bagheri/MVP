/**
 * Persian date resolution. Reference anchored to REALITY: 2026-08-23 is a
 * Sunday and renders as ۱ شهریور ۱۴۰۵ in the product's own top bar — the
 * fixture comes from the calendar, not from this module's beliefs. The
 * negative controls carry the casebook's own trap: «دی» is a month AND a
 * substring of «محمدی».
 */
import { describe, expect, it } from "vitest";
import { extractPersianDates, fromJalali, toJalali } from "../src/worker/persian-dates.ts";

const REF = new Date(2026, 7, 23, 10, 30); // Sunday, 1 Shahrivar 1405

const one = (text: string) => {
  const all = extractPersianDates(text, REF);
  expect(all.length, text).toBe(1);
  return all[0]!;
};

describe("the two conversion directions agree with each other", () => {
  it("round-trips the reference day", () => {
    const j = toJalali(REF);
    expect(j).toEqual({ jy: 1405, jm: 6, jd: 1 });
    const g = fromJalali(1405, 6, 1)!;
    expect(g.getFullYear()).toBe(2026);
    expect(g.getMonth()).toBe(7);
    expect(g.getDate()).toBe(23);
  });

  it("an impossible date resolves to nothing, never to a guess", () => {
    expect(fromJalali(1405, 6, 32)).toBeNull();
  });
});

describe("relative expressions", () => {
  it("فردا / پس‌فردا / امروز", () => {
    expect(one("قرار شد فردا تحویل دهیم").gregorian).toBe("2026-08-24");
    expect(one("پس‌فردا جلسه داریم").gregorian).toBe("2026-08-25");
    expect(one("امروز تمامش می‌کنم").gregorian).toBe("2026-08-23");
  });

  it("a bare weekday means the NEXT one (ref is Sunday/یکشنبه)", () => {
    expect(one("سه‌شنبه آماده می‌شود").gregorian).toBe("2026-08-25");
    expect(one("جمعه می‌بینمت").gregorian).toBe("2026-08-28");
    // today's own name reaches a WEEK out, not zero days
    expect(one("یکشنبه دوباره صحبت کنیم").gregorian).toBe("2026-08-30");
  });

  it("«هفتهٔ آینده» pushes the weekday into NEXT week", () => {
    // next week starts Saturday 2026-08-29; its Tuesday is 09-01
    expect(one("سه‌شنبهٔ هفتهٔ آینده مهلت ماست").gregorian).toBe("2026-09-01");
    expect(one("تا هفتهٔ بعد تمام شود").gregorian).toBe("2026-08-30");
  });

  it("counted spans, word or digit", () => {
    expect(one("دو روز دیگر خبر می‌دهم").gregorian).toBe("2026-08-25");
    expect(one("۳ روز دیگر جواب می‌آید").gregorian).toBe("2026-08-26");
    expect(one("دو هفته دیگر نسخهٔ بعدی").gregorian).toBe("2026-09-06");
  });
});

describe("absolute Jalali dates", () => {
  it("«۱۵ شهریور» — the next occurrence, resolved through the real calendar", () => {
    const d = one("مهلت ارسال ۱۵ شهریور است");
    expect(d.jalali).toEqual({ jy: 1405, jm: 6, jd: 15 });
    expect(d.gregorian).toBe("2026-09-06");
  });

  it("«اول مهر» crosses the month boundary correctly", () => {
    const d = one("از اول مهر شروع می‌کنیم");
    expect(d.jalali).toEqual({ jy: 1405, jm: 7, jd: 1 });
    expect(d.gregorian).toBe("2026-09-23");
  });

  it("a date already past this year rolls to NEXT year", () => {
    // 15 Tir 1405 was ~July 2026, before the reference → 1406
    const d = one("پانزدهم تیر جشن می‌گیریم");
    expect(d.jalali.jy).toBe(1406);
    expect(d.jalali.jm).toBe(4);
  });
});

describe("negative controls — the matcher must be able to say NO", () => {
  it("«دی» inside «محمدی» is a NAME, not a month", () => {
    expect(extractPersianDates("آقای محمدی گزارش را فرستاد", REF)).toEqual([]);
  });

  it("bare numbers and room numbers resolve to nothing", () => {
    expect(extractPersianDates("اتاق ۴۰۴ طبقهٔ سه", REF)).toEqual([]);
  });

  it("«فردا» inside a longer word does not fire", () => {
    expect(extractPersianDates("فرداد آمد", REF)).toEqual([]);
  });
});
