/**
 * The theme store — ONE key, ONE default, and the pre-paint script built from
 * the same two constants everything else reads.
 *
 * **What went wrong without this file.** There were two stores for one
 * document. The pre-paint script in `[locale]/layout.tsx` read `echo-theme`
 * and defaulted to `"light"`; `PlatformShell` and `GeneralSettings` read
 * `neurai-theme` and defaulted to `"dark"`. So a first-time visitor was
 * painted LIGHT before hydration and flipped to DARK a moment later — the
 * exact flash the script exists to prevent, produced by the script itself.
 * Worse, the toggle in Settings wrote a key the pre-paint script never read,
 * so a returning user's stored choice lost every first paint and won it back
 * on hydration.
 *
 * The comment above that script said "theme applied before paint so dark never
 * flashes light" — it described the intent correctly and the code did the
 * opposite. A comment cannot disagree with a constant it is built from, which
 * is why the script is generated here rather than written out as a string
 * beside the components that have to agree with it.
 *
 * LIGHT is the default (user directive, 2026-08-31, with the Arameet
 * adoption): the reference's primary look is its light theme — warm cream,
 * white cards, green ink — and the dark palette is its counterpart. This
 * reverses M22's dark-first ruling together with the palette that carried
 * it. One store, one document, one opinion about its own theme;
 * changing the product default is changing `DEFAULT_THEME`, here, once.
 */

/*
 * **This module stays free of React**, and that is a constraint rather than a
 * style choice: the server layout imports `themeBootScript()`, so a hook
 * imported here makes every route fail to build. It did — typecheck and the
 * whole suite stayed green while the app 500'd, because neither starts the
 * production build. The React half lives in `useTheme.ts`, which is a client
 * module and imports this one.
 */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "neurai-theme";
export const DEFAULT_THEME: Theme = "light";

/** Read the stored preference, falling back to the platform default. */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
  } catch {
    // storage can throw outright under some privacy settings — a theme is
    // never worth breaking a render over
    return DEFAULT_THEME;
  }
}

const listeners = new Set<() => void>();

/** Persist the preference and apply it to the document in one place. */
export function storeTheme(next: Theme): void {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* preference simply does not persist; the applied theme still holds */
  }
  for (const listener of listeners) listener();
}

/** Subscribe to theme changes. Consumed by `useTheme.ts`. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The blocking `<head>` script, as source text. Interpolates only the two
 * constants above — no caller input reaches it.
 */
export function themeBootScript(): string {
  return `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'${DEFAULT_THEME}';}catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';}})();`;
}
