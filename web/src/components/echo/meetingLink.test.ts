import { describe, expect, it } from "vitest";
import { shouldLinkMeeting } from "./meetingLink";

/**
 * The link guard's whole matrix — the middle row is the reason the guard
 * exists (the review round's worst confirmed finding): the engine's
 * LEFTOVER callId from an unrelated take must never become this meeting's
 * record. Verified red by removing the baseline comparison: the leftover
 * case linked.
 */
describe("shouldLinkMeeting", () => {
  const target = { linked: false };

  it("links a take that started AFTER adoption (id moved off the baseline)", () => {
    expect(shouldLinkMeeting(target, "c-new", null)).toBe(true);
    expect(shouldLinkMeeting(target, "c-new", "c-old")).toBe(true);
  });

  it("never links the engine's leftover take — the id the engine already held at adoption", () => {
    expect(shouldLinkMeeting(target, "c-old", "c-old")).toBe(false);
  });

  it("never links without a meeting, an armed target, or a call", () => {
    expect(shouldLinkMeeting(null, "c-new", null)).toBe(false);
    expect(shouldLinkMeeting({ linked: true }, "c-new", null)).toBe(false);
    expect(shouldLinkMeeting(target, null, null)).toBe(false);
    expect(shouldLinkMeeting(target, "", null)).toBe(false);
  });
});
