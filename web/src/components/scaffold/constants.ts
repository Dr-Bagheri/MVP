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
    control: 6, // rounded-md — inputs, buttons, small chips
    panel: 8, // rounded-lg (and DEFAULT) — panels, cards, menu pills
    tile: 12, // rounded-xl — rail tiles, larger surfaces
    modal: 16, // rounded-2xl
  },

  /**
   * Spacing uses the STANDARD 4px Tailwind scale — every blueprint gap maps
   * to an existing step, so no custom spacing entries exist (fewer names to
   * drift). Recorded here as documentation of the mapping, not as config:
   *   page top padding 48 = pt-12 · content inline padding 40 = px-10
   *   section rhythm 24 = py-6 · title→subtitle 4 = mt-1
   *   section title→panel 16 = mb-4 · panel row 24×32 = py-6 px-8
   *   panel footer 16×32 = py-4 px-8 · menu pill 5×12 = py-[5px] px-3
   */
  spacingDoc: "standard-4px-scale",
} as const;
