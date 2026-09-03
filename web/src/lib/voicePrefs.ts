/**
 * The assistant's two voice switches, in one place.
 *
 * USER DIRECTIVE, 2026-09-03: "remove the items in side bar menu and put them
 * into the setting in assistant section". The mic and the speaker were per-
 * message controls under the composer; they are PREFERENCES, and preferences
 * belong on the settings screen — the panel you are having a conversation in
 * is not a place to configure the thing having it, which is the same argument
 * that moved the reply language there in the first place.
 *
 * WHY A STORE AND NOT TWO `localStorage` READS. The sidebar read these keys
 * once on mount. Moving the controls to Settings without this would produce
 * the defect this repo has already recorded once, in the calendar preference:
 * the switch moves, the value is written, and nothing on screen changes until
 * a reload — a control that reads as wired and does nothing. The sidebar
 * subscribes now, so a toggle in Settings reaches the panel on the next paint.
 *
 * Deliberately still per-DEVICE. "Do not listen to me on this machine" is a
 * fact about the machine — a shared laptop in a meeting room, a desk with a
 * dead microphone — and syncing it to the account would carry one room's
 * decision to every other. Every other preference on that screen is
 * server-stored, and these two are the exceptions with a reason.
 */

const EARS_KEY = "neurai-voice-ears";
const SILENT_KEY = "neurai-voice-silent";

export interface VoicePrefs {
  /** the assistant may LISTEN (wake word and capture). Default on. */
  ears: boolean;
  /** the assistant does NOT speak its replies. Default off. */
  silent: boolean;
}

/**
 * The defaults, as ONE object rather than an expression — and the snapshot
 * below keeps an identity that changes only when a value does.
 *
 * `useSyncExternalStore` compares snapshots by reference and calls the SERVER
 * one on every render, so a function returning a fresh literal is an infinite
 * loop rather than a subtle bug. React says so out loud — "the result of
 * getServerSnapshot should be cached" — which is how this was found: in the
 * browser console, with the whole suite green, because the test that pinned
 * snapshot identity pinned it for the CLIENT read and never asked the same
 * question of the server one.
 */
const DEFAULTS: VoicePrefs = Object.freeze({ ears: true, silent: false });

let current: VoicePrefs = DEFAULTS;
let hydrated = false;

const listeners = new Set<() => void>();

function read(): VoicePrefs {
  try {
    return {
      ears: localStorage.getItem(EARS_KEY) !== "0",
      silent: localStorage.getItem(SILENT_KEY) === "1",
    };
  } catch {
    /* storage throws outright under some privacy settings, and in a preview
       thumbnailer. The defaults are the safe pair: the assistant listens and
       speaks, which is what it does with no preference stored at all. */
    return DEFAULTS;
  }
}

/**
 * The snapshot for `useSyncExternalStore`.
 *
 * Hydration is LAZY rather than at module load: this module is imported by
 * components the server renders, and touching `localStorage` at import time
 * throws there. The first browser read fills it in.
 */
export function voicePrefs(): VoicePrefs {
  if (!hydrated && typeof window !== "undefined") {
    current = read();
    hydrated = true;
  }
  return current;
}

/** The server's snapshot: the defaults, and never a storage read. */
export function voicePrefsServer(): VoicePrefs {
  return DEFAULTS;
}

export function subscribeVoicePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Write one switch and tell everyone. Returns the new value. */
export function setVoicePref<K extends keyof VoicePrefs>(key: K, value: boolean): boolean {
  const next = { ...voicePrefs(), [key]: value };
  /* the identity changes only when something did — a no-op set must not
     re-render every subscriber */
  if (next.ears === current.ears && next.silent === current.silent) return value;
  current = next;
  hydrated = true;
  try {
    localStorage.setItem(key === "ears" ? EARS_KEY : SILENT_KEY, value ? "1" : "0");
  } catch { /* the preference does not persist; this session still honours it */ }
  for (const listener of listeners) listener();
  return value;
}

/** Test seam: forget what was read, so a suite can change storage and re-read. */
export function resetVoicePrefsForTest(): void {
  hydrated = false;
  current = DEFAULTS;
}
