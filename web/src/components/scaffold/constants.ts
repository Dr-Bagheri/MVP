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
  contentMaxWidth: 1240,
  contentMaxWidthWide: 1600,
  /** Inputs and buttons share it (desktop; below md the 44px hit-area rules). */
  controlHeight: 38,

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
   * mb-4, panel row 24x32 = py-6 px-8, panel footer 16x32 = py-4 px-8, menu
   * pill 5x12 = py-[5px] px-3. Those live inside the scaffold components
   * that own them, which is the same rule as above: one place each.
   */
  spacingDoc: "standard-4px-scale",
} as const;
