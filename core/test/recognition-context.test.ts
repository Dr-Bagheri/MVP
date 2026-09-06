import { describe, expect, it } from "vitest";

import { buildRecognitionContext, MAX_TERMS, MAX_TERMS_CHARS } from "../src/db/recognition-context.ts";

/**
 * The pure half of the recognition context (2026-09-06): what the
 * transcriber is told about the organisation. The rules under test are the
 * ones a paraphrase would get wrong — the ORDER (the org's own glossary
 * first, because it was written to steer exactly this), the de-duplication
 * that folds ZWNJ and case, the budget, and the absence: nothing to say means
 * NO context, never an empty one.
 */
describe("buildRecognitionContext", () => {
  it("keeps the producer's order — glossary, people, members, projects — and de-duplicates across them", () => {
    const out = buildRecognitionContext({
      glossary: ["نورای", "Soniox"],
      people: ["سینا سپاسی", "نورای"], // the glossary already has it
      members: ["Sina Sepasi", "sina", "soniox"], // case folds
      projects: ["دیتابیس صوتی"],
    })!;
    expect(out.terms).toEqual(["نورای", "Soniox", "سینا سپاسی", "Sina Sepasi", "sina", "دیتابیس صوتی"]);
  });

  it("folds ZWNJ so a name typed with and without it is one term", () => {
    const out = buildRecognitionContext({
      glossary: ["می‌شود"], people: ["میشود"], members: [], projects: [],
    })!;
    expect(out.terms).toEqual(["می‌شود"]);
  });

  it("carries the recording's title as text and the organisation as a general fact", () => {
    const out = buildRecognitionContext({
      glossary: [], people: [], members: [], projects: [],
      title: "  جلسهٔ   شروع پروژه  ", org: "Neurai",
    })!;
    expect(out.terms).toEqual([]);
    expect(out.text).toBe("جلسهٔ شروع پروژه");
    expect(out.general).toEqual([{ key: "organization", value: "Neurai" }]);
  });

  it("is NULL when there is nothing to say — an empty context is a claim not made", () => {
    expect(buildRecognitionContext({ glossary: [], people: [], members: [], projects: [] })).toBeNull();
    expect(buildRecognitionContext({ glossary: ["x"], people: [" "], members: [], projects: [], title: "  ", org: "" })).toBeNull();
  });

  it("stops at the budget in both dimensions", () => {
    const many = Array.from({ length: MAX_TERMS + 50 }, (_, i) => `term${i}`);
    expect(buildRecognitionContext({ glossary: many, people: [], members: [], projects: [] })!.terms.length).toBe(MAX_TERMS);
    const long = Array.from({ length: 200 }, (_, i) => `${"ا".repeat(70)}${i}`);
    const chars = buildRecognitionContext({ glossary: long, people: [], members: [], projects: [] })!.terms.join("").length;
    expect(chars).toBeLessThanOrEqual(MAX_TERMS_CHARS);
  });
});
