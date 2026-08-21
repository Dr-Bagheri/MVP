import { describe, expect, it } from "vitest";
import { isEchoOf, isStopCommand, matchWake } from "./voice";

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

  it("survives the English recognizer's artifacts for «سلام اکو»", () => {
    // live transcripts, 2026-08-21: the en-US model heard «سلام اکو» as
    // "Salon" and "Ecco salon" — both must be a bare wake, never a command
    expect(matchWake("Salon")).toEqual({ woke: true, command: "" });
    expect(matchWake("Ecco salon")).toEqual({ woke: true, command: "" });
    expect(matchWake("ecco record new call").command).toBe("record new call");
  });

  it("keeps 'salon' as an ordinary word inside real speech", () => {
    expect(matchWake("book the hair salon for me").woke).toBe(false);
    expect(matchWake("echo find the salon call").command).toBe("find the salon call");
  });
});

describe("isStopCommand", () => {
  it("recognizes the stop words in both languages", () => {
    for (const phrase of ["stop", "Stop.", "cancel", "enough", "بسه", "بس کن", "ساکت", "قطع کن", "کافیه"]) {
      expect(isStopCommand(phrase), phrase).toBe(true);
    }
  });

  it("never eats a real command that merely CONTAINS a stop word", () => {
    expect(isStopCommand("stop the recording and save it")).toBe(false);
    expect(isStopCommand("cancel the meeting tomorrow")).toBe(false);
  });
});

describe("isEchoOf — the full-duplex echo filter", () => {
  const reply = "I have started the recording for you. Let me know when you're done or if you need to pause it!";

  it("recognizes the assistant's own sentence leaking back (the live screenshot)", () => {
    expect(isEchoOf("for you let me know when you're done or if you need to pause it", reply)).toBe(true);
    expect(isEchoOf("let me know when you are done", reply)).toBe(true);
  });

  it("a real barge-in brings NEW words and passes through", () => {
    expect(isEchoOf("no wait, open the archive instead", reply)).toBe(false);
    expect(isEchoOf("برو به بایگانی", reply)).toBe(false);
  });

  it("short utterances are not fingerprintable — never swallowed by overlap", () => {
    expect(isEchoOf("pause it", "totally unrelated words here")).toBe(false);
  });
});
