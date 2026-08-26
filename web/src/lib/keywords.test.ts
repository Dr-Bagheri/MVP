import { describe, expect, it } from "vitest";
import { extractKeywords } from "./keywords";

/**
 * The Keywords tab's extractor. Rule-7 shape: the POSITIVE case leads —
 * an extractor wired wrong usually returns [] and passes every "no junk"
 * test, so the first assertion is that real Persian meeting talk yields
 * real content words.
 */
describe("extractKeywords", () => {
  it("finds the content words of Persian meeting talk", () => {
    const words = extractKeywords(
      "دربارهٔ بودجه صحبت کردیم و بودجه سال آینده تصویب شد. بودجه بازاریابی جدا شد.",
    );
    expect(words.length).toBeGreaterThan(0);
    expect(words[0]).toEqual({ word: "بودجه", count: 3 });
  });

  it("never surfaces function words — the negative control", () => {
    const words = extractKeywords("و در به از که این با را برای the and of to");
    expect(words).toEqual([]);
  });

  it("keeps ZWNJ words whole", () => {
    const words = extractKeywords("می‌رویم می‌رویم می‌رویم");
    expect(words[0]!.word).toBe("می‌رویم");
  });

  it("mixed-language text counts both sides", () => {
    const words = extractKeywords("roadmap بودجه roadmap بودجه roadmap");
    expect(words.map((w) => w.word)).toEqual(["roadmap", "بودجه"]);
  });

  it("bare numbers are not keywords", () => {
    expect(extractKeywords("1400 1400 1400")).toEqual([]);
  });

  it("caps the list", () => {
    const text = Array.from({ length: 30 }, (_, i) => `topic${i} topic${i}`).join(" ");
    expect(extractKeywords(text, 12)).toHaveLength(12);
  });
});
