"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { useEffect, useState } from "react";
import { personName } from "@/lib/format";
import { signOutThisDevice } from "@/lib/signOut";
import { useLocale } from "next-intl";
import { IconOpen, IconPlus } from "@/components/icons";
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
export function IconRail() {
  const t = useTranslations("platform");
  const locale = useLocale();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
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
        <span className="grid w-6 shrink-0 place-items-center" aria-hidden>
          {nav.key === "echo" ? <EchoMark size={18} /> : Icon ? <Icon width={16} height={16} /> : null}
        </span>
        <span className="truncate text-sm">{label}</span>
      </>
    );
    const className = `flex h-10 items-center gap-2.5 rounded-xl px-3 transition-colors duration-150 ${
      active
        ? "bg-accent-soft font-semibold text-accent"
        : "text-fg-muted hover:bg-surface-2 hover:text-fg"
    }`;

    // the GitHub entry leaves the app — a plain anchor, or next-intl would
    // locale-prefix an external URL
    return external ? (
      <a key={nav.key} href={nav.href} target="_blank" rel="noreferrer noopener" className={className}>
        {content}
      </a>
    ) : (
      <Link key={nav.key} href={nav.href} aria-current={active ? "page" : undefined} className={className}>
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
      className="hidden w-60 shrink-0 flex-col gap-3 border-e border-border bg-surface px-3 py-3 md:flex"
    >
      {/* ── the workspace ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface p-2.5 shadow-card">
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
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-fg">
            {me?.org_name ?? t("name")}
          </span>
          <span className="block text-[11px] text-fg-subtle">{t("workspace")}</span>
        </span>
      </div>

      {/* ── the one big thing to do ──────────────────────────────────── */}
      <Link
        href="/meetings?new=1"
        className="tap flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-on-primary shadow-accent transition-opacity hover:opacity-90"
      >
        <IconPlus width={16} height={16} />
        {t("newMeeting")}
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
        <div className="flex items-center gap-1.5 rounded-2xl border border-border p-2.5">
          <Link
            href="/profile"
            className="-m-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 transition-colors hover:bg-surface-2"
          >
            {/* the photo where there is one; the initial is the fallback */}
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft text-sm font-bold text-accent">
              {me.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- see
                // the profile header: an un-listed host renders nothing
                <img src={me.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                personName(me, locale).slice(0, 1)
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">
                {personName(me, locale)}
              </span>
              <span className="block truncate text-[11px] text-fg-subtle">
                {roleLabel}
                {me.org_name ? ` · ${me.org_name}` : ""}
              </span>
            </span>
          </Link>
          <button
            type="button"
            aria-label={t("signOut")}
            title={t("signOut")}
            /* the flow itself lives in lib/signOut — the sessions row has to
               be closed as well as the cookie, and a second implementation
               here would close one of the two */
            onClick={() => { void signOutThisDevice(locale); }}
            className="tap grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-danger"
          >
            <IconOpen width={14} height={14} className="rotate-180 rtl:rotate-0" />
          </button>
        </div>
      ) : null}
    </nav>
  );
}
