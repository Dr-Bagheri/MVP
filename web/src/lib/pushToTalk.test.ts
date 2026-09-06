import { afterEach, describe, expect, it } from "vitest";
import { isBindableKey, pushToTalkKey, resetPushToTalkForTest, setPushToTalkKey } from "./pushToTalk";

/**
 * WHICH KEYS MAY BE THE HOTKEY (2026-09-06).
 *
 * The hotkey wins inside every text box now — see usePushToTalk.ts — which is
 * the only way a key that prints a character (the stored NumpadDecimal prints
 * «.») keeps working after dictation has put the caret in the composer. The
 * price is paid here: a key that WRITES cannot be bound, or binding «س» would
 * take «س» away from every field in the product. The numpad is not writing.
 */
afterEach(() => resetPushToTalkForTest());

describe("the bindable keys", () => {
  it("refuses the writing keys — letters, digits, space and the punctuation block", () => {
    for (const code of ["KeyS", "KeyA", "Digit1", "Digit0", "Space", "Comma", "Period", "Minus", "Quote"]) {
      expect(isBindableKey(code), code).toBe(false);
    }
  });

  it("keeps the function keys, the numpad and the arrows", () => {
    for (const code of ["F9", "F1", "NumpadDecimal", "Numpad5", "NumpadAdd", "ArrowUp", "Insert", "Home", "ScrollLock"]) {
      expect(isBindableKey(code), code).toBe(true);
    }
  });

  it("setting a writing key is a no-op", () => {
    setPushToTalkKey("KeyS");
    expect(pushToTalkKey()).toBeNull();
    setPushToTalkKey("NumpadDecimal");
    expect(pushToTalkKey()).toBe("NumpadDecimal");
  });

  it("a letter stored by an earlier version is dropped on hydration; a numpad key stored earlier survives", () => {
    resetPushToTalkForTest();
    localStorage.setItem("neurai-push-to-talk", "KeyS");
    resetPushToTalkForTest(); // forget the in-memory copy, keep the storage
    localStorage.setItem("neurai-push-to-talk", "KeyS");
    expect(pushToTalkKey(), "a stored letter was honoured as a hotkey").toBeNull();
    expect(localStorage.getItem("neurai-push-to-talk")).toBeNull();

    resetPushToTalkForTest();
    localStorage.setItem("neurai-push-to-talk", "NumpadDecimal");
    expect(pushToTalkKey()).toBe("NumpadDecimal");
  });
});
