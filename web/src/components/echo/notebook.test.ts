import { describe, expect, it } from "vitest";
import { splitEntry } from "./RecorderNotes";

/**
 * "It realizes the title itself" (user directive, 2026-08-22): the first
 * line of a multi-line entry is the chapter title — no second input, no
 * mode. Pinned both directions: what becomes a title, and what stays an
 * ordinary note.
 */
describe("splitEntry", () => {
  it("a multi-line entry: first line is the chapter, the rest the note", () => {
    expect(splitEntry("بودجهٔ فصل بعد\nقرار شد تا پنج‌شنبه اعلام شود")).toEqual({
      title: "بودجهٔ فصل بعد",
      body: "قرار شد تا پنج‌شنبه اعلام شود",
    });
  });

  it("a single line is JUST a note — a lone sentence is not a heading", () => {
    expect(splitEntry("پیگیری قرارداد با تیم حقوقی")).toEqual({
      title: null,
      body: "پیگیری قرارداد با تیم حقوقی",
    });
  });

  it("a LONG opening line is prose, not a title", () => {
    const long = "x".repeat(120);
    expect(splitEntry(`${long}\nmore text`)).toEqual({
      title: null,
      body: `${long}\nmore text`,
    });
  });

  it("blank lines around the title do not confuse it", () => {
    expect(splitEntry("  Budget  \n\n  the details  ")).toEqual({
      title: "Budget",
      body: "the details",
    });
  });

  it("empty input is nothing at all", () => {
    expect(splitEntry("   \n  ")).toEqual({ title: null, body: "" });
  });
});
