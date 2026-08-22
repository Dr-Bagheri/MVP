import { describe, expect, it } from "vitest";
import { isConversationOver, isEchoOf, isNoiseUtterance, isStopCommand, matchWake, sameUtterance } from "./voice";

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

  it("survives the fa recognizer FUSING the greeting into the name", () => {
    // live transcripts, 2026-08-22: fa-IR heard "hey echo" as «هایکو»,
    // "hi echo" as «های اکو», and the bare name as «ایکو»
    expect(matchWake("هایکو")).toEqual({ woke: true, command: "" });
    expect(matchWake("های اکو")).toEqual({ woke: true, command: "" });
    expect(matchWake("ایکو برو به ضبط‌ها").command).toBe("برو به ضبط‌ها");
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

describe("sameUtterance — the re-finalization dedupe", () => {
  it("the provider re-spelling the consumed interim is the SAME utterance", () => {
    expect(sameUtterance("Why are you hearing everything twice?", "why are you hearing everything twice")).toBe(true);
    expect(sameUtterance("چرا دوبار می‌شنوی؟", "چرا دوبار می‌شنوی")).toBe(true);
  });

  it("EXTENDED speech is a new utterance — no overlap heuristics here", () => {
    expect(sameUtterance("why are you hearing everything twice and how do I fix it", "why are you hearing everything twice")).toBe(false);
  });

  it("empty never matches anything", () => {
    expect(sameUtterance("", "")).toBe(false);
  });
});

describe("isNoiseUtterance — the dash-only phantom filter", () => {
  it("punctuation-only transcripts are noise (the mid-conversation dash bubbles)", () => {
    for (const phantom of ["—", "-", "…", "...", "؟", "?!"]) {
      expect(isNoiseUtterance(phantom), phantom).toBe(true);
    }
  });

  it("anything with a letter or digit — either script — is real speech", () => {
    expect(isNoiseUtterance("و")).toBe(false);
    expect(isNoiseUtterance("ok")).toBe(false);
    expect(isNoiseUtterance("۲")).toBe(false);
  });
});

describe("isConversationOver — the goodbye detector", () => {
  it("catches every finished-phrase the user named, filler-tolerant", () => {
    for (const phrase of [
      "i dont have anything else",
      "I don't have anything else",
      "thanks thats enough",
      "thanks that's it",
      "stop it",
      "okay stop",
      "no thanks that's all",
      "ok we're done",
      "goodbye",
      "مرسی همین بود",
      "دیگه چیزی ندارم",
      "خیلی ممنون کافیه",
      "ممنون تمام شد",
      "خداحافظ",
    ]) {
      expect(isConversationOver(phrase), phrase).toBe(true);
    }
  });

  it("a real request NEVER reads as a goodbye — non-closing words break it", () => {
    for (const phrase of [
      "thanks, now open the records",
      "stop the recording and save it",
      "do we have anything else in the archive",
      "that's the summary I wanted, translate it",
      "برو به ضبط‌ها",
      "خلاصهٔ همین تماس رو بگو",
    ]) {
      expect(isConversationOver(phrase), phrase).toBe(false);
    }
  });
});
