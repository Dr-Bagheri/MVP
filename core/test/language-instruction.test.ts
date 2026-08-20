/**
 * The assistant answers in the INTERFACE language (user directive,
 * 2026-08-20): the shipped skill's prompt is Persian-first, and an
 * English-interface user was getting Persian answers. The helper is the
 * single producer of the instruction; both ask and regenerate consume it.
 */
import { describe, expect, it } from "vitest";
import { languageInstruction } from "../src/api/assistant.ts";

describe("languageInstruction", () => {
  it("names Persian for fa and English for en — each in its own language", () => {
    expect(languageInstruction("fa")).toContain("فارسی");
    expect(languageInstruction("en")).toContain("English");
    // and they are different instructions, not one string reused
    expect(languageInstruction("fa")).not.toBe(languageInstruction("en"));
  });

  it("returns undefined for anything else — additive wire, never a 400", () => {
    // an older client sends no locale; a future one may send a new code.
    // Both must degrade to "no instruction", never to an error or to a
    // default language the caller did not choose.
    expect(languageInstruction(undefined)).toBeUndefined();
    expect(languageInstruction("")).toBeUndefined();
    expect(languageInstruction("de")).toBeUndefined();
    expect(languageInstruction(42)).toBeUndefined();
    expect(languageInstruction(null)).toBeUndefined();
  });
});
