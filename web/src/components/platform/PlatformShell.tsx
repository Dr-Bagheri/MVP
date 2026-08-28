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
 * **M22's law, and the reason this component does not own an assistant:**
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
 * So the assistant is not the shell's to mount. PresenceDock stays global and
 * owns voice, conversation, notifications and the one accessible trigger.
 * The top bar exposes only an optional visual anchor for that trigger; without
 * the shell it falls back to its fixed corner. No pane opens on load.
 *
 * Keeping ownership outside the shell preserves that distinction and prevents
 * a visual placement change from repeating the 40px/opaque-overlay failure.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [platformRoot, setPlatformRoot] = useState(false);
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
    }).catch(() => {
      /* A root can intentionally arrive here while their own organization is
         suspended. The ordinary identity endpoint correctly refuses in that
         state; it must not turn the metadata-only recovery console into an
         unhandled shell error. */
      setMe(null);
    });
  }, []);

  useEffect(() => {
    /* M32 is deliberately a separate, caller-owned decision. `me.role` is an
       organization role and must never grow a magic global meaning. A failed
       read stays hidden rather than making the platform-control entry appear
       optimistically. */
    let live = true;
    const refreshPlatformRoot = () => {
      void api.platformAccess()
        .then(({ platform_root }) => {
          if (live) setPlatformRoot(platform_root);
        })
        .catch(() => {
          if (live) setPlatformRoot(false);
        });
    };
    refreshPlatformRoot();
    // The first claim happens inside this shell. A page-local result is not a
    // second source of truth for the navigation — it notifies the shell to
    // re-read the database-owned decision, then the newly available menu item
    // appears without requiring a reload.
    window.addEventListener("neurai:platform-root-changed", refreshPlatformRoot);
    return () => {
      live = false;
      window.removeEventListener("neurai:platform-root-changed", refreshPlatformRoot);
    };
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
          <TopBar me={me} isPlatformRoot={platformRoot} />
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

            SCROLL: `h-dvh` on the shell root plus this `min-h-0 flex-1`
            column is what keeps the DOCUMENT from ever scrolling — the rail
            and top bar stay put structurally, not by position:fixed. This
            `overflow-y-auto` is the scroller only for MENU-LESS surfaces; a
            menu-bearing surface renders MenuLayout, which is `md:h-full` and
            moves the scroll into its content column so the section menu
            holds still too (THE SHELL SCROLL, scaffold/SectionMenu.tsx).
          */}
          <main key={`${calendar}|${timezone}`} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            {children}
          </main>
          <BottomBar />
        </div>
      </div>
    </>
  );
}
