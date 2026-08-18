import { describe, expect, it } from "vitest";
import { modelLabel } from "./format";

describe("modelLabel", () => {
  it("uses the approved Gemini display names without changing provider identifiers", () => {
    expect(modelLabel("Google: Gemini 3.1 Pro Preview")).toBe("Gemini 3.1 Pro");
    expect(modelLabel("Google: Gemini 3.1 Flash Lite")).toBe("Gemini 3.1 Flash");
  });
});
