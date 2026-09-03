import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetVoicePrefsForTest, setVoicePref, subscribeVoicePrefs, voicePrefs, voicePrefsServer,
} from "./voicePrefs";

/**
 * The two voice switches moved to Settings·Assistant, and the panel that obeys
 * them is somewhere else entirely.
 *
 * That gap is the whole reason this store exists, and it is the shape of a
 * defect this repo has already shipped once: the calendar preference changed
 * its store and changed NOTHING on screen, because nothing subscribed — and
 * every unit test passed, since they called the formatter after setting the
 * value and never rendered anything. A control that reads as wired and does
 * nothing is only visible from outside the component that owns it.
 *
 * So the assertions here are about the SUBSCRIPTION, not about the value: that
 * a write reaches a listener, that a no-op write does not, and that the
 * identity is stable — because `useSyncExternalStore` compares snapshots by
 * reference, and a fresh object per read is an infinite render loop rather
 * than a subtle bug.
 */
beforeEach(() => {
  localStorage.clear();
  resetVoicePrefsForTest();
});

describe("the voice preference store", () => {
  it("defaults to listening and speaking", () => {
    /* the pair somebody gets with no preference stored at all — and the same
       pair the server snapshot returns, so the first paint does not disagree
       with the markup that was sent */
    expect(voicePrefs()).toEqual({ ears: true, silent: false });
    expect(voicePrefsServer()).toEqual({ ears: true, silent: false });
  });

  it("hydrates from storage on first read, not at import", () => {
    /* lazy on purpose: this module is imported by components the server
       renders, and touching localStorage at import time throws there */
    localStorage.setItem("neurai-voice-ears", "0");
    localStorage.setItem("neurai-voice-silent", "1");
    resetVoicePrefsForTest();
    expect(voicePrefs()).toEqual({ ears: false, silent: true });
  });

  it("tells a subscriber when a value changes", () => {
    const listener = vi.fn();
    const stop = subscribeVoicePrefs(listener);
    setVoicePref("ears", false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(voicePrefs().ears).toBe(false);
    stop();
    setVoicePref("ears", true);
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it("says NOTHING when the value did not change — the control", () => {
    /*
     * Without this the store could notify on every set and every assertion
     * above would still pass. It matters in the product: the settings screen
     * re-renders its switches from this snapshot, so a notify-always store
     * turns one click into a render loop through `useSyncExternalStore`.
     */
    const listener = vi.fn();
    subscribeVoicePrefs(listener);
    setVoicePref("silent", false); // already false
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps one snapshot identity until something actually moves", () => {
    /* the useSyncExternalStore contract: two reads with no write between them
       must be the SAME object, or React re-renders forever */
    const first = voicePrefs();
    expect(voicePrefs()).toBe(first);
    setVoicePref("silent", true);
    expect(voicePrefs()).not.toBe(first);
  });

  it("the SERVER snapshot is one object too — the half this file missed", () => {
    /*
     * Found in the browser console with this whole file green: React warned
     * "the result of getServerSnapshot should be cached to avoid an infinite
     * loop", because that function returned a fresh literal on every render.
     * The test above asked the identity question of the client read and never
     * asked it of the server read — the same question, one function over,
     * which is the shape of most of the holes in this repo's instruments.
     */
    expect(voicePrefsServer()).toBe(voicePrefsServer());
    /* and it is the pair a first paint must agree with, so the markup the
       server sent and the markup the browser draws do not disagree */
    expect(voicePrefsServer()).toEqual({ ears: true, silent: false });
  });

  it("persists, so the choice survives the next load", () => {
    setVoicePref("ears", false);
    expect(localStorage.getItem("neurai-voice-ears")).toBe("0");
    setVoicePref("silent", true);
    expect(localStorage.getItem("neurai-voice-silent")).toBe("1");
  });

  it("still honours the choice for this session when storage refuses", () => {
    /* privacy settings and preview thumbnailers make the setter throw. The
       preference not persisting is a small loss; the switch appearing not to
       work is the defect this whole file is about. */
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => { throw new Error("denied"); });
    const listener = vi.fn();
    subscribeVoicePrefs(listener);
    expect(() => setVoicePref("ears", false)).not.toThrow();
    expect(voicePrefs().ears).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });
});
