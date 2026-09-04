"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import type { User } from "@/api/types";
import { IconMoon, IconSearch, IconSun } from "@/components/icons";
import { storeTheme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import { formatDate } from "@/lib/format";
import { useTimezonePreference } from "@/lib/usePreferences";
import { Breadcrumbs } from "./Breadcrumbs";
import { ChatIcon } from "./icons";
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
      /*
        z-40, ABOVE THE ASSISTANT COLUMN (user report, 2026-09-03: "the
        notification go behind the assistant menu bar, make it come always on
        top of it").
        The bell's own panel is z-50 and the sidebar is z-30, so the two
        numbers on the two elements said the panel wins — and it lost, because
        a z-index only competes inside its own stacking context. This header
        is `relative z-30`, which traps the panel's 50; what actually met the
        sidebar was 30 against 30, a tie that document order hands to whoever
        comes later, which is the sidebar.
        So the number that had to move is THIS one, not the panel's. 40 keeps
        the bar and everything hanging off it above the docked column and below
        the z-50 modal layer, which must still cover both.
      */
      className="relative z-40 h-topbar shrink-0 overflow-visible"
      data-platform-topbar
    >
      {/* TWO PARTS, not three. The bar was a grid whose CENTRE column existed
          only to reserve 72/84px for the orb's ring — an empty, aria-hidden
          cell holding a place for a control that no longer exists. With the
          orb gone the reservation is a hole in the middle of the bar, so the
          trail takes the free space and the controls sit at the end. */}
      <div className="relative z-20 flex h-topbar items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* The avatar LEFT this bar (user directive, 2026-09-02): the
              person and their way out live at the foot of the rail, where
              the reference puts them, and two doors to one profile is two
              things to keep in step. Its menu's contents — theme, calendar,
              timezone — are Settings' own, which is where they already are.
              The trail takes the free space rather than a fixed slot: it is
              the only element here whose width is content, and it must be
              able to truncate rather than push the controls off the bar. */}
          {/*
            THE CLOCK AND THE SEARCH BOX MOVED TO THIS SIDE (user directive,
            2026-09-05: "put the date and time and also search at the other
            side in the top menu, near to the main menu").

            They were at the far end of the bar, in the cluster with the
            theme, the locale pair and the bell — which is where a person
            looks for SETTINGS, and neither of these is one. Against the rail
            they read as what they are: where you are and when, and the door
            into everything.

            Order matters and is deliberate: the clock is a fixed width and
            the trail is the only element here whose width is its content, so
            the trail keeps `flex-1` and stays the thing that truncates. Put
            the other way round, a long breadcrumb would push the search box
            off the bar.
          */}
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
          <Breadcrumbs />
        </div>

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

          {/*
            THE ASSISTANT'S DOOR, BELOW md ONLY (2026-09-03).

            This slot used to be the orb's cradle: a 68px ring floating over the
            bar's centre column, which the dock portalled a WebGL orb into. The
            orb and its drag-to-pin are gone, and the assistant is a column at
            the inline-end edge now — so at `md` and up the collapsed sidebar is
            on screen and carries its own trigger, and this slot is hidden.
            Below `md` there is no rail, so this is where the one door lives.

            `md:hidden` and the rail's presence are exclusive by construction:
            a person never sees two ways into the same room, and there is one
            button implementation for both places (AssistantSidebar's
            `trigger`). Empty and invisible if the sidebar is silent on this
            route.
          */}
          <div
            ref={setPresenceAnchorRef}
            id="neurai-topbar-presence"
            data-presence-cradle
            className="flex items-center empty:hidden md:hidden"
          />


          {/* the theme, one press away (the reference keeps it in the bar) —
              the SAME store Settings·General writes, never a second state.
              audit finding, 2026-09-02: it was a hand-rolled 36px square with
              the 16px tile corner, which the control guard cannot see (its
              `place-items-center` is a grid, and the regex asks for
              flex+items-center). `.btn-icon` is the theme's icon button, 28
              on a side — the same line Meetings.tsx:532 writes. `.btn`
              already composes `.tap` and the transition. */}
          {/*
            THE ROOM'S DOOR (user directive, 2026-09-05: "add a small icon with
            the same size as switch theme near it for the chat section, and
            remove it from the menu as well").

            The rail's own glyph, through `NAV_ICON` rather than a second
            drawing of two bubbles — the entry left the rail and the picture
            should not have to be redrawn to follow it. The box is the theme
            toggle's, character for character, because they stand in the same
            cluster and a twelfth invented square is how this bar got audited
            in the first place.

            `md:inline-flex` matches the toggle beside it: below md the bottom
            bar carries navigation, and this is chrome for the desktop shell.
          */}
          <Link
            href="/chat"
            title={tPlatform("chat")}
            aria-label={tPlatform("chat")}
            className="btn btn-icon hidden border border-border text-fg-muted hover:text-fg md:inline-flex"
          >
            {/* the RAIL'S own glyph, imported rather than redrawn: the entry
                left the rail and the picture follows it */}
            <ChatIcon width={16} height={16} />
          </Link>

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

    </header>
  );
}
