"use client";

import { useEffect, useRef } from "react";
import { pushToTalkKey } from "./pushToTalk";

/**
 * HOLD THE KEY, THE MIC LISTENS; LET GO, IT STOPS (user directive, 2026-09-04:
 * "the key that I want it to be the hotkey for in the setting is the mic in
 * the AI assistant page — make it for both AI assistant page and side bar";
 * 2026-09-05: "make it push to talk mode, not push to activate — you need to
 * hold it while you are talking").
 *
 * The first version drove the sidebar's WAKE-WORD LOOP, which was the wrong
 * mic. That loop is an always-on listener waiting to be addressed by name; the
 * mic the directive points at is the composer's, which dictates what you say
 * into the box you are looking at. They are different features that both use a
 * microphone, and the hold gesture belongs to the second.
 *
 * ── ONE KEY, ONE MICROPHONE ───────────────────────────────────────────────
 *
 * Three surfaces offer the key — the assistant page, a room's composer, and
 * the assistant strip, which is mounted on every page. Each had its own pair
 * of window listeners, so on the assistant page a press started TWO
 * recognisers (the page's and the strip's — the strip is invisible there and
 * its hooks still run), and in a room the composer's and the strip's fought
 * for the one microphone Chrome allows. Now the surfaces REGISTER, one pair
 * of listeners is installed for all of them, and the highest-ranked surface
 * on screen answers the key: the page (2) over a room's composer (1) over the
 * strip (0), and a surface that is not on screen offers nothing (`enabled`).
 *
 * ── THE GUARDS ────────────────────────────────────────────────────────────
 *
 *  · NOTHING until a key is chosen. An unbound hotkey must not guess at a
 *    default and quietly take a key away from the browser.
 *  · `event.code`, the PHYSICAL key, matching what was stored: the same key
 *    yields a different character on a Persian layout, and a hotkey that stops
 *    working when you switch input language is one nobody trusts.
 *  · a CHARACTER key pressed while TYPING is a character. Somebody writing
 *    «سلام» into any field must not open a microphone because their hotkey
 *    is a letter — while F9 and the like work from inside the composer, which
 *    is exactly where dictation writes (user report, 2026-09-04).
 *  · `event.repeat` — holding a key fires keydown continuously.
 *  · the RELEASE is unconditional once a press was answered: a keyup with the
 *    caret anywhere, a window blur (alt-tab under the finger), the answering
 *    surface unmounting — every one of them stops the microphone, because the
 *    failure a person notices last is a microphone left open.
 */
type Handlers = { onPress: () => void; onRelease: () => void };
type Surface = { priority: number; handlers: { readonly current: Handlers } };

const surfaces: Surface[] = [];
let holding: Surface | null = null;
let installed = false;

/** the highest rank on screen; among equals, the one mounted last */
function answering(): Surface | null {
  let best: Surface | null = null;
  for (const surface of surfaces) {
    if (best === null || surface.priority >= best.priority) best = surface;
  }
  return best;
}

const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement
  && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

function down(event: KeyboardEvent): void {
  const hotkey = pushToTalkKey();
  if (hotkey === null || event.code !== hotkey || event.repeat || holding !== null) return;
  if (typing(event.target) && event.key.length === 1) return;
  const surface = answering();
  if (surface === null) return;
  event.preventDefault();
  holding = surface;
  surface.handlers.current.onPress();
}

function release(): void {
  const held = holding;
  holding = null;
  held?.handlers.current.onRelease();
}

function up(event: KeyboardEvent): void {
  if (holding === null) return;
  const hotkey = pushToTalkKey();
  /* a key cleared mid-hold still releases: `null` matches nothing, and a hold
     that could never end is the worst state this file can produce */
  if (hotkey !== null && event.code !== hotkey) return;
  release();
}

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", release);
}

function uninstall(): void {
  if (!installed) return;
  installed = false;
  window.removeEventListener("keydown", down);
  window.removeEventListener("keyup", up);
  window.removeEventListener("blur", release);
}

export function usePushToTalk(handlers: Handlers & {
  /** the page's own mic 2, a room's composer 1, the strip 0 */
  priority?: number;
  /** false while the surface is not on screen — it then offers nothing */
  enabled?: boolean;
}): void {
  /* through a ref: the handlers close over component state that changes on
     every keystroke, and re-registering per render would drop a keyup between
     the removal and the add — the release lost, the mic left open */
  const ref = useRef<Handlers>(handlers);
  ref.current = handlers;
  const { priority = 0, enabled = true } = handlers;

  useEffect(() => {
    if (!enabled) return;
    const surface: Surface = { priority, handlers: ref };
    surfaces.push(surface);
    install();
    return () => {
      const at = surfaces.indexOf(surface);
      if (at >= 0) surfaces.splice(at, 1);
      /* this surface going away under the finger — a navigation mid-hold —
         releases, so a microphone is never left open by leaving the page */
      if (holding === surface) release();
      if (surfaces.length === 0) uninstall();
    };
  }, [priority, enabled]);
}
