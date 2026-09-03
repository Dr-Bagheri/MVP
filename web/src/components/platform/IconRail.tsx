"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { useEffect, useState } from "react";
import { personName } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { signOutThisDevice } from "@/lib/signOut";
import { useLocale } from "next-intl";
import { IconChevronEnd, IconChevronRight, IconOpen, IconRobot } from "@/components/icons";
import { NAV_PRIMARY, NAV_UTILITY, activeNavHref, type NavItem } from "./nav";
import { EchoMark, NAV_ICON } from "./icons";

/**
 * The platform sidebar — LABELLED, in the reference's anatomy (user
 * directive, 2026-08-31: "the two bars up there as well as the section they
 * have ... also the way it save and show the user").
 *
 * The icon-only rail (M22) grew words. Three parts, top to bottom, exactly
 * as the reference arranges them:
 *
 *   · the WORKSPACE CARD — the organisation's name over the brand mark, so
 *     the first thing the bar says is whose data this is;
 *   · the one big CTA — a green "new record" that goes to the recorder,
 *     because starting a recording is the most common reason to be here;
 *   · the nav, labelled — a row is an icon and a word, and the active row
 *     wears the soft green pill;
 *   · the PERSON, at the foot — avatar, name, role · workspace. The card is
 *     a door to their own account page, not a menu: the avatar menu with
 *     its full identity header already lives in the top bar, and two menus
 *     for one identity is how they disagree.
 *
 * **It sits at the inline-START.** In RTL that is the right edge, in LTR the
 * left, and `dir` resolves it with no mirroring logic. Inline-*end* is the
 * LEFT edge in RTL — learned by rendering it wrong once; do not "fix" it.
 */
/** the person's own choice of menu width, remembered per browser */
const RAIL_KEY = "neurai-rail-compact";

export function IconRail() {
  const t = useTranslations("platform");
  const locale = useLocale();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  /**
   * TWO STATES (user directive, 2026-09-03: "make the side menu two stage of
   * open and compact — in the compact only icons will be shown").
   *
   * Open is the default and the remembered choice is read in an EFFECT, not
   * in `useState`: the server has no localStorage, and a value read during
   * render would make the first paint disagree with the markup the server
   * sent. Open is also the safe direction — a menu whose labels fail to
   * appear is worse than one that starts wide.
   */
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(RAIL_KEY) === "1") setCompact(true);
    } catch { /* storage unavailable — open, which is the safe default */ }
  }, []);
  function toggleCompact(): void {
    setCompact((prev) => {
      const next = !prev;
      try { localStorage.setItem(RAIL_KEY, next ? "1" : "0"); } catch { /* fine */ }
      return next;
    });
  }

  const activeHref = activeNavHref(pathname);

  const item = (nav: NavItem) => {
    const Icon = NAV_ICON[nav.key];
    const active = nav.href === activeHref;
    const external = nav.href.startsWith("http") || nav.href === "#";
    const label = t(nav.key);
    const content = (
      <>
        <span className="grid w-6 shrink-0 place-items-center" aria-hidden>
          {nav.key === "echo" ? <EchoMark size={18} /> : Icon ? <Icon width={16} height={16} /> : null}
        </span>
        {/* COMPACT DROPS THE WORD, NOT THE NAME. The row keeps `title` and
            `aria-label` below, so the destination is still announced to a
            screen reader and still named on hover — a menu of unlabelled
            glyphs that is also unlabelled to assistive technology is not
            compact, it is unusable. */}
        {compact ? null : <span className="truncate text-sm">{label}</span>}
      </>
    );
    /* rounded-lg = the 12px the reference gives a menu row; xl (16) is
       for a list card, and using it here made the rail read as a stack of
       tiles rather than a menu */
    const className = `flex h-10 items-center rounded-lg transition-colors duration-150 ${
      compact ? "justify-center px-0" : "gap-2.5 px-3"
    } ${
      active
        ? "bg-accent-soft font-semibold text-accent"
        : "text-fg-muted hover:bg-surface-2 hover:text-fg"
    }`;

    // the GitHub entry leaves the app — a plain anchor, or next-intl would
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

  /* the person's role, said in their own language — three words, not a
     namespace borrowed from an admin screen */
  const roleLabel =
    me?.role === "owner" ? t("roleOwner") : me?.role === "admin" ? t("roleAdmin") : t("roleMember");

  return (
    <nav
      aria-label={t("primaryNav")}
      // `border-e` IS the inline-end border (Tailwind's logical utility)
      className={`hidden shrink-0 flex-col gap-3 border-e border-border bg-surface py-3 transition-[width] duration-150 md:flex ${
        compact ? "w-16 px-2" : "w-60 px-3"
      }`}
    >
      {/* ── the workspace, and the width toggle ──────────────────────── */}
      <div
        className={`flex items-center rounded-2xl border border-border bg-surface shadow-card ${
          compact ? "justify-center p-1.5" : "gap-2.5 p-2.5"
        }`}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2">
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
        {compact ? null : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-fg">
            {me?.org_name ?? t("name")}
          </span>
          {/* audit finding, 2026-09-02: a px literal here is a stated
              deviation — tailwind.config.ts says px-emitting entries "would
              keep the menus and titles frozen while the text around them
              scaled", and the root is a clamp. `text-group-label` IS 11, the
              scaffold's own role for group labels, so the number at 1440 is
              unchanged and the caption now scales with everything beside it. */}
          <span className="block text-group-label text-fg-subtle">{t("workspace")}</span>
        </span>
        )}
        {/* THE TOGGLE lives with the workspace rather than at the foot: it is
            a fact about this menu, and the foot belongs to the person. In
            compact it drops out entirely — a 64px column has no room for a
            second control beside the mark, and the button below the mark is
            the one that comes back. */}
        {compact ? null : (
          <button
            type="button"
            className="btn btn-icon shrink-0 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            aria-label={t("railCompact")}
            title={t("railCompact")}
            aria-expanded
            onClick={toggleCompact}
          >
            <IconChevronEnd width={14} height={14} />
          </button>
        )}
      </div>

      {/* the way BACK to the full menu, when there is no room beside the
          workspace mark for it */}
      {compact ? (
        <button
          type="button"
          className="btn btn-icon mx-auto text-fg-subtle hover:bg-surface-2 hover:text-fg"
          aria-label={t("railExpand")}
          title={t("railExpand")}
          aria-expanded={false}
          onClick={toggleCompact}
        >
          <IconChevronRight width={14} height={14} />
        </button>
      ) : null}

      {/* ── THE ONE BIG THING, and it is the assistant now ───────────────
          User directive, 2026-09-03: "for the green button in the menu with
          text new meeting change it to the assistant, and remove the
          assistant access in the menu".

          One door, in the most prominent place, and the row it used to have
          further down is gone (nav.ts) — a product whose primary action is
          "ask" should not also list asking as the fourth item in a list.
          Starting a meeting is still one press from the meetings screen,
          which is where somebody who wants a meeting already is. */}
      <Link
        href="/assistant"
        title={t("assistant")}
        aria-label={t("assistant")}
        /* the rail's one primary action goes through `.btn` like every other
           primary in the product. It was the most prominent button on screen
           and the last one still choosing its own height and corner. */
        /*
          THE LABEL IS CENTRED IN THE BUTTON, and the icon sits beside it
          (user directive, 2026-09-03: "make the text come in the center and
          the icon beside it").
          `.btn` centres the icon-and-text GROUP, which is the ordinary right
          answer and is why every other button here uses it — but it means the
          word itself sits off-centre by half the icon's width, which is
          visible on the one full-width button in the product. So the icon is
          taken out of the flow and the label centres across the whole box:
          `relative` here, `absolute` on the glyph, and `start-3.5` rather
          than `left` so it stays on the reading-start edge in both locales.
        */
        className={`btn relative bg-primary text-on-primary shadow-accent hover:opacity-90 ${
          compact ? "w-full px-0" : "w-full"
        }`}
      >
        <IconRobot
          width={16}
          height={16}
          className={compact ? "" : "absolute start-3.5"}
        />
        {compact ? null : t("assistant")}
      </Link>

      {/* ── the destinations ─────────────────────────────────────────── */}
      <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {NAV_PRIMARY.map(item)}
        <div className="my-2 border-t border-border" aria-hidden />
        {NAV_UTILITY.map(item)}
      </div>

      {/* ── the person, and the way out ──────────────────────────────
          The sign-out is a SIBLING of the card, not inside it: a link that
          opens the profile cannot also contain a button that ends the
          session — one nested inside the other is a click target that means
          two things depending on the pixel. */}
      {me !== null ? (
        <div
          className={`flex items-center rounded-2xl border border-border ${
            compact ? "justify-center p-1.5" : "gap-1.5 p-2.5"
          }`}
        >
          <Link
            href="/profile"
            title={personName(me, locale)}
            className={`-m-1 flex min-w-0 items-center rounded-xl p-1 transition-colors hover:bg-surface-2 ${
              compact ? "justify-center" : "flex-1 gap-2.5"
            }`}
          >
            {/* 2026-09-03: the platform's avatar, not a fifth hand-drawn one.
                `md` IS the 36px this drew by hand, so the picture is the same
                size it was; what moves is the DECISION — photo when there is
                one, first letter otherwise, cropped to the circle, uppercased
                once. That decision was spelled `slice(0, 1)` here, `charAt(0)`
                in the top bar's menu and `charAt(0)` again in the profile
                header, over three different grounds, for the same person on
                the same screen. */}
            <Avatar name={personName(me, locale)} src={me.avatar_url} size="md" />
            {compact ? null : (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">
                {personName(me, locale)}
              </span>
              {/* audit finding, 2026-09-02: the workspace caption's twin —
                  same px literal, same role (see the comment above it) */}
              <span className="block truncate text-group-label text-fg-subtle">
                {roleLabel}
                {me.org_name ? ` · ${me.org_name}` : ""}
              </span>
            </span>
            )}
          </Link>
          {/* SIGN OUT IS NOT IN THE COMPACT MENU (user report, 2026-09-03:
              "the sign out icon came into the profile icon — just remove it in
              compact version of the menu"). At 64px the row has space for one
              thing, and the two controls were landing on top of each other:
              an avatar with a second button inside its own box is a click
              target that means two different things depending on the pixel,
              which is the exact reason this button is a SIBLING of the profile
              link rather than nested in it.
              It is not lost — the avatar menu in the top bar carries sign-out
              too, at every width. Removing the second copy from a 64px column
              costs nothing; leaving it there costs a mis-click that ends the
              session. */}
          {compact ? null : (
          <button
            type="button"
            aria-label={t("signOut")}
            title={t("signOut")}
            /* the flow itself lives in lib/signOut — the sessions row has to
               be closed as well as the cookie, and a second implementation
               here would close one of the two */
            onClick={() => { void signOutThisDevice(locale); }}
            /* audit finding, 2026-09-02: this was a twelfth invented shape —
               a 32px square with the 12px menu corner, where the theme's icon
               button is 28 with an 8px corner (`.btn-icon`, measured off the
               reference). It escaped control.guard because it was a GRID and
               the guard demands flex+items-center, which is exactly the kind
               of entry that makes a worklist read shorter than the problem.
               `.btn` already composes `.tap` and the transition. */
            className="btn btn-icon shrink-0 text-fg-subtle hover:bg-surface-2 hover:text-danger"
          >
            <IconOpen width={14} height={14} className="rotate-180 rtl:rotate-0" />
          </button>
          )}
        </div>
      ) : null}
    </nav>
  );
}
