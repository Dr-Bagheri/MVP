import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePushToTalk } from "./usePushToTalk";
import { setPushToTalkKey } from "./pushToTalk";

/**
 * THE HOTKEY, AND WHERE THE CARET IS.
 *
 * User report, 2026-09-04: "the hotkey works in the side menu bar with the mic
 * getting selected, but in the AI assistant page it does not." The assistant
 * page puts the caret in its composer on mount, so `event.target` was that
 * textarea and a typing guard refused. User report, 2026-09-06: "after I
 * release the key the prompt box gets selected because the text came into
 * it, but I can't press the button any more because it will start typing" —
 * the stored key prints a character, and the same guard refused it inside the
 * box dictation had just focused: the key worked exactly once per page.
 *
 * So the rule is now the plain one: the bound key is the hotkey wherever the
 * caret is, and it never types — not on the press, not on the repeats a held
 * key sends. Which keys may be bound is decided in pushToTalk.ts (a writing
 * key cannot), and tested there.
 */
function press(code: string, key: string, target?: EventTarget, repeat = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, repeat });
  if (target) Object.defineProperty(event, "target", { value: target });
  window.dispatchEvent(event);
  return event;
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

  it("a key that prints a character is the hotkey inside the composer too, and types nothing — press or repeat", () => {
    /*
     * The 2026-09-06 report. NumpadDecimal prints «.»; held inside the box
     * dictation just focused, it has to start the microphone once and put
     * no dot in the box — on the first keydown or on any of the repeats a
     * held key sends. Verified red twice: with the old typing guard the press
     * was refused; with the repeat guard ahead of preventDefault, the repeats
     * typed.
     */
    setPushToTalkKey("NumpadDecimal");
    const onPress = vi.fn();
    renderHook(() => usePushToTalk({ onPress, onRelease: vi.fn() }));
    const box = fieldWithCaret();

    const first = press("NumpadDecimal", ".", box);
    expect(onPress, "the hotkey was refused because a text box had focus").toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented, "the press typed its character").toBe(true);

    const again = press("NumpadDecimal", ".", box, true);
    expect(onPress, "a repeat started dictation again").toHaveBeenCalledTimes(1);
    expect(again.defaultPrevented, "a repeat typed its character").toBe(true);

    /* and a key that is NOT the hotkey is left alone in the same box */
    const other = press("KeyS", "س", box);
    expect(other.defaultPrevented).toBe(false);
    act(() => release("NumpadDecimal", "."));
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


describe("one key, one microphone (2026-09-05)", () => {
  it("the HIGHEST-ranked surface answers; the others stay silent", () => {
    /*
     * Three surfaces offer the key and each used to listen on its own, so on
     * the assistant page a press started the page's recogniser AND the
     * strip's (its hooks run while it is invisible there), and in a room the
     * composer's and the strip's fought for the one microphone Chrome allows.
     */
    setPushToTalkKey("F9");
    const strip = { onPress: vi.fn(), onRelease: vi.fn() };
    const page = { onPress: vi.fn(), onRelease: vi.fn() };
    const a = renderHook(() => usePushToTalk({ ...strip, priority: 0 }));
    const b = renderHook(() => usePushToTalk({ ...page, priority: 2 }));
    act(() => press("F9", "F9"));
    expect(page.onPress).toHaveBeenCalledTimes(1);
    expect(strip.onPress, "two surfaces opened two microphones").not.toHaveBeenCalled();
    act(() => release("F9", "F9"));
    expect(page.onRelease).toHaveBeenCalledTimes(1);
    expect(strip.onRelease).not.toHaveBeenCalled();
    a.unmount();
    b.unmount();
  });

  it("a surface that is not on screen offers nothing, whatever its rank", () => {
    setPushToTalkKey("F9");
    const hidden = { onPress: vi.fn(), onRelease: vi.fn() };
    const shown = { onPress: vi.fn(), onRelease: vi.fn() };
    const a = renderHook(() => usePushToTalk({ ...hidden, priority: 5, enabled: false }));
    const b = renderHook(() => usePushToTalk({ ...shown, priority: 0 }));
    act(() => press("F9", "F9"));
    act(() => release("F9", "F9"));
    expect(hidden.onPress).not.toHaveBeenCalled();
    expect(shown.onPress).toHaveBeenCalledTimes(1);
    expect(shown.onRelease).toHaveBeenCalledTimes(1);
    a.unmount();
    b.unmount();
  });

  it("losing the window releases a held key — an alt-tab does not leave the microphone open", () => {
    setPushToTalkKey("F9");
    const h = { onPress: vi.fn(), onRelease: vi.fn() };
    const a = renderHook(() => usePushToTalk(h));
    act(() => press("F9", "F9"));
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(h.onRelease).toHaveBeenCalledTimes(1);
    act(() => release("F9", "F9"));
    expect(h.onRelease, "the keyup after the blur released a second time").toHaveBeenCalledTimes(1);
    a.unmount();
  });

  it("the answering surface unmounting under the finger releases", () => {
    setPushToTalkKey("F9");
    const h = { onPress: vi.fn(), onRelease: vi.fn() };
    const a = renderHook(() => usePushToTalk(h));
    act(() => press("F9", "F9"));
    a.unmount();
    expect(h.onRelease).toHaveBeenCalledTimes(1);
  });
});
