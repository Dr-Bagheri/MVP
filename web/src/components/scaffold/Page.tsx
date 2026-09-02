import type { ReactNode } from "react";

/**
 * M26 scaffold — the content column and the page's head.
 *
 * Pages never hand-roll layout: a screen is PageContainer → PageHeader →
 * Section(s), and the sizes live in the classes HERE (backed by
 * scaffold/constants.ts through the Tailwind theme). A page that wants a
 * different gap changes the blueprint, not itself.
 */

/**
 * The centered content column.
 *
 * THE RULE (user directive, 2026-09-02: "this size of the page is ideal …
 * make sure to add it to the theme and fix the whole platform; in some cases
 * that it need more space use the full page mode"):
 *
 *   default → almost everything. 1200px, which is the width the reference
 *             product uses and the one that was called ideal. A page does
 *             not get to decide it is special.
 *   wide    → data-dense TABLES that genuinely read better at 1600 (members,
 *             audit logs, call lists). Not a general-purpose "a bit roomier".
 *   full    → surfaces whose content IS the width: a kanban board, an editor
 *             canvas. Deliberately rare, and the answer when default is not
 *             enough — rather than reaching for `wide` as a middle ground,
 *             which is how three widths became three guesses.
 */
export function PageContainer({
  width = "default",
  fill = false,
  children,
}: {
  width?: "default" | "wide" | "full";
  /**
   * Fill the height the shell grants instead of growing with the content.
   *
   * Opt-in, because it changes what a page IS: a filling page never makes
   * the shell's content column scroll — its own body does. The record
   * screen is the case it exists for (a player and a section menu must not
   * walk off the top while a transcript is read), and any page that wants
   * the same must say so, rather than every page silently inheriting a
   * height model it was not designed for.
   *
   * It needs no `md:` guard: the shell's content column is only bounded
   * from md up (`md:h-full`), so below md `h-full` resolves against an auto
   * height, the sections keep their natural size, and the mobile layout
   * scrolls as one page exactly as before.
   */
  fill?: boolean;
  children: ReactNode;
}) {
  const max =
    width === "default" ? "max-w-content" : width === "wide" ? "max-w-content-wide" : "max-w-none";
  /*
   * THE PAGE'S RHYTHM, from the theme (user directives: 2026-08-26 "add a
   * margin from the top, just a little, for all pages, and add this to the
   * theme"; 2026-08-27 "see the margin that the title heading has from the
   * top, add it to the theme so it apply to all pages").
   *
   * Every number here is a NAMED step derived from `SCAFFOLD.page`, so a
   * screen cannot express a different rhythm by picking a value — which is
   * how `pt-5`, `pt-8` and `py-6` all ended up meaning "the top of a page".
   * The menu's own heading rides `SCAFFOLD.page.menuTop` and moves with
   * this, so the two headings stay on one line (2026-08-18).
   */
  return (
    <div
      className={`mx-auto w-full ${max} px-page-inline pb-page-bottom pt-page-sm md:px-page-inline-md md:pt-page${
        fill ? " flex h-full min-h-0 flex-col" : ""
      }`}
    >
      {children}
    </div>
  );
}

/**
 * One 24px title, a muted 14px subtitle 4px under it, optional actions at
 * inline-end. Breadcrumbs are NOT here — the top bar's trail carries them
 * (one mechanism, the breadcrumb ruling).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    /*
     * ONE header structure for every sub page (user directive, 2026-08-18):
     * 24px title, muted subtitle 4px under it, and a full-width hairline
     * closing the block. The divider is part of the HEADER, not something
     * pages draw when they remember to — which is how half the platform had
     * one and half did not, and every surface read as out of place.
     */
    <header className="mb-6 flex items-start justify-between gap-4 border-b border-border pb-5">
      <div>
        <h1 className="text-2xl font-bold text-fg">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A section block: 20px title, optional muted description, content 16px
 * below. Sections stack at a 24px rhythm; `divided` draws the hairline ABOVE
 * this section (the blueprint separates sections, not panels).
 */
export function Section({
  title,
  description,
  divided = false,
  children,
}: {
  title?: string;
  description?: string;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    /* first-of-type:pt-0 — the header's own mb-6 (or the container's aligned
       top) carries the space; pt-8 on top of it read as a hole under every
       divider */
    <section className={`py-6 first-of-type:pt-0 ${divided ? "border-t border-border" : ""}`}>
      {title ? <h2 className="text-xl font-semibold text-fg">{title}</h2> : null}
      {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
