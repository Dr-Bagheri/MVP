import { describe, expect, it } from "vitest";
import { languageHintsFor } from "../src/worker/steps.ts";

/**
 * call.language → transcriber hints (user directive, 2026-08-22). The
 * mapping is tiny; what it must never do is NARROW on vocabulary it does
 * not recognise — an unknown value keeps the historical both-languages
 * hint. (The wiring itself — hints reaching ml.process — is proven in the
 * e2e live lane, where a real call carries a real language.)
 */
describe("languageHintsFor", () => {
  it("an explicit single language narrows the hints — the feature's point", () => {
    expect(languageHintsFor("fa")).toEqual(["fa"]);
    expect(languageHintsFor("en")).toEqual(["en"]);
  });

  it("'mixed' means both, in Persian-first order", () => {
    expect(languageHintsFor("mixed")).toEqual(["fa", "en"]);
  });

  it("unknown vocabulary NEVER narrows — enum drift must not cost a transcript", () => {
    expect(languageHintsFor("de")).toEqual(["fa", "en"]);
    expect(languageHintsFor("")).toEqual(["fa", "en"]);
    // the join gone wrong reaches here as undefined; same safe answer
    expect(languageHintsFor(undefined as unknown as string)).toEqual(["fa", "en"]);
  });
});
