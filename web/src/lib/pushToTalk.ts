/**
 * THE PUSH-TO-TALK KEY (user directive, 2026-09-04: "add a hot key section in
 * the settings, in the assistant section, for the mic of the assistant — in
 * there you can choose a key for push and talk with the AI assistant, but
 * first you need to choose there what key you want it to be, so in there you
 * click and it asks you to press the key and after that it will record and
 * submit the first key you strike; it must have an option to change as well").
 *
 * ── WHY IT IS NOT A `VoicePrefs` FIELD ────────────────────────────────────
 *
 * `setVoicePref` takes a boolean, by signature, and every consumer of that
 * store reads two switches. Widening it to carry a string would make every
 * caller's type say "boolean or a key name", for one field, on a store whose
 * whole value is that it is small. This is its own module for the same reason
 * `liveConversation` is: one fact, one owner.
 *
 * ── PER DEVICE, DELIBERATELY ──────────────────────────────────────────────
 *
 * The same argument the ears and silence switches settled: a keyboard is a
 * fact about the machine in front of you. F9 may be a laptop's screen
 * brightness and a desktop's spare key, so syncing this to the account would
 * carry one room's decision to every other and disable a key somewhere it was
 * needed. Nothing here reaches the server.
 *
 * ── WHAT IS STORED ────────────────────────────────────────────────────────
 *
 * `KeyboardEvent.code` — the PHYSICAL key ("KeyQ", "Space", "F9"), not
 * `.key`, which is what the layout produces. On a Persian layout the same
 * physical key yields a different character, and a hotkey that stops working
 * when you switch input language is a hotkey nobody trusts. The cost is that
 * the label has to be humanised for display, which is `pushToTalkLabel`.
 *
 * `null` = no key chosen, which is the default and is NOT the same as a key
 * that failed to load: nothing is offered until a person picks one, because a
 * hotkey nobody chose is a key that stops doing what they expect it to do.
 */

const KEY = "neurai-push-to-talk";

/** Keys that may never be the hotkey — they would take the platform with them. */
const REFUSED = new Set([
  "Tab", "Enter", "NumpadEnter", "Escape", "Backspace", "Delete",
  /* modifiers alone: a bare Shift press would fire on every capital letter */
  "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock",
]);

export function isBindableKey(code: string): boolean {
  return code !== "" && !REFUSED.has(code);
}

let current: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

export function pushToTalkKey(): string | null {
  if (!hydrated && typeof window !== "undefined") {
    try {
      current = localStorage.getItem(KEY);
    } catch {
      /* storage can throw outright under some privacy settings — the cost is
         a hotkey that does not persist, which looks like never having set one */
      current = null;
    }
    hydrated = true;
  }
  return current;
}

/** The server has no keyboard. Frozen `null` rather than a fresh read. */
export function pushToTalkServer(): string | null {
  return null;
}

export function subscribePushToTalk(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** `null` clears the binding — "no hotkey" is an absence, not a special key. */
export function setPushToTalkKey(code: string | null): void {
  if (code !== null && !isBindableKey(code)) return;
  if (code === current && hydrated) return;   // a no-op must not wake anybody
  current = code;
  hydrated = true;
  try {
    if (code === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, code);
  } catch { /* this session still honours it */ }
  for (const listener of listeners) listener();
}

/**
 * What to SHOW for a stored code.
 *
 * `KeyQ` → `Q`, `Digit1` → `1`, `Space` → `Space`, `F9` → `F9`. Deliberately
 * not localised: these are the legends printed on the keys, and translating
 * "Space" into Persian would name something the keyboard does not say.
 */
export function pushToTalkLabel(code: string | null): string | null {
  if (code === null) return null;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
  if (code.startsWith("Arrow")) return code.slice(5);
  return code;
}

/** Test seam: forget the binding — memory AND storage. */
export function resetPushToTalkForTest(): void {
  current = null;
  hydrated = false;
  try { localStorage.removeItem(KEY); } catch { /* nothing stored to forget */ }
  for (const listener of listeners) listener();
}
