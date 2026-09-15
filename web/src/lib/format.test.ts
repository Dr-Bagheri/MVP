import { describe, expect, it } from "vitest";
import { formatDuration, humanInstant, modelLabel } from "./format";

describe("modelLabel", () => {
  it("uses the approved Gemini display names without changing provider identifiers", () => {
    expect(modelLabel("Google: Gemini 3.1 Pro Preview")).toBe("Gemini 3.1 Pro");
    expect(modelLabel("Google: Gemini 3.1 Flash Lite")).toBe("Gemini 3.1 Flash");
  });
});

describe("formatDuration", () => {
  it("shows SECONDS under a minute — '0 min' on a 13-second call reads as no recording", () => {
    expect(formatDuration(13, "en")).toBe("13 s");
    expect(formatDuration(13, "fa")).toBe("۱۳ ثانیه");
  });

  it("switches to minutes at a full minute", () => {
    expect(formatDuration(60, "en")).toBe("1 min");
    expect(formatDuration(90, "en")).toBe("2 min");
    expect(formatDuration(60, "fa")).toBe("۱ دقیقه");
  });
});

/*
 * The defect this was written for: an assistant call-history table whose
 * "When" column was thirteen rows of `2026-09-09T13:22:47.105Z` — the wire's
 * own string, copied out of a tool result into a cell.
 */
describe("humanInstant", () => {
  it("rewrites a cell that IS an ISO instant into a written date and clock", () => {
    const shown = humanInstant("2026-09-09T13:22:47.105Z", "en");
    expect(shown).not.toContain("T13:22:47");
    expect(shown).not.toContain("Z");
    expect(shown).toContain("Sep");
    expect(shown).toContain("2026");
    expect(shown).toMatch(/\d{2}:\d{2}/);
  });

  it("accepts an offset instant, not only UTC", () => {
    expect(humanInstant("2026-09-09T13:22:47+03:30", "en")).toContain("Sep");
  });

  it("leaves anything that is not a whole instant exactly as written", () => {
    /* a bare date may be a label, a quarter, a version — not ours to rewrite */
    expect(humanInstant("2026-09-09", "en")).toBe("2026-09-09");
    /* prose that merely mentions one stays the model's own sentence */
    expect(humanInstant("met on 2026-09-09T13:22:47.105Z", "en"))
      .toBe("met on 2026-09-09T13:22:47.105Z");
    expect(humanInstant("Weekly meeting with NAI", "en")).toBe("Weekly meeting with NAI");
    expect(humanInstant("", "en")).toBe("");
  });

  it("returns the model's own words when the instant cannot be parsed", () => {
    expect(humanInstant("2026-13-45T99:99:99Z", "en")).toBe("2026-13-45T99:99:99Z");
  });
});
