import { describe, expect, it } from "vitest";
import { timeInstructions } from "../src/api/assistant.ts";

/**
 * THE ASSISTANT'S SENSE OF TIME.
 *
 * User report, 2026-09-04: asked for a meeting "Monday at nine", the agent
 * created one at half past twelve. Nothing in the assembled instructions had
 * ever said what day it was, so the hour came out of a training corpus.
 *
 * The property that matters is not "a date appears" — a wrong date appears
 * too. It is that the instant is expressed IN THE PERSON'S ZONE, because the
 * failure this prevents is the one nobody reads as a bug: the date right, the
 * hour off by a fixed amount, on every meeting, forever.
 */
const NOON_UTC = new Date("2026-09-04T12:00:00Z");

describe("what time the assistant thinks it is", () => {
  it("speaks the wall clock of the person's zone, not the server's", () => {
    const tehran = timeInstructions(NOON_UTC, "Asia/Tehran");
    /* 12:00Z is 15:30 in Tehran — the +03:30 offset is the whole point, and a
       naive `toISOString()` would print 12:00 here and be three and a half
       hours wrong for every meeting this agent ever makes */
    expect(tehran).toContain("2026-09-04T15:30:00+03:30");
    expect(tehran).toContain("Asia/Tehran");

    const london = timeInstructions(NOON_UTC, "Europe/London");
    expect(london).toContain("2026-09-04T13:00:00+01:00");
  });

  it("carries the same instant in BOTH calendars", () => {
    const out = timeInstructions(NOON_UTC, "Asia/Tehran");
    /* the person says «۱۳ شهریور» and the wire says 2026-09-04; a model given
       only one of those has to convert unaided, and it is the Persian half it
       gets wrong */
    expect(out).toContain("Friday");
    expect(out).toMatch(/شهریور/);
    expect(out, "the Jalali year is the one the person counts in").toMatch(/۱۴۰۵/);
  });

  it("names the day of the week — 'Monday' cannot be resolved without it", () => {
    expect(timeInstructions(NOON_UTC, "UTC")).toContain("Friday");
  });

  it("says so when it is falling back, instead of passing UTC off as their zone", () => {
    const bogus = timeInstructions(NOON_UTC, "Mars/Olympus");
    expect(bogus).toContain("UTC");
    expect(bogus, "a guessed zone must not read as a known one").toContain("fallback");
    /* and a zone that IS theirs carries no such apology */
    expect(timeInstructions(NOON_UTC, "Asia/Tehran")).not.toContain("fallback");
  });

  it("UTC renders as +00:00, not as the word GMT", () => {
    /* Intl formats the UTC offset as the bare string "GMT", which pasted into
       an ISO value gives `…T12:00:00GMT` — a shape no parser takes */
    const out = timeInstructions(NOON_UTC, "UTC");
    expect(out).toContain("2026-09-04T12:00:00+00:00");
    expect(out).not.toMatch(/T\d\d:\d\d:\d\dGMT/);
  });

  it("tells the model what shape to hand a tool", () => {
    const out = timeInstructions(NOON_UTC, "Asia/Tehran");
    expect(out).toContain("ISO 8601");
    /* the example carries the person's own offset, not a canned one: an
       example in the wrong zone is a worked instruction to be wrong */
    expect(out).toContain("T09:00:00+03:30");
  });

  it("the control: a different instant gives different instructions", () => {
    /* without this, a helper that returned a fixed sentence would satisfy
       every assertion above */
    const later = timeInstructions(new Date("2026-12-25T06:00:00Z"), "Asia/Tehran");
    expect(later).toContain("2026-12-25T09:30:00+03:30");
    expect(later).not.toContain("2026-09-04");
  });
});
