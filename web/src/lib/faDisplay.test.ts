/**
 * Display normalization: the fixes must fire, and — the negative controls —
 * text that is already right must come back BYTE-IDENTICAL (a normalizer
 * that touches correct text is an editor wearing a formatter).
 */
import { describe, expect, it } from "vitest";
import { faDisplay } from "./faDisplay";

describe("faDisplay", () => {
  it("maps Arabic letter variants to Persian", () => {
    expect(faDisplay("علي ملك")).toBe("علی ملک");
  });

  it("repairs punctuation spacing both directions", () => {
    expect(faDisplay("سلام ، خوبی")).toBe("سلام، خوبی");
    expect(faDisplay("سلام،خوبی")).toBe("سلام، خوبی");
    expect(faDisplay("گفت :باشه !")).toBe("گفت:باشه!");
  });

  it("leaves already-correct text byte-identical — the negative control", () => {
    const good = "سلام دکتر عزیز، وقت بخیر باشه. جلسهٔ فردا ساعت ۱۰ است؛ می‌آیید؟";
    expect(faDisplay(good)).toBe(good);
    const latin = "The Q3 report is due Friday.";
    expect(faDisplay(latin)).toBe(latin);
  });

  it("does not wedge a space before a closing quote", () => {
    expect(faDisplay("گفت «باشه»،«می‌آیم»")).toBe("گفت «باشه»، «می‌آیم»");
  });
});
