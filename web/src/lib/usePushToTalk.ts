"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { pushToTalkKey, pushToTalkServer, subscribePushToTalk } from "./pushToTalk";

/**
 * HOLD THE KEY, THE MIC LISTENS (user directive, 2026-09-04: "the key that I
 * want it to be the hotkey for in the setting is the mic in the AI assistant
 * page — make it for both AI assistant page and side bar").
 *
 * The first version drove the sidebar's WAKE-WORD LOOP, which was the wrong
 * mic. That loop is an always-on listener waiting to be addressed by name; the
 * mic the directive points at is the composer's, which dictates what you say
 * into the box you are looking at. They are different features that both use a
 * microphone, and the hold gesture belongs to the second: a key you press to
 * talk and release to stop is a dictation control, not a wake word.
 *
 * One hook so the two surfaces cannot drift. The panel had no mic at all until
 * this, so "make it for both" was really "give the sidebar the page's mic" —
 * and a hotkey whose effect no visible control offers is a hidden feature, so
 * the sidebar gets the button too.
 *
 * ── THE GUARDS ────────────────────────────────────────────────────────────
 *
 *  · NOTHING until a key is chosen. An unbound hotkey must not guess at a
 *    default and quietly take a key away from the browser.
 *  · `event.code`, the PHYSICAL key, matching what was stored: the same key
 *    yields a different character on a Persian layout, and a hotkey that stops
 *    working when you switch input language is one nobody trusts.
 *  · a key pressed while TYPING is a character. Somebody writing «سلام» into
 *    any field must not open a microphone because their hotkey is a letter.
 *  · `event.repeat` — holding a key fires keydown continuously, and starting
 *    dictation forty times a second is a stream of requests nobody asked for.
 *
 * The RELEASE ignores the typing guard on purpose: if focus moved into a field
 * while the key was down, the right behaviour is still to stop listening, and
 * an unmatched release is a no-op.
 */
export function usePushToTalk(handlers: {
  onPress: () => void;
  onRelease: () => void;
}): void {
  const hotkey = useSyncExternalStore(subscribePushToTalk, pushToTalkKey, pushToTalkServer);
  /* through a ref: the handlers close over component state that changes on
     every keystroke, and re-binding the listener per render would drop a
     keyup between the removal and the add — the release lost, the mic left
     open, which is the failure a person notices last */
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (hotkey === null) return;
    let holding = false;
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement
      && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

    function down(event: KeyboardEvent) {
      if (event.code !== hotkey || event.repeat || holding) return;
      if (typing(event.target)) return;
      event.preventDefault();
      holding = true;
      ref.current.onPress();
    }
    function up(event: KeyboardEvent) {
      if (event.code !== hotkey || !holding) return;
      holding = false;
      ref.current.onRelease();
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      /* the window may lose the keyup entirely — alt-tab away mid-hold, or
         this surface unmounting under the finger. Releasing on teardown is
         what stops a microphone being left open by a navigation. */
      if (holding) ref.current.onRelease();
    };
  }, [hotkey]);
}
