import { describe, expect, it } from "vitest";
import { matchWake } from "./voice";

/**
 * The wake matcher is the one pure decision in the voice path — everything
 * else is browser API plumbing that only a real microphone exercises. A
 * wrong match here either ignores the person (never wakes) or hijacks
 * ordinary speech (wakes on "echoes"), so both directions are asserted.
 */
describe("matchWake", () => {
  it("wakes on the bare name, both scripts", () => {
    expect(matchWake("echo")).toEqual({ woke: true, command: "" });
    expect(matchWake("اکو")).toEqual({ woke: true, command: "" });
  });

  it("wakes on every greeting form the directive names", () => {
    for (const phrase of ["hey echo", "hi echo", "salam echo", "سلام اکو"]) {
      expect(matchWake(phrase).woke).toBe(true);
    }
  });

  it("hands over the command that follows the name", () => {
    expect(matchWake("hey echo record new call")).toEqual({
      woke: true,
      command: "record new call",
    });
    expect(matchWake("hey echo, record new call").command).toBe("record new call");
    expect(matchWake("سلام اکو یک ضبط تازه شروع کن").command).toBe("یک ضبط تازه شروع کن");
  });

  it("does not wake inside another word", () => {
    // "echoes" contains the name; waking there would hijack ordinary speech
    expect(matchWake("the echoes of the hall").woke).toBe(false);
    expect(matchWake("checkout was fine").woke).toBe(false);
  });

  it("does not wake on unrelated speech", () => {
    expect(matchWake("start a recording please").woke).toBe(false);
    expect(matchWake("").woke).toBe(false);
  });

  it("wakes mid-sentence when the name is spoken as a word", () => {
    const result = matchWake("okay echo open my last call");
    expect(result.woke).toBe(true);
    expect(result.command).toBe("open my last call");
  });
});
