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
  width = "small",
  fill = false,
  className = "",
  children,
}: {
  /**
   * THE PLATFORM'S TWO PAGE SIZES (user directive, 2026-09-03: "change all
   * normal page mode pages to small page design and all big page mode to
   * normal mode page design, and basically remove the big page design").
   *
   *   small   1040 — the default, and now what almost every page is: a
   *           reading-and-editing column that keeps a line of text short
   *           enough to read and a form's label near its field
   *   normal  1240 — a list or board surface wide enough to need it. The
   *           task board is the one page that asks.
   *
   * BIG IS GONE, and with it `full` (unbounded) and `wide` (1600). Three
   * sizes meant three answers to "how wide is a page", and the widest of
   * them was a page with no bound at all — which is not a size, it is the
   * absence of one, and it read as a different product beside its
   * neighbours. [SUPERSEDES the 2026-09-02 three-size directive.]
   *
   * The DEFAULT moved rather than every call site being edited: a page that
   * says nothing about its width is the common case, and it is the one the
   * directive is about.
   */
  width?: "small" | "normal";
  /** for the rare caller that has to trim the rhythm — a surface split into
      two containers must not pay the top padding twice */
  className?: string;
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
  const max = width === "normal" ? "max-w-content" : "max-w-content-small";
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
      className={`${className} mx-auto w-full ${max} px-page-inline pb-page-bottom pt-page-sm md:px-page-inline-md md:pt-page${
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
  actions,
}: {
  /** accepted, not rendered — see the note below */
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  /*
   * NO TITLE, NO SUBTITLE, NO RULE (user directive, 2026-09-02: "remove
   * titles headers and the old frontend architecture that we had").
   *
   * What stood here was a 24px page title, a muted subtitle and a hairline —
   * the whole block roughly 90px of every screen, above content the person
   * came for, restating a name the breadcrumb in the top bar was already
   * showing. The reference has none of it: a page says its name in the bar
   * and spends its height on the work.
   *
   * The component stays, and its ACTIONS stay, because the actions are the
   * only part that was ever load-bearing — and keeping the component means
   * eighteen pages changed shape without eighteen edits, each of which could
   * have dropped a button.
   *
   * `title` and `subtitle` are still accepted and deliberately unused: they
   * are what every caller passes, and a required-prop change here would be a
   * mechanical sweep with nothing to show for it. The rendered artifact is
   * what the directive is about.
   */
  if (!actions) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">{actions}</div>
  );
}

/**
 * A section block: a section title (`.h-section`, text-section-title 15px),
 * optional muted description, content 16px below. Sections stack at a 24px
 * rhythm; `divided` draws the hairline ABOVE this section (the blueprint
 * separates sections, not panels).
 */
export function Section({
  title,
  description,
  divided = false,
  hidden = false,
  children,
}: {
  title?: string;
  description?: string;
  divided?: boolean;
  /**
   * Present but not shown — for a section that is one tab of a page (see
   * `SectionTabs`). Hidden rather than unmounted on purpose: a table's search
   * box, its filters and its page number are things a person set, and losing
   * them because they glanced at the other tab is the kind of small betrayal
   * that teaches people not to explore a screen.
   *
   * The attribute, not a class: `hidden` takes the element out of the
   * accessibility tree as well as the layout, so a screen reader does not read
   * out the tab nobody chose.
   */
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    /* first-of-type:pt-0 — the header's own mb-6 (or the container's aligned
       top) carries the space; pt-8 on top of it read as a hole under every
       divider */
    <section
      hidden={hidden}
      /*
       * `first-of-type:pt-0` removes the top padding from the first section
       * on a page, so it does not sit a rhythm step below a page header that
       * already carries one. But a DIVIDED section draws a hairline above
       * itself, and with the padding gone that rule lands flush against its
       * own heading (user report, 2026-09-04: "the divider is too close to
       * the section above it" — on the agent page, whose first section is
       * both first and divided).
       *
       * A rule with nothing under it is not a separator, it is an underline
       * on the thing above. So the exemption applies only where there is no
       * rule to give room to.
       */
      className={`py-6 ${divided ? "border-t border-border" : "first-of-type:pt-0"}`}
    >
      {/* audit finding, 2026-09-02: this h2 wore `text-xl`, and the re-pitched
          scale points `xl` at rem(SCAFFOLD.fontSize.pageTitle) = 16 — so every
          block heading inside a page rendered at the PAGE title's size, a step
          above the 15px `.h-section` its ~30 siblings across management and
          settings already wear. On the settings screens the two sit on one
          scroll: an untitled <Section> wrapping GeneralSettings' `.h-section`
          headings, and a titled one a press away, disagreeing by a step about
          what a block heading is. `.h-section` IS the theme's role for this
          (globals.css: text-section-title, same weight and colour), so the
          class carries all three and nothing is restated on top of it.
          The doc comment above said "20px title" — true before the scale moved
          and describing no rendered size since; prose cannot hold a number a
          token owns. Integrations.tsx:285 fixed its own copy and left the
          platform-wide half here, which is where it belongs. */}
      {title ? <h2 className="h-section">{title}</h2> : null}
      {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
