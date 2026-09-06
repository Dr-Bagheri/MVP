import { describe, expect, it } from "vitest";
import { draftNamesHandle } from "./Composer";

/**
 * The reply-to-agent guard used to be ``new RegExp(`(?:^|\\s)@${handle}\\b`)``
 * inside a template literal — where `\b` is a BACKSPACE, so the guard
 * matched nothing and a cancel-then-reply prepended «@roya» twice
 * (2026-09-06). Words compared as words cannot have that bug.
 */
describe("draftNamesHandle", () => {
  it("finds the handle when the draft already addresses it", () => {
    expect(draftNamesHandle("@roya hello", "roya")).toBe(true);
    expect(draftNamesHandle("hello @Roya", "roya")).toBe(true);
  });
  it("does not mistake a longer word for the handle", () => {
    expect(draftNamesHandle("@royal hello", "roya")).toBe(false);
    expect(draftNamesHandle("", "roya")).toBe(false);
    expect(draftNamesHandle("roya without the at", "roya")).toBe(false);
  });
});
