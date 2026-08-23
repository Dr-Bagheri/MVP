/**
 * The redactor's risk runs BOTH ways: an identifier that survives is a
 * leak, an amount that masks is an edit. Both directions pinned, Persian
 * digits included.
 */
import { describe, expect, it } from "vitest";
import { redactSensitive, REDACTION_MASK } from "./redact";

describe("redactSensitive", () => {
  it("masks the identifier shapes — both scripts, grouped or bare", () => {
    for (const s of [
      "کد ملی من 0071234567 است",
      "کارت 6104 3378 1234 5678 را بزن",
      "شماره‌ام ۰۹۱۲۳۴۵۶۷۸۹ است",
      "شبا IR062960000000100324200001",
    ]) {
      const out = redactSensitive(s);
      expect(out, s).toContain(REDACTION_MASK);
      expect(out, s).not.toMatch(/[0-9۰-۹]{6}/);
    }
  });

  it("NEVER eats amounts, dates or short numbers — the negative controls", () => {
    for (const s of [
      "بودجه ۲۵۰ هزار تومان شد",
      "جلسه 1405/06/01 ساعت 14:30",
      "سه میلیارد تومان تصویب شد",
      "اتاق 404، طبقهٔ 3",
      "10,000,000,000 ریال", // comma-grouped survives — documented tradeoff
    ]) {
      expect(redactSensitive(s), s).toBe(s);
    }
  });
});
