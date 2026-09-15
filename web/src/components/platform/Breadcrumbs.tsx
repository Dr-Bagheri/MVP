"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
/*
 * `trail.ts`, not `breadcrumbs.ts`: two files differing only in casing resolve
 * to whichever the case-insensitive filesystem hands back first on Windows and
 * to different files on Linux. The compiler caught it here; CI would have
 * caught it as something stranger.
 */
import { trailFor, type Crumb } from "./trail";
import { useCrumbTitleValue } from "./CrumbTitle";
import { ChevronLeftIcon } from "./icons";

/**
 * The breadcrumb trail (user directive, review round 2) — and the platform's
 * ONLY back-navigation.
 *
 * The user asked for a way back twice. The per-page back button from round 1
 * was retired before shipping: two mechanisms can disagree about where "up"
 * is, and the trail already answers it for every page at once.
 *
 * **Two renderings, one trail.** From `md` up the whole path shows, ancestors
 * clickable. Below `md` a full trail would either wrap the bar to two lines or
 * shrink every crumb to an unreadable stub, so it collapses to a chevron plus
 * the PARENT and then THIS PAGE'S OWN NAME — the back control in its most
 * compact honest form, followed by the one word that says where you are.
 *
 * **The name is not decoration on a phone; it is the only copy of it**
 * (2026-09-08, fixing the mobile view against the new shell). R2 retired the
 * page-title block because «the breadcrumb names the page», and that held
 * while the 248px rail stood beside it with the section lit. The rail is
 * `md:flex`, so below `md` the lit row is gone; the bottom bar carries three
 * destinations out of nine and lights nothing for the rest. On a phone,
 * /meetings rendered a bar holding one bell and a page holding no title —
 * measured at 375, the trail element was not in the document at all, because
 * a one-crumb trail returned `null` for want of a parent to point at.
 *
 * So the leaf renders whether or not it has an ancestor, and the chevron is
 * what is conditional. The hub keeps its silence (`/` is one crumb AND the
 * room whose anatomy is settled): a «Home» label over the page that says «Good
 * morning» is chrome naming what the screen already says.
 *
 * **What is deliberately not here.** The assistant pane and the proposal
 * confirm are not routes — the pane is chrome, the confirm is inline in a
 * conversation. Neither has an "up", and inventing one would imply navigation
 * that does not exist.
 */
export function Breadcrumbs() {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const entityTitle = useCrumbTitleValue();

  const trail = resolveTrail(trailFor(pathname), entityTitle, (key) => t(key));

  /*
   * Nothing to render on the hub: its trail is the root alone, and a lone
   * "Home" label in the bar would be chrome that navigates nowhere — on the
   * one screen whose anatomy the user signed off.
   *
   * The test is the ROOT, not the length. A one-crumb trail used to mean both
   * "the hub" and "a section that is its own root" — /meetings, /tasks,
   * /integrations, every rail destination since the 2026-09-02 ruling made
   * them roots — and collapsing the two is what left a phone with no page
   * name anywhere on those screens.
   */
  if (trail.length === 0) return null;
  if (trail.length === 1 && trail[0]!.href === "/") return null;

  const leaf = trail[trail.length - 1]!;
  const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;

  return (
    <nav aria-label={t("platform.breadcrumb")} className="min-w-0">
      {/* below md: the way back, then where you are */}
      <span className="flex min-w-0 items-center gap-1 text-sm md:hidden">
        {parent ? (
          <Link
            href={parent.href}
            className="tap -mx-1 flex shrink-0 items-center gap-1 px-1 text-fg-muted transition-colors hover:text-fg"
          >
            {/* "back" points the way the writing runs; the icon has no locale,
                so the flip happens here where the locale is known */}
            <ChevronLeftIcon
              width={16}
              height={16}
              className={locale === "fa" ? "rotate-180" : undefined}
            />
            <span className="truncate">{parent.text}</span>
          </Link>
        ) : null}
        {parent ? (
          <span aria-hidden className="shrink-0 text-fg-subtle">
            /
          </span>
        ) : null}
        {/* THE PAGE'S NAME, and it is not a link: the deepest crumb navigates
            to where you already are — the same rule the md rendering below
            applies to its own last crumb, written once per rendering because
            the two are different elements, not two spellings of one. */}
        <span aria-current="page" className="min-w-0 truncate font-medium text-fg">
          {leaf.text}
        </span>
      </span>

      {/* md and up: the whole path */}
      <ol className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
        {trail.map((crumb, i) => {
          const isLast = i === trail.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {i > 0 ? (
                <span aria-hidden className="text-fg-subtle">
                  /
                </span>
              ) : null}
              {isLast ? (
                /*
                 * The deepest crumb is the page title, not a link: it would
                 * navigate to where you already are, and a control that does
                 * nothing teaches people the rest of the trail does nothing too.
                 */
                <span aria-current="page" className="truncate font-medium text-fg">
                  {crumb.text}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-fg-muted transition-colors hover:text-fg"
                >
                  {crumb.text}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface ResolvedCrumb {
  href: string;
  text: string;
}

/**
 * Turn label keys and the supplied entity title into text.
 *
 * The entity leaf is the whole reason this is a function and not JSX: while a
 * title is still loading it is DROPPED rather than filled in. The trail goes
 * briefly shorter and is never briefly wrong — the id would read as data
 * without being a name, and a blank crumb loses the last step with no way to
 * tell a broken crumb from an untitled page.
 */
function resolveTrail(
  trail: Crumb[],
  entityTitle: string | null | undefined,
  t: (key: string) => string,
): ResolvedCrumb[] {
  const resolved: ResolvedCrumb[] = [];
  for (const crumb of trail) {
    if (crumb.entity) {
      if (entityTitle === undefined) continue; // not loaded yet — omit the leaf
      resolved.push({
        href: crumb.href,
        // null is a fact about the entity, not a loading state: it gets a word
        text: entityTitle ?? t("platform.untitledCrumb"),
      });
      continue;
    }
    if (crumb.label) resolved.push({ href: crumb.href, text: t(crumb.label) });
  }
  return resolved;
}
