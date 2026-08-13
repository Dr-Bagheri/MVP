"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, readStoredTheme, subscribeTheme, type Theme } from "./theme";

/**
 * The theme as REACT state, shared by every control that offers it.
 *
 * The theme has two homes — Settings · General and the avatar menu (user
 * directive) — and the directive names the rule: one control, two homes, never
 * two states. Two `useState`s reading the same key drift the moment one is on
 * screen while the other changes it, and the stale one then writes its stale
 * value back.
 *
 * **Separate from `theme.ts` because that module is imported by the server
 * layout** (it builds the pre-paint script). A hook there breaks the build of
 * every route — and does it invisibly to the typechecker and the test suite,
 * neither of which starts the app.
 *
 * The server snapshot is the default, so the first client render matches the
 * server's. Nothing flashes while React catches up: the pre-paint script has
 * already applied the real theme to the document.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, readStoredTheme, () => DEFAULT_THEME);
}
