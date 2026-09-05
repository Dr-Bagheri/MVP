/**
 * THE MENU'S WIDTH, remembered per browser — and answered BEFORE the first
 * paint of every mount (user directive, 2026-09-05: "make the closed version
 * of the main menu the default in both versions … when I change from one
 * section to another it comes out and closes again — fix this bug").
 *
 * ── WHY A STORE AND NOT `useState` + an effect ────────────────────────────
 *
 * `PlatformShell` is rendered by each PAGE, so the rail remounts on every
 * navigation. The first version held the width in `useState(false)` and read
 * the stored choice in an effect: every remount painted the menu OPEN, then
 * the effect closed it — a 240px menu flashing onto the screen and sliding
 * shut on every click from one section to the next. A store answers
 * synchronously, from the first render, so the menu is the width it was left
 * at from the first frame of every page.
 *
 * ── THE DEFAULT IS COMPACT ────────────────────────────────────────────────
 *
 * Both locales, both directions. The server snapshot says compact too, so the
 * markup the server sent and the first client paint agree for everybody who
 * never touched the toggle; the one person who opened it sees the client's
 * snapshot win right after hydration, which React handles without a mismatch.
 *
 * Per device, like the push-to-talk key: a menu width is a fact about the
 * screen in front of you.
 */

const KEY = "neurai-rail-compact";

let current: boolean | null = null;   // null = not read yet
const listeners = new Set<() => void>();

export function railCompact(): boolean {
  if (current === null) {
    try {
      /* "0" is the one stored value that means OPEN; anything else — "1",
         nothing, storage refusing to answer — is the default */
      current = localStorage.getItem(KEY) !== "0";
    } catch {
      current = true;
    }
  }
  return current;
}

/** the server has no storage and no hand on the toggle: compact */
export function railCompactServer(): boolean {
  return true;
}

export function subscribeRailCompact(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setRailCompact(next: boolean): void {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* this session still honours it */ }
  for (const listener of listeners) listener();
}

/** test seam: forget the choice — memory AND storage */
export function resetRailCompactForTest(): void {
  current = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing stored to forget */ }
  for (const listener of listeners) listener();
}
