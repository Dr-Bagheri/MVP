import { describe, expect, it } from "vitest";
import { formatDuration, modelLabel } from "./format";

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
