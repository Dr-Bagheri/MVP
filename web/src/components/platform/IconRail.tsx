"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { useEffect, useState } from "react";
import { personName } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
/* the foot's placeholder, and the only import this rail kept from the 248px
   version of itself: `signOutThisDevice` went out with the rail's sign-out
   button (see the foot below — the top bar's avatar menu carries it now). */
import { Skeleton } from "@/components/scaffold";
import { useLocale } from "next-intl";
import { NAV_PRIMARY, NAV_UTILITY, activeNavHref, type NavItem } from "./nav";
import { EchoMark, NAV_ICON } from "./icons";

/**
 * THE CATEGORY RAIL.
 *
 * ONE WIDTH, AND IT IS THE NARROW ONE. What stood here was a 248px labelled
 * sidebar with a compact 64px alternative and a toggle between them — three
 * states to keep in step (the store, the two layouts, the remembered choice)
 * for a menu of nine destinations. The reference (Plane's leftmost column,
 * Slack's) answers it with one: a glyph with its word UNDER it, always
 * present, always the same width. The word is what made the old rail wide;
 * putting it under the icon rather than beside it is what makes it narrow, and
 * neither state has to be chosen or remembered.
 *
 * **What the change buys, and why it was asked for.** The 248px column was a
 * fifth of a 1280 laptop spent on nine links. That space is the home page's
 * own sidebar now — the workflows, the agents and the conversation sessions —
 * which is a list that grows and earns width, where a fixed menu does not.
 *
 * **It sits at the inline-START.** In RTL that is the right edge, in LTR the
 * left, and `dir` resolves it with no mirroring logic. Inline-*end* is the
 * LEFT edge in RTL — learned by rendering it wrong once; do not "fix" it.
 *
 * THE GREEN ASSISTANT BUTTON IS GONE, and not as a trim: the assistant is
 * HOME now, the rail's first entry, so the button was a second door to the
 * first room on the list. A primary action that duplicates the item under it
 * is how two controls come to disagree about which conversation you are in.
 */
export function IconRail() {
  const t = useTranslations("platform");
  const locale = useLocale();
  const pathname = usePathname();
  /**
   * THREE STATES, because two of them make the menu jump (user report,
   * 2026-09-08: "every time I refresh, the help comes a little late and I see
   * the settings icon jumping").
   *
   * `undefined` = still asking. It was `Me | null`, where null meant BOTH
   * "the read has not landed" and "there is nobody" — so the person's door at
   * the foot rendered nothing until the network answered. The destinations
   * column is `flex-1` and Settings/Help are held at its bottom by `mt-auto`,
   * so the door arriving half a second later took its height out of that
   * column and pulled the two of them up with it, on every refresh.
   *
   * Narrowing the rail to 72px did not retire this: the jump is shorter (~44px
   * of avatar and padding instead of the old card's ~62) and the mechanism —
   * `flex-1` above, `mt-auto` inside it — is untouched, so it is the same bug
   * at a smaller amplitude. The door's own box is a constant below, shared
   * with the placeholder: the space is reserved by the same classes at the
   * same height, so there is no second spelling of it to drift.
   */
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const activeHref = activeNavHref(pathname);

  const item = (nav: NavItem) => {
    const Icon = NAV_ICON[nav.key];
    const active = nav.href === activeHref;
    const external = nav.href.startsWith("http") || nav.href === "#";
    const label = t(nav.key);
    const content = (
      <>
        <span className="grid place-items-center" aria-hidden>
          {nav.key === "echo" ? <EchoMark size={18} /> : Icon ? <Icon width={18} height={18} /> : null}
        </span>
        {/*
          THE WORD IS UNDER THE GLYPH, and it is the whole point of this rail
          rather than a caption on it: a rail of unlabelled icons is a
          memory test, and the labelled 248px version this replaces was
          spending a fifth of a laptop on the same nine words.

          IT WRAPS; IT DOES NOT CLIP (observed 2026-09-08: «Integratio…»
          and «Managem…»). `truncate` stood here, and at 10px «Integrations»
          measures a hair OVER the ~52px a 72px rail leaves once both
          paddings are taken — so the two longest names in the menu were the
          two that lost their endings, which is the worst possible pair to
          lose them. Widening the rail to buy eight pixels only moves the
          threshold; Persian («یکپارچه‌سازی‌ها») clears any width this rail
          can be. So the word gets a SECOND LINE instead: `line-clamp-2`
          bounds the cell, `hyphens-auto` breaks Latin at a real syllable
          («Integra-tions», since the html element carries `lang`), and
          `overflow-wrap:anywhere` is the last resort for a script that
          hyphenation does not serve. `title`/`aria-label` still carry the
          full name — a two-line label is a reminder, the accessible name is
          the contract.
        */}
        <span className="line-clamp-2 w-full text-center text-[10px] leading-[1.15] [hyphens:auto] [overflow-wrap:anywhere]">
          {label}
        </span>
      </>
    );
    /* rounded-lg = the 12px the reference gives a menu row; a rail cell is
       still a menu row, drawn as a square rather than as a line */
    const className = `flex w-full flex-col items-center gap-1 rounded-lg px-0.5 py-2 transition-colors duration-150 ${
      active
        ? "bg-accent-soft font-semibold text-accent"
        : "text-fg-muted hover:bg-surface-2 hover:text-fg"
    }`;

    // an entry that leaves the app — a plain anchor, or next-intl would
    // locale-prefix an external URL
    return external ? (
      <a key={nav.key} href={nav.href} target="_blank" rel="noreferrer noopener" title={label} aria-label={label} className={className}>
        {content}
      </a>
    ) : (
      <Link key={nav.key} href={nav.href} aria-current={active ? "page" : undefined} title={label} aria-label={label} className={className}>
        {content}
      </Link>
    );
  };

  /**
   * THE FOOT'S BOX, written once and worn by BOTH the person's door and the
   * space kept for it while the identity is read. Two copies of these classes
   * would be two heights the day one of them gains a padding step — and the
   * whole point of the placeholder is that its height is the door's.
   *
   * It is an OUTER box with one thing inside it, which at this width looks like
   * a div for nothing and is not: the box is what reserves the height, and the
   * thing inside it changes (a link to the profile, or a grey circle). Holding
   * the geometry where it cannot change is the whole mechanism — the 248px rail
   * did the same with its card, and all that is gone from it here is what it
   * held (no border, no name, no role caption, no sign-out sibling — a 36px
   * avatar in 4px of padding).
   */
  /*
   * THE PADDING IS NOT HERE — it is on whatever fills the box.
   *
   * It WAS here once, and that cost the hit area. `p-1` belongs on the profile
   * `Link` itself, so the target is 4+36+4 = 44, the platform's floor
   * (`.tap::after`, units.guard). Hoisted to this wrapper instead, the `Link`
   * wears nothing but the 36px avatar, so the click target, the focus ring and
   * the hover fill all shrink to 36 — under the floor, on the one control in a
   * 64px column.
   *
   * Both branches still measure the same 44px, which is the point of sharing a
   * string at all; they just wear the 4px on the element that is actually being
   * pressed.
   */
  const footBox = "mx-auto grid place-items-center rounded-xl";

  return (
    <nav
      aria-label={t("primaryNav")}
      /*
       * THE SHEET, NOT THE SEAM (R23 — then, on the rendered screen).
       *
       * Two passes, and the second one is the correction. `border-e
       * border-border bg-surface` was the most visible box-line in the
       * product, so the first pass took the whole class list — the hairline
       * AND the ground — and left the column transparent. That removed the
       * seam and removed the CHROME with it: a rail sitting on the page ground
       * reads as part of the page, and the shell stops being a shell.
       *
       * `glass-chrome` is the answer to both halves at once, and it is the
       * TOP BAR'S OWN CLASS rather than a tone chosen to look similar. The two
       * meet at the window's corner, so any second spelling of "the chrome's
       * colour" is a pair that disagrees the first time either is touched —
       * one class, and they cannot.
       *
       * `w-rail` stays the blueprint's number, so PlatformShell and this
       * column cannot drift apart about how much of the window the menu takes.
       *
       * THE CORNER. The chrome runs flush to the
       * window, so the app's top edge is this column's top-START corner and
       * the bar's top-END one — two elements, one edge, and rounding either
       * alone leaves a square corner at the other end of the same line. The
       * radius is `rounded-ss-2xl`, the MODAL token every panel in the product
       * already rounds at, rather than a window-sized number of its own.
       */
      className="glass-chrome hidden w-rail shrink-0 flex-col gap-3 rounded-ss-2xl px-1 py-4 md:flex"
    >
      {/* ── the workspace ────────────────────────────────────────────────
          The organisation's mark, and its name is the `title`: at 72px a
          workspace name is either an ellipsis or a lie about how much of it
          you can read, so the mark carries it as a tooltip and the PROFILE
          page carries it in words, under the person's name. (This used to read
          "the person's own card at the foot already says it" — that card is
          gone: the foot is a 36px door now, with no caption under a name. See
          the foot below.) */}
      <span
        className="mx-auto mb-3 grid h-10 w-10 shrink-0 place-items-center rounded-xl"
        title={me?.org_name ?? t("name")}
      >
        <Image
          src="/brand/neurai-mark.png"
          alt=""
          width={20}
          height={20}
          priority
          className="neurai-mark-dark h-5 w-5 object-contain"
        />
        <Image
          src="/brand/neurai-mark-light-transparent.png"
          alt=""
          width={20}
          height={20}
          priority
          className="neurai-mark-light h-5 w-5 object-contain"
        />
      </span>

      {/* ── the destinations ─────────────────────────────────────────── */}
      {/* SPACE BETWEEN THE ENTRIES (2026-09-08: the entries needed more air).
          `gap-0.5` is two pixels, which under a two-line label reads as one
          block of text rather than as nine destinations. The room is taken
          VERTICALLY and not horizontally on purpose: this file's own note
          above records that «Integrations» clears the ~52px a 72px rail
          leaves once both paddings are spent, so inline padding is the one
          axis that cannot give without costing the label a line. */}
      <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {NAV_PRIMARY.map(item)}
        {/* SETTINGS AND HELP AT THE END. The
            column is `flex-1`, so all the spare height was BELOW this group;
            `mt-auto` on the spacer gives that space to the gap instead. No
            rule across it (2026-09-04): the distance already separates them. */}
        <div className="mb-1 mt-auto" aria-hidden />
        {NAV_UTILITY.map(item)}
      </div>

      {/* ── the person ───────────────────────────────────────────────────
          A DOOR to their own account page, not a menu: the avatar menu in the
          top bar carries the identity header and sign-out at every width, and
          two menus for one identity is how they disagree. Sign-out was a
          sibling button here while the rail was 248 wide; at 72 there is room
          for one control, and a second one inside the avatar's own box is a
          click target that means two things depending on the pixel. It is not
          lost and it is not coming back here: the top bar's menu carries it.

          THREE STATES, AND THE MIDDLE ONE IS THE FIX (dfd7834, kept through
          this rail's rewrite). `me !== null` alone was ONE test doing two
          jobs — "nobody is signed in" and "the read has not landed yet" — so
          on every refresh this door appeared half a second late, took its
          ~44px out of the `flex-1` column above, and pulled Settings and Help
          down with it (observed 2026-09-08: on every refresh Help arrived
          late and the Settings icon visibly jumped).
          Narrowing the rail did not fix that; it only made the jump shorter,
          because `flex-1` + `mt-auto` is still what holds the two utility
          entries at the column's bottom.

          So `undefined` means STILL ASKING and keeps the space, in the door's
          own box (`footBox` above, one string worn by both boxes — a
          placeholder with geometry of its own reserves the wrong height and
          jumps anyway, which is why the hover and the link live INSIDE the box
          and not on it). `null` means there is nobody, and draws nothing: an
          anonymous shell has no profile to open, and reserving room for a door
          that will never arrive is the same bug pointing the other way. */}
      {me === undefined ? (
        /* THE SPACE THE DOOR WILL TAKE. The avatar sets the height (36px at
           `md`), so a circle of exactly that size is the whole placeholder —
           there is no name and no role caption beside it to stand in for.
           `data-testid` rather than a role: this is furniture, hidden from
           assistive technology, and the test needs to name it. */
        <div className={`${footBox} p-1`} aria-hidden data-testid="rail-foot-loading">
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
      ) : me !== null ? (
        <div className={footBox}>
          <Link
            href="/profile"
            title={personName(me, locale)}
            aria-label={personName(me, locale)}
            className="grid place-items-center rounded-xl p-1 transition-colors hover:bg-surface-2"
          >
            {/* the platform's avatar, not a fifth hand-drawn one: photo when
                there is one, first letter otherwise, cropped and uppercased in
                exactly one place */}
            <Avatar name={personName(me, locale)} src={me.avatar_url} size="md" />
          </Link>
        </div>
      ) : null}
    </nav>
  );
}
