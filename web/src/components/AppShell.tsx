"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
/*
 * usePathname from `@/i18n/routing`, NOT from next/navigation: next-intl's
 * version returns the path WITHOUT the locale prefix. next/navigation returns
 * "/fa/calls", so `startsWith("/calls")` was false for every item and no nav
 * link has ever rendered as active. Invisible until the navy sidebar gave the
 * active state something to show.
 */
import { Link, usePathname } from "@/i18n/routing";
import { DEFAULT_THEME, readStoredTheme, storeTheme, type Theme } from "@/lib/theme";
import { AssistantPane } from "./AssistantPane";

const NAV = [
  { href: "/calls", key: "calls" },
  { href: "/capture", key: "capture" },
  { href: "/search", key: "search" },
  { href: "/skills", key: "skills" },
  { href: "/connectors", key: "connectors" },
  { href: "/admin", key: "admin" },
] as const;

export function AppShell({
  children,
  page,
  presetCallId,
}: {
  children: ReactNode;
  page: string;
  presetCallId?: string;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  /*
   * Starts CLOSED and opens itself only from md up.
   *
   * Making the pane an overlay below md fixed a 40px `main` — and replaced it
   * with something worse: `assistantOpen` defaulted to true, so the app
   * loaded onto an opaque full-screen assistant with the product behind it.
   * Every content control was unreachable until the user found «بستن».
   * Every measurement improved (main 40px → 375px, still no overflow) while
   * the thing the measurements stood in for — can a user reach the content —
   * went from barely to not at all.
   *
   * Deliberately narrow: this only stops the pane opening ON TOP of content
   * by default. It does NOT decide drawer vs sheet vs docked, which is the
   * mobile-nav proposal's call and is on hold.
   *
   * `false` initially rather than a viewport read during render: the server
   * has no viewport, and guessing open would flash the blocking pane on a
   * phone before the correction.
   */
  const [assistantOpen, setAssistantOpen] = useState(false);
  /*
   * ONE theme store for the document (src/lib/theme.ts). This shell used to
   * keep its own — key `echo-theme`, default `"light"` — while the platform
   * shell kept `neurai-theme` / `"dark"`, and the pre-paint script read the
   * first. Two stores for one `data-theme` attribute meant a stored preference
   * lost the first paint and won it back on hydration.
   *
   * Consequence worth naming: Echo's default is now DARK, because the platform
   * default is (M22) and Echo's screens render on the platform palette. That is
   * one constant, in one file, if it is ever ruled the other way.
   */
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    document.documentElement.dataset.theme = stored;
    // docked beside the content from md up; below that it would cover it
    setAssistantOpen(window.matchMedia("(min-width: 768px)").matches);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    storeTheme(next);
  }

  return (
    <div className="flex h-dvh bg-bg">
      {/* sidebar */}
      {/*
        Navy sidebar — the single highest-presence change in the verdict.
        It needs no RTL special-casing: `border-e` and the flex order resolve
        from `dir`, so the block sits right in fa and left in en on its own.
        Link colour is white/70 rather than a muted grey token because those
        tokens are tuned for the light page surface and would fail contrast
        on navy.
      */}
      <nav className="hidden w-56 shrink-0 flex-col gap-0.5 border-e border-border bg-sidebar p-3 md:flex">
        <Link href="/calls" className="mb-5 flex items-center gap-2 px-2 py-1">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-accent text-sm font-bold text-on-accent">
            E
          </span>
          <span className="text-lg font-bold text-sidebar-fg">
            {locale === "fa" ? "اکو" : "Echo"}
          </span>
        </Link>
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
                active
                  ? "bg-white/10 font-semibold text-sidebar-fg"
                  : "text-sidebar-fg/70 hover:bg-white/5 hover:text-sidebar-fg"
              }`}
            >
              {t(item.key)}
            </Link>
          );
        })}
        <div className="flex-1" />
        <Link
          href="/profile"
          className="rounded-md px-3 py-2 text-sm text-sidebar-fg/70 transition-colors duration-150 hover:bg-white/5 hover:text-sidebar-fg"
        >
          {t("profile")}
        </Link>
        <button
          className="rounded-md px-3 py-2 text-start text-sm text-sidebar-fg/70 transition-colors duration-150 hover:bg-white/5 hover:text-sidebar-fg"
          onClick={toggleTheme}
        >
          {t("theme")}: {theme === "light" ? "☀" : "☾"}
        </button>
      </nav>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-3">
          <div className="flex items-center gap-2 md:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-on-accent">
              E
            </span>
          </div>
          <div className="flex-1" />
          {!assistantOpen ? (
            <button className="btn-secondary h-9 min-h-0 px-3 text-xs" onClick={() => setAssistantOpen(true)}>
              {t("assistant")}
            </button>
          ) : null}
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>

      {/* dockable assistant — present on every screen */}
      <AssistantPane
        page={page}
        presetCallId={presetCallId}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
      />
    </div>
  );
}
