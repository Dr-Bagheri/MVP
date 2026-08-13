"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * How a page tells the breadcrumb what it is called.
 *
 * **One source for one title.** The top bar could fetch the call itself, and
 * that is the tempting shape because it keeps the bar self-contained. It would
 * also be a second fetch of the same row — two sources for one title, which
 * disagree for exactly as long as one of them is still loading. The page
 * already has the data; it passes it up.
 *
 * **Three states, not two.** The obvious type is `string | null`, and it
 * collapses two different nothings:
 *
 *   `undefined` — not loaded yet. The leaf is OMITTED: the trail is briefly
 *                 shorter, never wrong. Showing the id here would be a
 *                 placeholder that reads as data, and an empty crumb would
 *                 silently drop the trail's last step with no way to tell
 *                 whether the page has no title or the crumb broke.
 *   `null`      — loaded, and the thing genuinely has no title. That is a FACT
 *                 about the call, and it renders as its own word rather than
 *                 as a blank.
 *   `string`    — the title.
 *
 * Collapsing those two makes the loading window indistinguishable from a real
 * untitled call, which is the family of bug this codebase keeps finding: a
 * legitimate value absorbing an absence and reporting success.
 */
type CrumbTitle = string | null | undefined;

/**
 * **`null` is the no-provider sentinel, and that is the whole point.**
 *
 * The first version defaulted to `{ title: undefined, setTitle: () => {} }`,
 * and the no-op setter cost a real bug: `/calls/[id]` calls `useCrumbTitle`
 * and then RENDERS the shell, so the page is the provider's parent, not its
 * child. The write went to the default context and vanished. Both sides looked
 * correct from where they stood — the page had published a title, the bar had
 * never been told one — which is the silent-absence shape this codebase keeps
 * finding.
 *
 * A default that swallows writes makes "no provider above me" indistinguishable
 * from "nobody set a title". So there is no default: using either hook outside
 * a provider is a broken tree and says so.
 */
const CrumbTitleContext = createContext<{
  title: CrumbTitle;
  setTitle: (title: CrumbTitle) => void;
} | null>(null);

function useCrumbTitleContext() {
  const context = useContext(CrumbTitleContext);
  if (context === null) {
    throw new Error(
      "CrumbTitle used outside CrumbTitleProvider — the provider must be an " +
        "ancestor of the PAGE, not rendered by it (see [locale]/layout.tsx).",
    );
  }
  return context;
}

export function CrumbTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<CrumbTitle>(undefined);
  return (
    <CrumbTitleContext.Provider value={{ title, setTitle }}>{children}</CrumbTitleContext.Provider>
  );
}

/** Read by the breadcrumb. Pages use `useCrumbTitle`. */
export function useCrumbTitleValue(): CrumbTitle {
  return useCrumbTitleContext().title;
}

/**
 * Called by a page that owns an entity crumb.
 *
 * The cleanup matters more than it looks: without it, navigating from one call
 * to another shows the PREVIOUS call's title until the new fetch lands — a
 * crumb that is confidently, briefly wrong, which is worse than a crumb that
 * is briefly absent.
 */
export function useCrumbTitle(title: CrumbTitle): void {
  const { setTitle } = useCrumbTitleContext();
  useEffect(() => {
    setTitle(title);
    return () => setTitle(undefined);
  }, [title, setTitle]);
}
