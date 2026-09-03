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
       wear the same bordered pill, and the clock was the one bare element.
       audit finding, 2026-09-02: that box was hand-rolled (h-9, 12px corner,
       11.5px) beside a bar of 8px-cornered controls — the theme's compact
       size says the same thing and cannot drift from it. A span wearing
       `.btn btn-sm` is Meetings.tsx:526's own idiom: this is a readout, not
       a control, so it takes the shape without becoming pressable. */
    <span className="btn btn-sm hidden cursor-default gap-1.5 border border-border font-medium text-fg-muted lg:inline-flex">
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
    /* audit finding, 2026-09-02: the bar was `h-14` (56px) while
       SCAFFOLD.topBarHeight has been 62 since the reference measurement and
       tailwind emits `height.topbar` for it — with NO consumer anywhere in
       src, so the token had never once described this bar (48 before the
       measurement, 62 after, the bar 56 throughout). `h-topbar` is the whole
       point of the token: the blueprint's number reaches the shell, and a
       future change to it lands here without a hand edit. */
    <header
      className="relative z-30 h-topbar shrink-0 overflow-visible"
      data-platform-topbar
    >
      {/* Three real columns reserve the centre for the assistant. This keeps
          the orb ring from becoming an invisible layer over breadcrumbs
          or the controls at the other end of the bar. */}
      <div className="relative z-20 grid h-topbar grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center border-b border-border bg-surface px-3 md:grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] md:px-4">
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
          {/* audit finding, 2026-09-02: this box was a `rounded-xl bg-surface`
              frame — the 16px TILE corner and the card's own ground — around
              an `h-9 text-xs` field, so the product's one search box wore
              none of `.input` and put a second radius in a bar whose other
              controls are 8/11px. `.input` supplies the corner, the recessed
              `bg-field` ground, the border, the inline padding and the type;
              only the width and the focus-within (the ring belongs to the
              form, the focus to the field inside it) are written here. */}
          <form
            role="search"
            className="input hidden w-56 min-w-0 items-center gap-2 focus-within:border-accent lg:flex"
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
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle"
              placeholder={tPlatform("searchEverything")}
              aria-label={tPlatform("searchEverything")}
            />
          </form>

          {/* the theme, one press away (the reference keeps it in the bar) —
              the SAME store Settings·General writes, never a second state.
              audit finding, 2026-09-02: it was a hand-rolled 36px square with
              the 16px tile corner, which the control guard cannot see (its
              `place-items-center` is a grid, and the regex asks for
              flex+items-center). `.btn-icon` is the theme's icon button, 28
              on a side — the same line Meetings.tsx:532 writes. `.btn`
              already composes `.tap` and the transition. */}
          <button
            type="button"
            onClick={() => storeTheme(theme === "dark" ? "light" : "dark")}
            title={tPlatform("themeToggle")}
            aria-label={tPlatform("themeToggle")}
            className="btn btn-icon hidden border border-border text-fg-muted hover:text-fg md:inline-flex"
          >
            {theme === "dark" ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
          </button>

          {/* audit finding, 2026-09-02: the two segments were a 36px,
              12px-cornered group written by hand — invisible to the control
              guard, whose regex reads only quoted class strings and these are
              a template literal. The theme's segmented shape is `.btn-sm`,
              and the meetings toolbar directly under this bar renders its own
              segments exactly this way (Meetings.tsx:194) — same pair, same
              active face, so the bar and the page below it stop disagreeing
              about what a segmented control looks like. */}
          <div className="hidden items-center gap-1 md:flex">
            {(["fa", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => switchTo(l)}
                aria-current={l === locale ? "true" : undefined}
                className={`btn btn-sm border font-medium ${
                  l === locale
                    ? "border-accent bg-accent-soft font-semibold text-accent"
                    : "border-border text-fg-muted hover:text-fg"
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
          the ring sits within the bar (`h-topbar`); the rest floats below.

          The offsets are DERIVED from that rule, not chosen: top = bar −
          0.65·ring, so 62 − 39 = 23 for the 60px ring and 62 − 44.2 ≈ 18
          for the 68px one. They were 17/12, which is the same rule solved
          for a 56px bar — the bar's real height until this pass, and the
          reason these two numbers had to move with it. */}
      <div
        ref={setPresenceAnchorRef}
        id="neurai-topbar-presence"
        data-presence-cradle
        /* empty:invisible — when the orb is pinned elsewhere (2026-08-25
           drag-to-pin) nothing portals in here, and an empty ring would be
           exactly the "trace" the directive removes; invisible keeps the
           element (the anchor registration and the drop target) without
           the visual */
        className="pointer-events-auto absolute left-1/2 top-[23px] z-30 h-[60px] w-[60px] -translate-x-1/2 rounded-full border border-border-strong bg-surface empty:invisible md:top-[18px] md:h-[68px] md:w-[68px]"
      />
    </header>
  );
}
