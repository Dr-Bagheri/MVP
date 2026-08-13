"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { hydratePreferences } from "@/lib/preferences";
import { readStoredTheme } from "@/lib/theme";
import { useCalendarPreference, useTimezonePreference } from "@/lib/usePreferences";
import { BottomBar } from "./BottomBar";
import { IconRail } from "./IconRail";
import { TopBar } from "./TopBar";

/**
 * The NeurAI platform shell (M22): icon rail at inline-start, top bar, and the
 * mobile bottom bar. Apps render into `children`; the shell draws nothing
 * inside that slot.
 *
 * **M22's law, and the reason this component does not render an assistant:**
 *
 *   > the app must be reachable on load, at every width, without dismissing
 *   > anything.
 *
 * That law was earned. An earlier shell rendered the assistant as a flex
 * sibling of `main`, which squeezed content to 40px at 375; the fix made it a
 * `fixed inset-0` overlay that defaulted to OPEN, so every metric improved
 * (main went full width, nothing overflowed) while the app became unreachable
 * behind an opaque layer. Both states passed every box measurement.
 *
 * So the assistant is not the shell's to place:
 *   - **on the hub, the assistant IS the page** — there is nothing to overlay,
 *     and a pane here would cover a screen that is already the assistant;
 *   - **inside an app**, the app owns its docked pane / bottom sheet, opened by
 *     a deliberate affordance and never on load.
 *
 * A shell that renders an assistant on every route cannot honour that
 * distinction, which is exactly how the 40px bug happened.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const calendar = useCalendarPreference();
  const timezone = useTimezonePreference();

  useEffect(() => {
    void api.me().then((identity) => {
      setMe(identity);
      /*
       * Display preferences come WITH identity — they are fields on the same
       * response, not a second fetch. Hydrating here rather than in the menu
       * means every date on every screen honours them whether or not the
       * person ever opens the menu.
       *
       * Guarded because "no identity" is a real state (signed out, or a
       * response this shell could not read), and it is NOT the same as "their
       * preferences are the defaults". Without the guard the shell throws
       * inside a promise and the failure surfaces as an unhandled rejection
       * somewhere else entirely — vitest caught exactly that.
       */
      if (identity) hydratePreferences(identity);
    });
  }, []);

  useEffect(() => {
    /*
     * Dark is the platform's primary and therefore the default — the reverse of
     * the Echo system, where light was primary and dark derived. A first-time
     * visitor with no stored preference gets dark on purpose (M22), so the
     * fallback is "dark", not the browser's guess.
     *
     * No local state for it: the theme lives on the document element, the
     * toggle lives in Settings (M22's rail bottom is Settings · Help · GitHub —
     * no theme control), and holding a second copy here would be a second
     * source of truth for something the DOM already owns.
     */
    document.documentElement.dataset.theme = readStoredTheme();
  }, []);

  return (
    /*
     * `CrumbTitleProvider` is deliberately NOT here — it lives in
     * `[locale]/layout.tsx`, above every page.
     *
     * It was here, and it could not work: a page calls `useCrumbTitle` and then
     * RENDERS this shell, so the page is the provider's parent. The write went
     * to a context nothing read, silently, while both halves looked right from
     * where they stood. A provider has to be an ancestor of whoever writes to
     * it, and the only thing above every page is the layout.
     */
    <>
      <div className="flex h-dvh bg-bg text-fg">
        <IconRail />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* the whole person, not an initial: the avatar menu's identity
              header needs the name and email, and resolving the initial here
              would have left the menu re-fetching what the shell already has */}
          <TopBar me={me} />
          {/*
            **The key is load-bearing, not a tidiness flourish.**

            `formatDate` reads the calendar and timezone preferences directly,
            which is what lets every existing date on the product honour them
            without a signature change. But a store nothing subscribes to does
            not re-render anything: changing the calendar in the avatar menu
            updated the stored value and left every date on screen exactly as
            it was — a setting that reads as wired and does nothing until the
            next navigation. Caught only by measuring a rendered date rather
            than the store.

            Re-rendering the shell is not enough either: `children` is the same
            element reference, so React bails out of that subtree. Changing the
            key REMOUNTS it, which is the one thing that reliably re-runs the
            formatting.

            The cost is a remount of the current page, and it is paid only when
            someone deliberately changes a display preference — where a redraw
            is exactly what they asked for.
          */}
          <main key={`${calendar}|${timezone}`} className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </main>
          <BottomBar />
        </div>
      </div>
    </>
  );
}
