/**
 * M26 — the design scaffold's numbers. ONE source.
 *
 * These are the values the user approved in docs/NeurAI-Design-Blueprint.docx
 * (2026-08-15): structure extracted from the open-source Supabase studio,
 * colors and font ours. tailwind.config.ts IMPORTS this file and derives its
 * theme entries from it, and scaffold.test.tsx asserts the two agree — so a
 * hand edit to either side goes red instead of silently forking the scale.
 *
 * Changing a number here is changing the blueprint: it needs the user's
 * approval and a re-issue of the docx, not a local tweak (M26's closing rule).
 */

export const SCAFFOLD = {
  /** Icon rail — M22, unchanged. */
  railWidth: 60,
  /** Section menu (Settings, Management, apps that need one). */
  menuWidth: 256,
  /** Top bar: breadcrumb + identity. */
  topBarHeight: 48,
  /** Content column, centered; wide variant for data-dense tables. */
  contentMaxWidth: 1200,
  contentMaxWidthWide: 1600,
  /** Inputs and buttons share it (desktop; below md the 44px hit-area rules). */
  controlHeight: 36,

  /** Typography — the nine roles. Sizes in px. */
  fontSize: {
    pageTitle: 24, // text-2xl (Tailwind default, asserted in tests)
    sectionTitle: 20, // text-xl (Tailwind default, asserted in tests)
    paneTitle: 17, // custom: text-pane-title
    body: 14, // text-sm — body, form labels, subtitles
    menuItem: 13.5, // custom: text-menu-item
    detail: 13, // custom: text-detail — row descriptions, breadcrumb
    groupLabel: 11, // custom: text-group-label — group labels, table headers
  },

  /** Shape. Radii are GLOBAL theme values (one scale, no per-page radii). */
  radius: {
    /* ARAMEET ADOPTION (2026-08-31): the reference's shapes, measured off
       its running app — buttons and inputs ~11px, cards 20px. One scale,
       still no per-page radii; the whole product rounds together. */
    control: 11, // rounded-md — inputs, buttons, small chips
    panel: 14, // rounded-lg (and DEFAULT) — panels, menu pills
    tile: 18, // rounded-xl — rail tiles, larger surfaces
    modal: 20, // rounded-2xl — cards and dialogs (the reference's 20px)
  },

  /**
   * THE PAGE'S RHYTHM — config, not prose.
   *
   * This block used to be a COMMENT describing the blueprint's spacing
   * ("page top padding 48 = pt-12 · content inline padding 40 = px-10 …")
   * while every screen wrote its own numbers. That is exactly how the
   * platform ended up with `pt-5` here, `pt-8` there and `py-6` somewhere
   * else: a rule nobody can execute is a rule that holds until the next
   * page (user directive, 2026-08-27: "the margins and spaces everywhere is
   * unset … not any part should be different").
   *
   * Tailwind derives named steps from these, so a page says
   * `pt-page md:pt-page` rather than a number it chose, and
   * `scaffold.test.tsx` holds the two sides together.
   *
   * `menuTop` is the one number that is not free: the section menu's own
   * heading has to land on the page title's line (user directive,
   * 2026-08-18, "align them, consider the left menu text start point"), so
   * it moves WITH `top` and keeps the 12px optical offset between a 17px
   * pane title and a 24px page title.
   */
  page: {
    top: 48,        // desktop: the title's distance from the top bar
    topSm: 32,      // below md, where vertical space is scarcer
    inline: 20,     // below md
    inlineMd: 40,   // desktop gutter
    bottom: 64,     // room under the last section
    menuTop: 36,    // the menu heading's own top — keeps the two headings level
      },

  /**
   * Everything else still rides the STANDARD 4px Tailwind scale — section
   * rhythm 24 = py-6, title→subtitle 4 = mt-1, section title→panel 16 =
   * mb-4, panel row 24x32 = py-6 px-8, panel footer 16x32 = py-4 px-8, menu
   * pill 5x12 = py-[5px] px-3. Those live inside the scaffold components
   * that own them, which is the same rule as above: one place each.
   */
  spacingDoc: "standard-4px-scale",
} as const;
