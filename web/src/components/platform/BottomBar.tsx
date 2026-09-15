"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { NAV_BAR, NAV_PRIMARY, NAV_UTILITY, activeNavHref } from "./nav";
import { EchoMark, MoreIcon, NAV_ICON } from "./icons";

/**
 * The mobile shell (M22): four items — the bar's primaries plus **More**.
 *
 * A horizontal bar rather than a drawer, for a reason that is specifically
 * Persian-first: **item order follows `dir` for free.** A drawer must choose a
 * side and mirror it, and the shell has already gone wrong there once.
 *
 * Bar height is 56px with `env(safe-area-inset-bottom)` below it, so the iOS
 * home indicator does not eat the row. Each target clears 44px on its own,
 * without needing `.tap`.
 */
export function BottomBar() {
  const t = useTranslations("platform");
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  /* the SAME matcher the rail uses — two matchers for one nav is the
     drift nav.ts exists to prevent (see activeNavHref for the cross-homed
     Settings surfaces that made this a bug someone saw) */
  const activeHref = activeNavHref(pathname);
  const isActive = (href: string) => href === activeHref;

  return (
    <>
      {moreOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMoreOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("more")}
            /* R23, on the phone's own chrome (2026-09-08). This sheet wore
               `border-t border-border bg-surface` — the opaque panel with a
               rule along its lip, which is the picture the directive named.
               `glass-solid` is the sheet's tone at FULL opacity: this one
               rises over its own scrim, and translucency there stops reading
               as glass and starts reading as the darkened page bleeding up
               through the labels (every panel over a scrim is opaque). The
               corner stays — a sheet that slides
               up from the window's edge is not a pane join. */
            className="glass-solid fixed inset-x-0 bottom-0 z-50 rounded-t-2xl p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" aria-hidden />
            {/* every non-bar destination, not just the utility group — a rail
                entry the More sheet omits is unreachable on a phone */}
            {[...NAV_PRIMARY.filter((i) => !i.inBar), ...NAV_UTILITY].map((nav) => {
              const Icon = NAV_ICON[nav.key];
              const external = nav.href.startsWith("http") || nav.href === "#";
              const inner = (
                <>
                  {Icon ? <Icon width={18} height={18} /> : null}
                  <span>{t(nav.key)}</span>
                </>
              );
              /* audit finding, 2026-09-02: these are the rail's own nav rows
                 rendered as a menu, so they take the menu row's 12px corner —
                 rounded-xl (16) is the list-tile radius, and wearing it made
                 the sheet read as a stack of tiles rather than a menu, the
                 same mistake IconRail's comment records at its own rows */
              const cls =
                "flex min-h-[48px] items-center gap-3 rounded-lg px-3 text-sm text-fg hover:bg-surface-2";
              return external ? (
                <a key={nav.key} href={nav.href} target="_blank" rel="noreferrer noopener" className={cls}>
                  {inner}
                </a>
              ) : (
                <Link key={nav.key} href={nav.href} className={cls} onClick={() => setMoreOpen(false)}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      <nav
        aria-label={t("primaryNav")}
        /*
         * THE PHONE'S CHROME IS A SHEET TOO (R23, 2026-09-08).
         *
         * `border-t border-border bg-surface` stood here after the sweep took
         * the same three classes off the rail, the top bar and every card —
         * so the one surface a phone always has on screen was the last opaque
         * pane in the product, with the one hairline left drawing the app as a
         * stack of panes. It is the rail's counterpart below `md` and it wears
         * the rail's own class: one spelling of "the chrome's colour", which
         * is the only form in which the bar and the rail cannot come to
         * disagree about it.
         *
         * The safe-area padding stays: the sheet is translucent, not absent,
         * and the iOS home indicator still sits under it.
         */
        className="glass-chrome flex pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV_BAR.map((nav) => {
          const Icon = NAV_ICON[nav.key];
          const active = isActive(nav.href);
          return (
            <Link
              key={nav.key}
              href={nav.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-center text-[11px] leading-control transition-colors ${
                active ? "text-accent" : "text-fg-muted"
              }`}
            >
              {nav.key === "echo" ? <EchoMark size={20} /> : Icon ? <Icon width={18} height={18} /> : null}
              <span>{t(nav.key)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-center text-[11px] leading-control text-fg-muted"
        >
          <MoreIcon width={19} height={19} />
          <span>{t("more")}</span>
        </button>
      </nav>
    </>
  );
}
