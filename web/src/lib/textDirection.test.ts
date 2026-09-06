import { describe, expect, it } from "vitest";

import { dirFor, languageMix } from "./textDirection";

/**
 * The direction rule and the mix, with the half a paraphrase forgets: an
 * unidentified language yields NO direction (the line follows the document,
 * never a guess) and NO share (a percentage of "not said" is a number that
 * means nothing).
 */
describe("dirFor", () => {
  it("is rtl for the right-to-left scripts, ltr for the rest, region ignored", () => {
    expect(dirFor("fa")).toBe("rtl");
    expect(dirFor("ar-SA")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(dirFor("en-us")).toBe("ltr");
    expect(dirFor("de")).toBe("ltr");
  });

  it("is UNDEFINED — not ltr — for a line whose language was not identified", () => {
    expect(dirFor(null)).toBeUndefined();
    expect(dirFor(undefined)).toBeUndefined();
    expect(dirFor("")).toBeUndefined();
  });
});

describe("languageMix", () => {
  it("counts lines that named a language, largest first, and folds regions", () => {
    const rows = [
      { language: "fa" }, { language: "fa" }, { language: "en-us" }, { language: null }, { language: "fa" },
    ];
    expect(languageMix(rows)).toEqual([
      { code: "fa", lines: 3, share: 0.75 },
      { code: "en", lines: 1, share: 0.25 },
    ]);
  });

  it("is empty when no line named a language — nothing to make a percentage of", () => {
    expect(languageMix([{ language: null }, { language: null }])).toEqual([]);
    expect(languageMix([])).toEqual([]);
  });
});
