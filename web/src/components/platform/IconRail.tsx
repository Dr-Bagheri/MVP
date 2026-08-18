"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { NAV_PRIMARY, NAV_UTILITY, type NavItem } from "./nav";
import { EchoMark, NAV_ICON } from "./icons";

/**
 * The platform icon rail (M22) — `md` and up; below that the bottom bar takes
 * over.
 *
 * **It sits at the inline-START.** In RTL that is the right edge, in LTR the
 * left, and `dir` resolves it with no mirroring logic — which is the whole
 * argument for a rail over a drawer that must pick a side.
 *
 * Worth stating because I got it backwards once: inline-*end* is the LEFT edge
 * in RTL. The first build of the mock put the rail on the wrong side in both
 * locales, and the CSS matched the sentence I had written — only the render
 * disagreed. Rail first in DOM order + `border-inline-end` is the correct
 * shape; do not "fix" it to `end`.
 */
export function IconRail() {
  const t = useTranslations("platform");
  const pathname = usePathname();

  /*
   * "/" would prefix-match every route, so the hub is compared exactly while
   * the rest match by prefix (so /settings/security still lights Settings).
   *
   * LONGEST match wins, and only it: /management/skills is Agents' entry AND
   * Management's prefix — naive per-item matching lit both tiles at once the
   * day the quick-access destinations joined the rail.
   */
  const candidates = [...NAV_PRIMARY, ...NAV_UTILITY]
    .map((n) => n.href)
    .filter((href) => (href === "/" ? pathname === "/" : pathname.startsWith(href)));
  const activeHref = candidates.sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  const item = (nav: NavItem) => {
    const Icon = NAV_ICON[nav.key];
    const active = isActive(nav.href);
    const external = nav.href.startsWith("http") || nav.href === "#";
    const label = t(nav.key);
    const content = (
      <>
        {nav.key === "echo" ? <EchoMark size={20} /> : Icon ? <Icon width={18} height={18} /> : null}
        <span className="sr-only">{t(nav.key)}</span>
      </>
    );
    const className = `grid h-10 w-10 place-items-center rounded-xl transition-colors duration-150 ${
      active
        ? "bg-accent text-on-accent"
        : "text-fg-muted hover:bg-surface-2 hover:text-fg"
    }`;

    // The GitHub entry leaves the app, so it is a plain anchor — next-intl's
    // Link would try to locale-prefix an external URL.
    return external ? (
      <a
        key={nav.key}
        href={nav.href}
        target="_blank"
        rel="noreferrer noopener"
        title={label}
        className={className}
      >
        {content}
      </a>
    ) : (
      <Link
        key={nav.key}
        href={nav.href}
        aria-current={active ? "page" : undefined}
        title={label}
        className={className}
      >
        {content}
      </Link>
    );
  };

  return (
    <nav
      aria-label={t("primaryNav")}
      // `border-e` IS the inline-end border (Tailwind's logical utility). An
      // earlier draft of this line also carried `border-inline-end`, which is a
      // CSS property name and not a class — inert, and exactly the
      // present-reads-as-satisfied-does-nothing bug from the audit's §6.
      className="hidden w-[60px] shrink-0 flex-col items-center justify-between border-e border-border bg-surface py-3.5 md:flex"
    >
      <div className="flex flex-col gap-2">{NAV_PRIMARY.map(item)}</div>
      <div className="flex flex-col gap-2">{NAV_UTILITY.map(item)}</div>
    </nav>
  );
}
