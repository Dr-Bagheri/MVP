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

/*
 * ── THE 2026-09-02 MEASUREMENT ──────────────────────────────────────────
 *
 * User directive: "the look of the platform is like 10 different developers
 * made it … open panel.arameet.ir and use it as template, the sizes, the
 * spaces between section components, the tables, the menu, the text boxes,
 * everything."
 *
 * So the numbers below are MEASURED off the running reference (computed
 * styles, signed in, at 1745px), not read off a screenshot. Recorded with
 * their conditions, the way a measurement is allowed to live in this repo:
 *
 *   shell      sidebar 248 (pad 18/14) · top bar 62 (pad-inline 22, gap 14)
 *   column     max-width 1240 · padding 26 / 28 / 40 · block rhythm 22
 *   radii      8 segmented+icon · 11 input & button · 12 nav · 16 list row
 *              · 20 card · 99 chip
 *   controls   input h40 pad 0/13 · button h38 pad 9/15 · nav row h39
 *              pad 9/11 gap 11 · segmented h34 pad 7/13 · icon 28
 *   type       15.5/700 page title · 14/700 card title · 13.3 body
 *              · 13/600 button · 12.5/600 segmented · 11.5 caption
 *              · 11 meta · 10.5/700 chip
 *   colour     bg 246,245,241 · surface #fff · surface-2 251,250,247
 *              · border rgba(33,30,20,.1) · fg 28,26,22 · muted 113,109,98
 *              · subtle 156,152,141 · accent 1,129,70
 *   shadow     card 0 6px 24px rgba(33,30,20,.10)
 *              row  0 2px 10px rgba(33,30,20,.06)
 *
 * The headline finding, and the answer to "ours is too big": THEY HAVE NO
 * LARGE PAGE HEADING. The page's name is 15.5px in the top bar, and the
 * biggest thing on a list screen is a card title at 14px. Our scale opened
 * at 24px and stepped down from there, which is why every screen of ours
 * read as roomier and less organised than the same screen of theirs.
 */
export const SCAFFOLD = {
  /** Icon rail — M22, unchanged. */
  railWidth: 60,
  /** Section menu (Settings, Management, apps that need one). */
  menuWidth: 248,
  /** Top bar: breadcrumb + identity. */
  topBarHeight: 62,
  /** Content column, centered; wide variant for data-dense tables. */
  /*
   * THE THREE PAGE SIZES (user directive, 2026-09-02: "now we have three sets
   * of page size — small, normal, big … set it into the theme rule for the
   * whole platform so we can use it later as well, any time I said it").
   *
   *   SMALL   a reading-and-editing surface: a meeting's plan, a profile, a
   *           form. Two columns of cards at most, and the page has a margin
   *           on both sides so the eye is not asked to cross a monitor.
   *   NORMAL  a list surface: the meetings table, settings, management.
   *   BIG     a workspace: the task board, where the content IS the width and
   *           cutting it short cuts off a column.
   *
   * `default`/`wide` are kept as aliases rather than swept, because the words
   * a caller writes should be the words the directive used — and a sweep of
   * every call site to rename two strings is a large diff with nothing to
   * show for it.
   */
  contentMaxWidthSmall: 1040,
  contentMaxWidth: 1240,
  /* contentMaxWidthWide (1600) LEFT on 2026-09-03 with the `big`/`wide`
     page sizes. A token nothing asks for is a size waiting to be picked. */
  /**
   * THE CONTROL FAMILY, one number each and all in the same unit.
   *
   * Measured 2026-09-03, in a browser, at two widths — which is the only way
   * this was ever going to surface. `.btn` and `.btn-icon` took their height
   * from these tokens (rem, so they ride the fluid root font-size), while
   * `.btn-sm` and `.input` had been written as literal px. At 1440, where the
   * root is exactly 16, all four measured right — 38 / 34 / 28 / 40 — and the
   * family looked correct. Below 1440 the two rem controls shrank and the two
   * px ones did not: at 1280 the gap between a button and a COMPACT button had
   * closed from 4px to 2.8, and narrower still it inverts, so the small
   * control is the taller one. On a 1280 laptop — which is most of them.
   *
   * Nothing could see it. The classes were present, the tests were green, the
   * source read as correct, and every measurement anyone had taken was at the
   * baseline width where the two units agree. The whole family is one unit
   * now, so the proportions hold at every width instead of at one.
   */
  controlHeight: 38,
  /** the compact control — segmented tabs, toolbar buttons */
  controlHeightSm: 34,
  /** the square icon button */
  controlHeightIcon: 28,
  /**
   * The assistant's resting strip at the inline-end — the width the SHELL
   * leaves for it so every page centres in the space that is actually there.
   *
   * It is the CLOSED width on purpose. The open panel is the menu's 248 and
   * it floats over the page; reserving that instead would re-flow every
   * screen each time the assistant opened, which the user asked to be undone
   * earlier the same day. One number, two consumers: AssistantSidebar draws
   * the strip at this width and PlatformShell pads by it.
   */
  assistantRail: 48,
  /**
   * THE ASSISTANT PANEL IS 30% OF THE SCREEN (user directive, 2026-09-03:
   * "give 30% of the screen to the ai assistant side bar and make it always
   * be in fix position there for all pages in all stages except in the AI
   * assistant page").
   *
   * A PERCENTAGE, not a pixel count, which is why it is the one entry in this
   * file that is not a number of pixels: every other width here answers "how
   * big should this be", and this one answers "how much of the screen is the
   * assistant's". Written as px it would be 30% of exactly one monitor.
   *
   * The floor is not a hedge — below about 20rem the composer, its control
   * row and a readable answer stop fitting at the same time, and 30% of a
   * 1024px laptop is 307px. So: 30% of the viewport, never so narrow that the
   * thing occupying it stops working.
   */
  assistantPanelPct: 30,
  assistantPanelMin: 320,

  /** the field at md and up */
  fieldHeight: 40,
  /**
   * The touch floor below md — and the one number in this block that is NOT
   * emitted as a rem token. It was, for about ten minutes on 2026-09-03, and
   * measuring at 375 gave 38.5px: a breach of the 44px ruling introduced by
   * the very edit that fixed the family's proportions. A hit-area floor is an
   * ABSOLUTE — 44 means 44 physical pixels under a finger, not 44 scaled by a
   * type ramp — which is why `.tap`'s own ::after is a literal `h-11 w-11`.
   * Kept here as the number's home; globals.css spells it px on purpose.
   */
  fieldHeightTouch: 44,

  /** Typography — the nine roles. Sizes in px. */
  fontSize: {
    /* the reference's scale, measured. Every role came DOWN, which is the
       whole of "ours is too big": a page title that is 24px forces the
       section under it to 20 and the body to 14, and the screen spends its
       height on furniture instead of on the work. */
    pageTitle: 16, // the page's name — theirs is 15.5, rounded to the scale
    sectionTitle: 15, // a block's heading inside a page
    paneTitle: 14, // custom: text-pane-title — menu heading, card title
    body: 13, // text-detail-sized body, form labels, subtitles
    menuItem: 13.5, // custom: text-menu-item — measured EXACTLY at theirs
    detail: 12.5, // custom: text-detail — row descriptions, segmented tabs
    groupLabel: 11, // custom: text-group-label — group labels, table headers
  },

  /** Shape. Radii are GLOBAL theme values (one scale, no per-page radii). */
  radius: {
    /* ARAMEET ADOPTION (2026-08-31): the reference's shapes, measured off
       its running app — buttons and inputs ~11px, cards 20px. One scale,
       still no per-page radii; the whole product rounds together. */
    control: 11, // rounded-md — inputs, buttons (measured: 11)
    panel: 12, // rounded-lg (and DEFAULT) — nav rows, menu pills (12)
    tile: 16, // rounded-xl — list rows and tiles (16)
    modal: 20, // rounded-2xl — cards and dialogs (20)
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
    top: 26,        // desktop: the title's distance from the top bar
    topSm: 20,      // below md, where vertical space is scarcer
    inline: 16,     // below md
    inlineMd: 28,   // desktop gutter
    bottom: 40,     // room under the last section
    /* the menu heading's own top — it has to land on the page title's line,
       so it moves WITH `top` and keeps the optical offset between a 14px
       pane title and a 16px page title (2px now, not 12: both headings came
       down and the gap between them closed with them) */
    menuTop: 24,
    /* the rhythm BETWEEN top-level blocks on a page. Measured at 22 — it was
       an unwritten `py-6` (24) split across every screen that felt like
       writing one. */
    block: 22,
      },

  /**
   * Everything else still rides the STANDARD 4px Tailwind scale — section
   * rhythm 24 = py-6, title→subtitle 4 = mt-1, section title→panel 16 =
   * mb-4, panel row 16x20 = py-4 px-5, panel footer 16x20 = py-4 px-5, menu
   * pill 5x12 = py-[5px] px-3. Those live inside the scaffold components
   * that own them, which is the same rule as above: one place each.
   *
   * audit finding, 2026-09-03: the two panel numbers read 24x32 / 16x32 here
   * long after FormRow moved to px-5 for the fixed-160/380 layout, and the
   * footer had stayed at the 32 this line still promised. Prose describing a
   * component it does not control is exactly what the page rhythm above was
   * made config to stop; these two are corrected rather than kept as a second
   * spelling of the scaffold's own classes.
   */
  spacingDoc: "standard-4px-scale",
} as const;
