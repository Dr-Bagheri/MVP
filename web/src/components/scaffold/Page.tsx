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
 * The centered content column. `wide` is for data-dense surfaces (member
 * tables, audit logs, call lists) — the blueprint's 1600px variant; `full`
 * exists for editor-like surfaces and is deliberately rare.
 */
export function PageContainer({
  width = "default",
  children,
}: {
  width?: "default" | "wide" | "full";
  children: ReactNode;
}) {
  const max =
    width === "default" ? "max-w-content" : width === "wide" ? "max-w-content-wide" : "max-w-none";
  /*
   * `md:pt-4` matches the SectionMenu heading's own top padding, so a page
   * title and the menu's pane title start on THE SAME LINE (user directive,
   * 2026-08-18: "they all seem out of place — align them, consider the left
   * menu text start point"). One shared offset, not two guesses: the old
   * pt-12 dropped every page title two lines below the menu heading beside
   * it, and each surface read as its own layout.
   */
  /*
   * THE PAGE'S TOP MARGIN (user directive, 2026-08-26: "add a margin from
   * the top, just a little, for all pages, and add this to the theme").
   * It lives HERE, on the one container every page renders inside, rather
   * than as a class each page remembers — a margin that is a convention is
   * a margin that is missing on the page nobody checked.
   */
  return <div className={`mx-auto w-full ${max} px-5 pb-16 pt-8 md:px-10 md:pt-7`}>{children}</div>;
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
