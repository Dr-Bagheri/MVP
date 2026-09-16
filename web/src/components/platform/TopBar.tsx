"use client";

import { useCallback, useEffect, useRef } from "react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import type { User } from "@/api/types";
import { IconMoon, IconSun } from "@/components/icons";
import { storeTheme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import { Breadcrumbs } from "./Breadcrumbs";
import { ChatIcon } from "./icons";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import { registerPageMenuAnchor } from "./pageMenuAnchor";
import { registerPresenceAnchor } from "./presenceAnchor";

/**
 * The platform top bar (M22): the trail · global search · bell, chat, theme.
 *
 * Search moved here from the side menu by user directive — it is global, not a
 * destination among destinations. The en/fa switcher that opened this comment
 * for a month left on 2026-09-16 for Settings · General (a set-once-a-year
 * control is a preference, not chrome).
 *
 * At 375 three controls plus breathing room do not fit, so search collapses
 * to its icon; the chat and theme buttons are visible from `md` up.
 */
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
  const tPlatform = useTranslations("platform");
  const theme = useTheme();
  const anchorCleanupRef = useRef<() => void>(() => undefined);
  const setPresenceAnchorRef = useCallback((node: HTMLDivElement | null) => {
    anchorCleanupRef.current();
    anchorCleanupRef.current = node ? registerPresenceAnchor(node) : () => undefined;
  }, []);
  useEffect(() => () => anchorCleanupRef.current(), []);
  const pageMenuCleanupRef = useRef<() => void>(() => undefined);
  const setPageMenuAnchorRef = useCallback((node: HTMLDivElement | null) => {
    pageMenuCleanupRef.current();
    pageMenuCleanupRef.current = node ? registerPageMenuAnchor(node) : () => undefined;
  }, []);
  useEffect(() => () => pageMenuCleanupRef.current(), []);
  /* THE LOCALE PAIR LEFT THIS BAR (user, 2026-09-16: "remove the fa, en
     version from the top menu and put it in settings general page"). The
     language is a preference now, chosen once in Settings · General beside
     the theme and the calendar — GeneralSettings.tsx keeps the one rule the
     pair had (the same route under the other prefix, so nobody loses their
     place). */

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
      {/* NO RULE UNDER THE BAR. `border-b border-border bg-surface` drew
          the app as a
          stack of panes; the bar is a translucent sheet now and the page
          scrolls UNDER it, which is what makes the blur mean something —
          against an opaque strip a backdrop filter has nothing to filter. */}
      {/*
        THE INNER CORNER. The bar's own top-END corner and the rail's
        top-START one
        already curve; this is the third corner of the same chrome — the one
        on the INSIDE of the L, where this bar's underside meets the rail's
        edge and the page starts.

        It lives here and not on `main` because the corner belongs to the
        page, and the page is the gap between two elements rather than an
        element with a border-radius to give. A square of chrome hangs below
        the bar's start edge and `.chrome-notch`'s radial mask removes the
        quarter nearest the page, so the chrome curves around the corner.

        `start-0` is the rail's inline-end edge exactly — this header is the
        rail's flex sibling, so its own start IS the seam, with no width to
        repeat and drift from `w-rail`.

        md ONLY: below it the rail is not rendered, the bar spans the window,
        and a notch at start-0 would be a bite out of the window's own edge.
      */}
      <span
        aria-hidden
        data-platform-corner
        className="chrome-notch pointer-events-none absolute start-0 top-full hidden h-[1.125rem] w-[1.125rem] md:block"
      />
      {/*
        THE CORNER IS THE RAIL'S NEIGHBOUR, SO IT IS `md` ONLY (2026-09-08).

        `rounded-se-2xl` is one half of the app's top edge — the other half is
        the rail's `rounded-ss-2xl`, and the pair only means something where
        both are drawn. Below `md` the rail is not rendered and this bar spans
        the whole window, so the unqualified class curved ONE end of a
        full-width strip and left the other square: the asymmetry the two-
        element rule exists to prevent, arrived from the other direction.

        The same reasoning the `.chrome-notch` above is already written with
        («below md there is no rail, so a notch would bite the window's own
        edge»), applied to the corner that notch curves around.
      */}
        {/*
          THE SEARCH BOX IS CENTRED ON THE WINDOW. The CLOCK is gone with the
          same sentence — the
          date and the time were the other half of this cluster, and what is
          left is the door into everything.

          Centred ABSOLUTELY, and against the WINDOW rather than against this
          bar: the header is the rail's flex sibling, so its own start edge is
          the rail's inline-end edge and `left-1/2` here would sit half a rail
          off the middle of the screen.

          The layer is stretched between TWO edges — `start-[-w-rail]` and
          `end-0` — never given a WIDTH.

          It was `w-screen` pulled back by `w-rail`, and that was measurably
          wrong: the field's centre sat 254px right of the window's on a 1920
          screen. `w-screen` is `100vw`, and `100vw` is not the width of this
          window — it is the width of the INITIAL containing block. It ignores
          page zoom, so under a 1.25 zoom the layer measured 2400px inside a
          1920px window and its centre landed 240px late; and it includes the
          classic scrollbar, so even at 1× the axis drifts by half a gutter on
          any platform that reserves one. A centring rule that depends on
          whether the reader has zoomed is not a centring rule.

          `fixed inset-x-0` was tried next and is WORSE HERE, for a reason worth
          writing down: the bar carries `backdrop-filter`, and a filtered
          ancestor becomes the containing block for its fixed descendants — so
          `fixed` resolved against the BAR, not the viewport, and the layer came
          back 1841px starting at the rail's edge. The glass is not negotiable
          and neither is the centring, so `fixed` is simply the wrong tool on
          this element.

          Two edges need no width and therefore no unit that can be wrong. `end-0`
          is this bar's own end, which IS the window's end; `start` is pulled
          back by exactly `w-rail`, the token the rail itself renders at, so the
          layer's start edge is the window's start edge. What is between them is
          the window, measured by layout rather than by a viewport unit, in every
          zoom and on every scrollbar. Below md the rail is not rendered and the
          pull is zero, which is the same sentence with nothing to subtract.

          `start-*`/`end-*` and not `left`/`right`: in Persian the rail is the
          window's right edge, and the physical form would pull the layer off the
          far side. The layer takes no pointer events so the trail underneath it
          stays clickable; the field itself takes them back.

          It hangs off the HEADER and not off the glass strip inside it, which
          is the last correction and worth a line: an absolutely positioned
          element resolves its offsets against its containing block's PADDING
          box, and the strip carries `px-4` — so `end-0` landed a padding inside
          the window's edge and the axis came back 14px late. The header has no
          padding of its own, so its padding box IS the bar, and the two edges
          mean what they say.
        */}
        <div
          className="pointer-events-none absolute inset-y-0 start-0 end-0 z-30 flex items-center justify-center md:start-[calc(theme(width.rail)*-1)]"
        >
          <div className="pointer-events-auto">
            {/*
              GLOBAL SEARCH IS BACK IN THE BAR (the reference adoption): the
              reference keeps one search box in
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
            {/* ONE HEIGHT ACROSS THE ROW.

                `.input` is the 40px field; every control at the other end
                is `.btn-sm` at 34 — so the bar's one field was the only
                element in it standing 6px taller than everything else.
                `.input-sm` is the theme's own compact field, the same token
                as `.btn-sm`, and it exists for exactly this: a field and a
                button standing in one toolbar row must be level. (The clock
                the directive paired it with is gone; the height it settled
                is the bar's, not the pair's.)

                And it is 20rem wide rather than 14: the placeholder is the
                hint («جستجو در رکوردها، گفتگوها، تسک‌ها…» / "Search records,
                conversations, tasks…") and at 224px it was cut mid-word, which
                turns a promise about what can be searched into an ellipsis. */}
            {/* IT ANSWERS IN PLACE NOW.

                The box was a `<form>` written HERE that did one thing: on
                Enter, `router.push("/search")`. That is a door with a keyhole
                and no window — the query went away to be answered somewhere
                else, and "is this record even in here" cost a page.

                The field kept its shape, its width and its submit; what moved
                into `GlobalSearch` is the whole of what it does after a
                keystroke, because a panel that has to be portalled, debounced,
                arrow-walked and closed on an outside click is not markup a
                layout file should carry. The door still leads to `/search` —
                it is the last row in the panel, and Enter on a query with no
                hits still goes there. */}
            <GlobalSearch />
          </div>
        </div>
      <div className="glass-chrome relative z-20 flex h-topbar items-center gap-2 px-3 md:rounded-se-2xl md:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/*
            THE PAGE'S OWN MENU, BELOW lg ONLY.

            The mirror of the presence cradle at the other end of the bar: a
            slot the shell owns and a page fills, with exactly one owner at a
            time. Home puts its conversations hamburger here; it used to draw
            its own strip directly under this bar, which is a second row of
            chrome on the screen with the least room for one — and the two
            rows were three rules on the start edge and empty space on the
            start edge, stacked.

            `empty:hidden` so the gap does not open on every route that fills
            nothing, and `lg:hidden` because from `lg` up Home's column is on
            screen and its door is not a door to anywhere the reader is not
            already standing.
          */}
          <div
            ref={setPageMenuAnchorRef}
            data-page-menu-cradle
            className="flex items-center empty:hidden lg:hidden"
          />
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

        <div className="flex min-w-0 items-center justify-end gap-2">
          {/* Conversations moved UNDER the hub's prompt box (user directive,
              round 2) — the bar carries no twin of it. */}

          {/* THE MINI RECORDER NO LONGER DOCKS HERE (user report, 2026-09-09:
              "the in call is now behind the search bar"). The search box is
              centred on the WINDOW, on a full-width absolute layer that
              crosses this cluster, so a pill in the bar and the field were one
              strip and the field's layer won. The pill floats over the
              assistant column instead — see FloatingRecorder. */}

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
          {/*
            THE END CLUSTER'S ORDER IS THE USER'S (2026-09-06): "the order is
            from the end: en - fa | theme mode - chat - notification" — and
            since 2026-09-16 the pair and its divider are gone (the language
            lives in Settings · General), so the cluster reads bell, chat,
            theme.

            Read from the bar's EDGE inward, so DOM order — which is
            start→end in both directions — is the reverse: the bell nearest
            the centre, then chat, then the theme at the very edge. In Persian
            the whole cluster mirrors with the document and the reading still
            starts at the edge, which is why the order is written logically
            rather than as left and right.

            One SIZE too: `.btn-icon-sm` is the compact square this bar
            needed and the theme did not have — the three icon buttons stood
            at 28 beside two 34px words when the pair was here, and the
            height stays now that it is not.
          */}
          {me === null ? null : <NotificationBell />}

          <Link
            href="/chat"
            title={tPlatform("chat")}
            aria-label={tPlatform("chat")}
            className="btn btn-icon-sm glass-raised hidden text-fg-muted hover:text-fg md:inline-flex"
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
            className="btn btn-icon-sm glass-raised hidden text-fg-muted hover:text-fg md:inline-flex"
          >
            {theme === "dark" ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
          </button>

          {/* the divider went WITH the pair (2026-09-16): it stood between
              the theme and the things that were not it, and a rule with
              nothing on one side of it is a mark that means nothing. */}

        </div>
      </div>

    </header>
  );
}
