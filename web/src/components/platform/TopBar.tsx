"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import type { User } from "@/api/types";
import { IconMoon, IconSearch, IconSun } from "@/components/icons";
import { storeTheme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import { formatDate } from "@/lib/format";
import { useTimezonePreference } from "@/lib/usePreferences";
import { Breadcrumbs } from "./Breadcrumbs";
import { NotificationBell } from "./NotificationBell";
import { registerPresenceAnchor } from "./presenceAnchor";
import { registerRecorderAnchor } from "./recorderAnchor";

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

/* `isPlatformRoot` stays in the signature and is unused HERE: the platform
   console's own guard reads it, and every caller passes it. Dropping the prop
   would make those callers wrong about a fact that is still true. */
export function TopBar({
  me,
  isPlatformRoot: _isPlatformRoot = false,
}: {
  /** `undefined` while the identity read is in flight; `null` once it has
      answered that there is nobody. The two are different questions. */
  me: User | null | undefined;
  isPlatformRoot?: boolean;
}) {
  const locale = useLocale();
  const tPlatform = useTranslations("platform");
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const anchorCleanupRef = useRef<() => void>(() => undefined);
  const setPresenceAnchorRef = useCallback((node: HTMLDivElement | null) => {
    anchorCleanupRef.current();
    anchorCleanupRef.current = node ? registerPresenceAnchor(node) : () => undefined;
  }, []);
  useEffect(() => () => anchorCleanupRef.current(), []);
  const recorderCleanupRef = useRef<() => void>(() => undefined);
  const setRecorderAnchorRef = useCallback((node: HTMLDivElement | null) => {
    recorderCleanupRef.current();
    recorderCleanupRef.current = node ? registerRecorderAnchor(node) : () => undefined;
  }, []);
  useEffect(() => () => recorderCleanupRef.current(), []);
  /*
   * Switching locale re-renders the SAME route under the other prefix, so the
   * user stays where they were. Sending them home on a language change would
   * lose their place for a preference toggle.
   */
  const switchTo = (next: "fa" | "en") => router.replace(pathname, { locale: next });

  return (
    <header
      className="relative z-30 h-14 shrink-0 overflow-visible"
      data-platform-topbar
    >
      {/* Three real columns reserve the centre for the assistant. This keeps
          the orb ring from becoming an invisible layer over breadcrumbs
          or the controls at the other end of the bar. */}
      <div className="relative z-20 grid h-14 grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center border-b border-border bg-surface px-3 md:grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {/* The avatar LEFT this bar (user directive, 2026-09-02): the
              person and their way out live at the foot of the rail, where
              the reference puts them, and two doors to one profile is two
              things to keep in step. Its menu's contents — theme, calendar,
              timezone — are Settings' own, which is where they already are.
              The trail takes the free space rather than a fixed slot: it is
              the only element here whose width is content, and it must be
              able to truncate rather than push the controls off the bar. */}
          <Breadcrumbs />
        </div>

        <div aria-hidden />

        <div className="flex min-w-0 items-center justify-end gap-2">
          {/* Conversations moved UNDER the hub's prompt box (user directive,
              round 2) — the bar carries no twin of it. */}

          {/* the mini recorder docks here while a take is live (user
              directive, 2026-08-23): beside the calendar/clock, DOM-first in
              this end cluster = the centre-side position in BOTH directions
              (LTR lays the cluster out left→right, RTL right→left — first
              child lands nearest the centre either way). Empty and invisible
              when nothing is rolling. */}
          <div
            ref={setRecorderAnchorRef}
            id="neurai-topbar-recorder"
            className="flex min-w-0 items-center empty:hidden"
          />
          <Clock />

          {/*
            GLOBAL SEARCH IS BACK IN THE BAR (user directive, 2026-08-31,
            the reference adoption): the reference keeps one search box in
            its toolbar, and it reads as the product's front door. Submit
            goes to the search surface with the query — the box is a door,
            not a second implementation of search.
          */}
          <form
            role="search"
            className="hidden min-w-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 lg:flex"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get("q");
              if (typeof q === "string" && q.trim() !== "") {
                /* `/search`, which is where the surface lives. It pushed
                   `/echo/search` — an address Echo's route no longer serves
                   as a section, so the platform's one search box led
                   nowhere. Echo's own search row is gone (this bar is the
                   door now), which is exactly why the door had to be
                   pointed at the room. */
                router.push({ pathname: "/search", query: { q: q.trim() } });
              }
            }}
          >
            <IconSearch width={14} height={14} className="shrink-0 text-fg-subtle" />
            <input
              name="q"
              className="h-9 w-44 min-w-0 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
              placeholder={tPlatform("searchEverything")}
              aria-label={tPlatform("searchEverything")}
            />
          </form>

          {/* the theme, one press away (the reference keeps it in the bar) —
              the SAME store Settings·General writes, never a second state */}
          <button
            type="button"
            onClick={() => storeTheme(theme === "dark" ? "light" : "dark")}
            title={tPlatform("themeToggle")}
            aria-label={tPlatform("themeToggle")}
            className="tap hidden h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-surface text-fg-muted transition-colors hover:text-fg md:grid"
          >
            {theme === "dark" ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
          </button>

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
              calendar/clock (user directive, 2026-08-21).
              PRESENT WHILE LOADING: the bar is chrome, and chrome that
              assembles itself piece by piece in front of the reader is worse
              than chrome that arrives complete and fills in. The bell renders
              as soon as the page does; what waits for the network is what is
              INSIDE it. It disappears only for a resolved `null` — an answer,
              not a delay. */}
          {me === null ? null : <NotificationBell />}
        </div>
      </div>

      {/* PresenceDock portals the ONE production assistant button here.
          The design is DELIBERATELY one thin circle around a small orb
          (user directive, 2026-08-22: "just one line circle … make the orb
          and the particles small and fit 65% of it on the top menu") —
          no glass sphere, no curved bulge, no highlight layers. 65% of
          the ring sits within the 56px bar; the rest floats below it. */}
      <div
        ref={setPresenceAnchorRef}
        id="neurai-topbar-presence"
        data-presence-cradle
        /* empty:invisible — when the orb is pinned elsewhere (2026-08-25
           drag-to-pin) nothing portals in here, and an empty ring would be
           exactly the "trace" the directive removes; invisible keeps the
           element (the anchor registration and the drop target) without
           the visual */
        className="pointer-events-auto absolute left-1/2 top-[17px] z-30 h-[60px] w-[60px] -translate-x-1/2 rounded-full border border-border-strong bg-surface empty:invisible md:top-[12px] md:h-[68px] md:w-[68px]"
      />
    </header>
  );
}
