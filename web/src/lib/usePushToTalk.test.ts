import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePushToTalk } from "./usePushToTalk";
import { setPushToTalkKey } from "./pushToTalk";

/**
 * THE HOTKEY, AND WHERE THE CARET IS.
 *
 * User report, 2026-09-04: "the hotkey works in the side menu bar with the mic
 * getting selected, but in the AI assistant page it does not."
 *
 * Both surfaces run this hook, so the difference was never the surface — it
 * was FOCUS. The assistant page puts the caret in its composer on mount, so
 * `event.target` was that textarea and the typing guard refused; the panel
 * does not, so the same key worked. The composer is also exactly where
 * dictation writes, which makes "your caret is in a text box" the worst
 * possible reason to refuse a microphone.
 *
 * The guard still has a job — a hotkey bound to a LETTER must stay a letter
 * while somebody is writing «سلام» — so the rule is about the KEY, not the
 * target: a key that would type a character is refused inside a field, and
 * every other key is allowed.
 */
function press(code: string, key: string, target?: EventTarget): void {
  const event = new KeyboardEvent("keydown", { code, key, bubbles: true });
  if (target) Object.defineProperty(event, "target", { value: target });
  window.dispatchEvent(event);
}
function release(code: string, key: string): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
}

function fieldWithCaret(): HTMLTextAreaElement {
  const box = document.createElement("textarea");
  document.body.appendChild(box);
  return box;
}

afterEach(() => {
  document.body.innerHTML = "";
  setPushToTalkKey(null);
});

describe("push to talk", () => {
  it("fires while the caret is in the composer — the reported bug", () => {
    setPushToTalkKey("F9");
    const onPress = vi.fn();
    const onRelease = vi.fn();
    renderHook(() => usePushToTalk({ onPress, onRelease }));

    act(() => press("F9", "F9", fieldWithCaret()));
    expect(onPress, "the hotkey was refused because a text box had focus").toHaveBeenCalledTimes(1);
    act(() => release("F9", "F9"));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("still refuses a LETTER key while somebody is writing", () => {
    /*
     * The control, and the reason the guard exists at all: bound to a letter,
     * the key has to stay a letter inside a field or typing «سلام» opens a
     * microphone. Without this, "always fire" passes the test above and breaks
     * every text box in the product.
     */
    setPushToTalkKey("KeyS");
    const onPress = vi.fn();
    renderHook(() => usePushToTalk({ onPress, onRelease: vi.fn() }));

    act(() => press("KeyS", "س", fieldWithCaret()));
    expect(onPress, "a letter hotkey fired while typing").not.toHaveBeenCalled();

    /* and the same key OUTSIDE a field is the hotkey it was bound as */
    act(() => press("KeyS", "س", document.body));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all until a key is chosen", () => {
    setPushToTalkKey(null);
    const onPress = vi.fn();
    renderHook(() => usePushToTalk({ onPress, onRelease: vi.fn() }));
    act(() => press("F9", "F9", document.body));
    expect(onPress, "an unbound hotkey guessed at a default").not.toHaveBeenCalled();
  });

  it("ignores the repeat a held key sends", () => {
    setPushToTalkKey("F9");
    const onPress = vi.fn();
    renderHook(() => usePushToTalk({ onPress, onRelease: vi.fn() }));
    act(() => {
      press("F9", "F9", document.body);
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "F9", key: "F9", repeat: true }));
    });
    expect(onPress, "holding the key started dictation more than once").toHaveBeenCalledTimes(1);
  });
});
