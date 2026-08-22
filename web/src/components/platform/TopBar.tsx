"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import type { User } from "@/api/types";
import { AvatarMenu } from "./AvatarMenu";
import { formatDate } from "@/lib/format";
import { useTimezonePreference } from "@/lib/usePreferences";
import { Breadcrumbs } from "./Breadcrumbs";
import { NotificationBell } from "./NotificationBell";
import { registerPresenceAnchor } from "./presenceAnchor";

/**
 * The platform top bar (M22): en/fa switcher · global search · avatar.
 *
 * Search moved here from the side menu by user directive — it is global, not a
 * destination among destinations.
 *
 * At 375 three controls plus breathing room do not fit, so the locale switcher
 * folds into the avatar menu (it is a set-once-a-year control) and search
 * collapses to its icon. Both are visible from `md` up.
 */
/**
 * Today's date and the current time, in the bar (user directive). The date
 * follows the CALENDAR preference through the same `formatDate` every other
 * date uses (one formatter, one truth); the time follows the timezone
 * preference. Rendered only after mount: the server has neither the
 * viewer's clock nor their preference, and a hydration mismatch here would
 * be a nightly flicker.
 */
function Clock() {
  const locale = useLocale();
  const timezone = useTimezonePreference();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const time = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timezone === "auto" ? {} : { timeZone: timezone }),
  }).format(now);
  return (
    /* boxed like its neighbours (user directive): the bar's controls all
       wear the same bordered pill, and the clock was the one bare element */
    <span className="hidden h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs text-fg-muted lg:flex">
      <span>{formatDate(now.toISOString(), locale)}</span>
      <span aria-hidden>·</span>
      <span>{time}</span>
    </span>
  );
}

export function TopBar({ me, isPlatformRoot = false }: { me: User | null; isPlatformRoot?: boolean }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const anchorCleanupRef = useRef<() => void>(() => undefined);
  const setPresenceAnchorRef = useCallback((node: HTMLDivElement | null) => {
    anchorCleanupRef.current();
    anchorCleanupRef.current = node ? registerPresenceAnchor(node) : () => undefined;
  }, []);
  useEffect(() => () => anchorCleanupRef.current(), []);
  /*
   * Switching locale re-renders the SAME route under the other prefix, so the
   * user stays where they were. Sending them home on a language change would
   * lose their place for a preference toggle.
   */
  const switchTo = (next: "fa" | "en") => router.replace(pathname, { locale: next });

  return (
    <header
      className="relative z-30 h-[100px] shrink-0 overflow-visible md:h-[124px]"
      data-platform-topbar
    >
      {/* Three real columns reserve the centre for the assistant. This keeps
          the glass cradle from becoming an invisible layer over breadcrumbs
          or the controls at the other end of the bar. */}
      <div className="relative z-20 grid h-14 grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] items-center border-b border-border bg-surface px-3 md:grid-cols-[minmax(0,1fr)_132px_minmax(0,1fr)] md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <AvatarMenu me={me} isPlatformRoot={isPlatformRoot} />

          {/* the trail takes the free space rather than a fixed slot: it is
              the only element here whose width is content, and it must be
              able to truncate rather than push the controls off the bar */}
          <Breadcrumbs />
        </div>

        <div aria-hidden />

        <div className="flex min-w-0 items-center justify-end gap-2">
          {/* Conversations moved UNDER the hub's prompt box (user directive,
              round 2) — the bar carries no twin of it. */}
          <Clock />

          {/* Search LEFT the top bar (user directive, 2026-08-18) — it lives
              in the left rail with the other destinations now. */}
          <div className="hidden overflow-hidden rounded-lg border border-border md:flex">
            {(["fa", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => switchTo(l)}
                aria-current={l === locale ? "true" : undefined}
                className={`h-9 px-3 text-xs transition-colors ${
                  l === locale
                    ? "bg-accent-soft font-semibold text-accent"
                    : "bg-surface text-fg-muted hover:text-fg"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* the notification menu — icon only, at the bar's end, beside the
              calendar/clock (user directive, 2026-08-21) */}
          {me !== null ? <NotificationBell /> : null}
        </div>
      </div>

      {/* The lower edge of the bar becomes one continuous curved cradle. It
          is SVG so the silhouette stays clean at every density and theme. */}
      <div
        className="pointer-events-none absolute left-1/2 top-[55px] z-10 h-[45px] w-[144px] -translate-x-1/2 md:h-[69px] md:w-[188px]"
        aria-hidden
        data-presence-curve
      >
        <svg viewBox="0 0 200 72" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <path
            d="M0 0 H38 C54 0 50 68 100 68 C150 68 146 0 162 0 H200 Z"
            style={{ fill: "rgb(var(--surface) / 0.94)" }}
          />
          <path
            d="M0 .5 H38 C54 .5 50 68 100 68 C150 68 146 .5 162 .5 H200"
            fill="none"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "rgb(var(--border))" }}
          />
        </svg>
      </div>

      {/* PresenceDock portals the ONE production assistant button here. The
          layers below are the optical glass; the live GPU particles, unread
          state, voice response and click target all remain owned by the dock. */}
      <div
        className="pointer-events-none absolute left-1/2 top-2 z-30 h-[84px] w-[84px] -translate-x-1/2 md:top-1.5 md:h-[112px] md:w-[112px]"
        data-presence-cradle
      >
        <div
          className="absolute inset-0 rounded-full border border-border-strong/50 bg-surface/35 backdrop-blur-xl"
          style={{
            boxShadow:
              "inset 0 1px 0 rgb(255 255 255 / 0.32), inset 0 -10px 24px rgb(var(--accent) / 0.11), 0 14px 36px rgb(0 0 0 / 0.28), 0 0 34px rgb(var(--accent) / 0.16)",
          }}
          aria-hidden
        />
        <div
          ref={setPresenceAnchorRef}
          id="neurai-topbar-presence"
          className="pointer-events-auto absolute inset-1 rounded-full border border-white/20"
          style={{
            background:
              "radial-gradient(circle at 32% 22%, rgb(255 255 255 / 0.24), rgb(var(--surface) / 0.18) 38%, rgb(var(--bg) / 0.36) 100%)",
          }}
        />
        <div
          className="absolute start-[20%] top-[14%] h-[16%] w-[42%] -rotate-[18deg] rounded-full bg-white/20 blur-[1px]"
          aria-hidden
        />
        <div
          className="absolute inset-[8%] rounded-full border border-white/10"
          aria-hidden
        />
      </div>
    </header>
  );
}
