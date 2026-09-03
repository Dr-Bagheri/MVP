/**
 * The platform's line-icon set (user directive, 2026-08-24, from the sana
 * reference): thin stroke icons for menu items and row actions. Drawn
 * in-house on a 24px grid, 1.7px stroke, rendered at 16px in menus —
 * `currentColor` throughout so active/hover states color them for free.
 * One file so a new surface can never invent a second visual language.
 *
 * THE SIZE SCALE (user directive, 2026-08-26: "I see different sizes of
 * the same icons … make a solid list and only use them so the whole
 * platform becomes unified"). Sizes were being passed per call site as
 * whatever looked right — 12, 14, 15, 17, 18, 26 — which is how one icon
 * ends up three sizes on one screen. The scale below is CLOSED, and
 * icons.guard.test.ts fails the build on a size outside it: a rule that
 * only lives in a comment is a rule the next hurried call site breaks.
 *
 * THE OFF STATE: `<Icon off>` renders the same glyph under a red slash
 * (the `.icon-off` rule in globals.css). Deliberately one overlay rather
 * than 57 hand-drawn "disabled" twins — a second drawing of every icon is
 * 57 more chances for the two to disagree, and the slash is the universal
 * reading of "this one is off".
 */
import type { ReactNode, SVGProps } from "react";

/**
 * The only sizes an icon may be rendered at.
 *
 * `hero` is the newest and the largest: a glyph filling a 96px identity tile
 * (the workflow detail page's mark). It is on the scale rather than passed as
 * a one-off number precisely because that is how the other five got here —
 * the rule is not "no big icons", it is "no size nobody decided on".
 */
export const ICON_SIZE = { xs: 12, sm: 14, md: 16, lg: 18, xl: 24, hero: 40 } as const;
export type IconSize = keyof typeof ICON_SIZE;

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconHistory = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" /><path d="M3.5 4v4.5H8" /><path d="M12 8v4l3 2" /></svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></svg>
);
export const IconZap = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M13 2 4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2Z" /></svg>
);
/* MENTION — the @ that calls an agent into a conversation (2026-09-03). Drawn
   as a ring with a tail rather than typeset, so it sits on the same 24-box,
   stroke weight and cap style as every other glyph here; a text "@" in a
   button is a different size in every font the two locales fall back to. */
export const IconAt = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3.6" /><path d="M15.6 8.4v4.9a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7" /></svg>
);
export const IconAgent = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.7-1.4 1.8-2 3-2s2.3.6 3 2" /><path d="M15 10h4M15 14h3" /></svg>
);
export const IconMic = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3" /></svg>
);
export const IconRows = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3.5" y="4.5" width="17" height="5.4" rx="1.6" /><rect x="3.5" y="14.1" width="17" height="5.4" rx="1.6" /></svg>
);
export const IconFileText = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 3.5h8L19 8.5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" /><path d="M14 3.5V9h5" /><path d="M8.5 13h7M8.5 16.5h7" /></svg>
);
export const IconArchive = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3.5" y="4" width="17" height="4.5" rx="1" /><path d="M5.5 8.5V19A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5" /><path d="M10 12.5h4" /></svg>
);
export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="9.5" cy="8.5" r="3.2" /><path d="M4 19.5c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5" /><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8" /><path d="M17.5 15.3c1.6.7 2.7 2 3.2 4.2" /></svg>
);
/** Speakers: a person mid-speech — arcs, not a second two-person glyph
    (2026-08-24: speakers/users/management had collapsed into one icon). */
export const IconVoice = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5" /><path d="M16.5 6.5a5 5 0 0 1 0 6" /><path d="M19 4.5a8.2 8.2 0 0 1 0 10" /></svg>
);
/** Management·Users: one person, framed — distinct from the rail's pair. */
export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="10" r="2.8" /><path d="M6.8 18.4c1.1-2.4 3-3.6 5.2-3.6s4.1 1.2 5.2 3.6" /></svg>
);
export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.3l-1.8-5.7L4.5 10.8 10.2 9 12 3.5Z" /><path d="M19 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" strokeWidth="1.3" /></svg>
);
/**
 * THE ASSISTANT'S FACE (user directive, 2026-09-03: "choose a robot icon for
 * the assistant").
 *
 * A head with an antenna, two eyes and a mouth line — drawn to the same
 * 24-box, 1.8 stroke and rounded joins as every other glyph here, so it sits
 * in a row beside them without looking imported. The sparkle it replaces said
 * "something clever happens"; this says "somebody answers", which is the
 * thing the button opens.
 *
 * The eyes are FILLED dots rather than stroked circles: at 16px a 1.8-stroke
 * ring closes into a smudge, and two smudges read as a socket rather than a
 * face. `strokeWidth` on them is irrelevant — they are fills — but the
 * radius is what makes them survive the size the rail actually draws at.
 */
export const IconRobot = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3v2.5" /><circle cx="12" cy="2.6" r="1" fill="currentColor" stroke="none" /><rect x="4" y="5.5" width="16" height="12" rx="3.5" /><circle cx="9" cy="10.5" r="1.15" fill="currentColor" stroke="none" /><circle cx="15" cy="10.5" r="1.15" fill="currentColor" stroke="none" /><path d="M9.5 14h5" /><path d="M2 10.5v3M22 10.5v3" /></svg>
);
/**
 * THE RETURN KEY, as the send button's face (user directive, 2026-09-03:
 * "with a little enter icon at the end for sending").
 *
 * The arrow that turns down and back — the glyph printed on the key it stands
 * for, so the button and the Enter shortcut stop being two unrelated facts a
 * person has to learn separately.
 *
 * It is NOT mirrored in RTL, deliberately: this is a picture of a physical
 * key, and the key does not change shape on a Persian keyboard. Flipping it
 * would draw a return arrow that no keyboard has.
 */
export const IconEnter = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 6v5a3 3 0 0 1-3 3H5" /><path d="M8.5 10.5 5 14l3.5 3.5" /></svg>
);
export const IconChip = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5" /></svg>
);
export const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 3.5V8M15 3.5V8" /><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0V8Z" /><path d="M12 17v3.5" /></svg>
);
export const IconPulse = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 12h4l2.5-6.5 4 13L16.5 12h4" /></svg>
);
export const IconPencil = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m4.5 19.5.9-3.6L16.6 4.7a1.8 1.8 0 0 1 2.6 0l.1.1a1.8 1.8 0 0 1 0 2.6L8.1 18.6l-3.6.9Z" /><path d="m14.5 6.5 3 3" /></svg>
);
/**
 * A PUSH PIN, drawn head-on: the round head, the collar, and the point going
 * into the board. The map-marker teardrop was the other candidate and is the
 * wrong idea entirely — that one says "a place", this one says "held down".
 */
/** the theme pair: a sun for the light choice, a crescent for the dark */
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" /></svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></svg>
);
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 3.5h6l-.8 5.2 3.1 2.6a1 1 0 0 1-.6 1.7H7.3a1 1 0 0 1-.6-1.7l3.1-2.6L9 3.5Z" /><path d="M12 13v7.5" /></svg>
);
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4.5 6.5h15" /><path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" /><path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2A1.5 1.5 0 0 0 16.6 19l.9-12.5" /><path d="M10 10.5v6M14 10.5v6" /></svg>
);
export const IconDots = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>
);
export const IconGlobe = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5Z" /></svg>
);
export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="6" cy="12" r="2.5" /><circle cx="17.5" cy="5.5" r="2.5" /><circle cx="17.5" cy="18.5" r="2.5" /><path d="m8.3 10.8 7-4M8.3 13.2l7 4" /></svg>
);
/** Points to inline-END; compose with `rtl:-scale-x-100` where rendered. */
/** close / remove — the X that was a text character in six places */
/** invite — an envelope with a plus: asking somebody in, which is a
    different act from listing the people already here */
export const IconMailPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 15 15H5a1.5 1.5 0 0 1-1.5-1.5v-6Z" /><path d="m3.8 7 6.2 4.2L16.2 7" /><path d="M19 14v6M16 17h6" /></svg>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
/** a flyout's "there is more this way" — reading-direction aware at the
    call site (rtl:-scale-x-100), which a text arrow could not be */
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m9 5 7 7-7 7" /></svg>
);
export const IconChevronEnd = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m9 5.5 6.5 6.5L9 18.5" /></svg>
);
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>
);
export const IconGauge = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 14a8 8 0 1 1 16 0" /><path d="M12 14 15.5 9" /><path d="M4 18h16" /></svg>
);
export const IconGavel = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m13 6 5 5" /><path d="m10.5 8.5 5 5" /><path d="m14.5 4.5 5 5-2 2-5-5 2-2Z" /><path d="m8.5 10.5 5 5-2 2-5-5 2-2Z" /><path d="M3.5 20.5h9" /><path d="m9.5 13.5-5 5" /></svg>
);
export const IconPeople3 = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="7" r="2.5" /><circle cx="5.5" cy="9.5" r="2" /><circle cx="18.5" cy="9.5" r="2" /><path d="M8 19c.5-3 2-4.5 4-4.5s3.5 1.5 4 4.5" /><path d="M2.5 17c.4-2.2 1.5-3.4 3-3.4.8 0 1.5.3 2 .9" /><path d="M21.5 17c-.4-2.2-1.5-3.4-3-3.4-.8 0-1.5.3-2 .9" /></svg>
);
export const IconTag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 11V4.5A1 1 0 0 1 4.5 3.5H11a2 2 0 0 1 1.4.6l7.5 7.5a2 2 0 0 1 0 2.8l-5.5 5.5a2 2 0 0 1-2.8 0L4.1 12.4a2 2 0 0 1-.6-1.4Z" /><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" /></svg>
);

/* ---------------------------------------------------------------------------
 * 2026-08-26: every kebab item carries an icon (user directive), so the set
 * grew to cover the actions that were rendering with a blank gutter. Same
 * 24px grid, same 1.7px stroke — a menu is a column of icons before it is a
 * column of words, and one item without one breaks the column.
 * ------------------------------------------------------------------------ */

/** open / go to — an arrow leaving its box */
export const IconOpen = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 4h6v6" /><path d="m20 4-8.5 8.5" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
/** resume — a play head continuing */
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 5.5v13l10-6.5-10-6.5Z" /></svg>
);
/** pause — two bars */
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 5.5v13" /><path d="M15 5.5v13" /></svg>
);
/** a mark on the take's clock */
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
/**
 * A REAL GEAR — six teeth with an actual toothed silhouette, and a hub.
 *
 * Third drawing for this one mark (user directive, 2026-08-29). The first
 * was a circle ringed by eight radial strokes, which reads as a sun at rail
 * size because unattached ticks never become teeth. The second was sliders,
 * which is a legitimate settings convention and was not what was wanted.
 *
 * A gear survives small sizes only if its OUTLINE is toothed, so this path
 * is computed rather than eyeballed: 6 teeth on a 60-degree period, tip
 * radius 10.4, valley 6.8, giving a 3.6-unit cut that still reads at 16px.
 * Six rather than eight because fewer, chunkier teeth stay legible where
 * eight go mushy — the cut is the thing the eye resolves, not the count.
 */
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9.7 1.9L14.3 1.9L14.3 5.6L16.4 6.8L19.6 4.9L21.9 9.0L18.7 10.8L18.7 13.2L21.9 15.0L19.6 19.1L16.4 17.2L14.3 18.4L14.3 22.1L9.7 22.1L9.7 18.4L7.6 17.2L4.4 19.1L2.1 15.0L5.3 13.2L5.3 10.8L2.1 9.0L4.4 4.9L7.6 6.8L9.7 5.6Z" />
    <circle cx="12" cy="12" r="3.4" />
  </svg>
);

/** a credential — a key, for setting someone's password (0137) */
export const IconKey = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="14" r="4" />
    <path d="M11 11.5 20 3M17.5 5.5 19.5 7.5M15 8l2 2" />
  </svg>
);
/** confirm / finish */
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
/** retry — a circular arrow */
export const IconRetry = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20.5 3.5V8H16" /></svg>
);
/** ask the assistant — a speech bubble with a spark */
export const IconAsk = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20.5 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.2A7.5 7.5 0 1 1 20.5 11.5Z" /><path d="m12 8 .8 2.2L15 11l-2.2.8L12 14l-.8-2.2L9 11l2.2-.8L12 8Z" /></svg>
);
/** export / download */
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 4v10" /><path d="m8 10.5 4 4 4-4" /><path d="M4.5 17.5v1a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1" /></svg>
);
/** copy — two stacked sheets */
export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" /></svg>
);
/** a team / department label */
export const IconTeam = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="8" width="7" height="6" rx="1.5" /><rect x="14" y="8" width="7" height="6" rx="1.5" /><path d="M10 11h4" /><path d="M6.5 14v3.5h11V14" /></svg>
);
/** merge — two paths joining into one */
export const IconMerge = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 3v4c0 3 2.5 4.5 6 5" /><path d="M18 3v4c0 3-2.5 4.5-6 5" /><path d="M12 12v9" /><path d="m9 18 3 3 3-3" /></svg>
);
/** add a voice sample — a mic with a plus */
export const IconMicPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="2.5" width="6" height="10" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 9 6" /><path d="M12 17.5V21" /><path d="M17.5 15h5M20 12.5v5" /></svg>
);
/** remove a voice — a mic with a slash */
export const IconMicOff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 5.5A3 3 0 0 1 15 5.5v4" /><path d="M15 12.4a3 3 0 0 1-4.6 1.4" /><path d="M5.5 11a6.5 6.5 0 0 0 10.2 5.3" /><path d="M18.5 11v0" /><path d="M12 17.5V21" /><path d="m3.5 3.5 17 17" /></svg>
);
/** enable / activate — a switch turned on */
export const IconToggleOn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2.5" y="7" width="19" height="10" rx="5" /><circle cx="16.5" cy="12" r="2.6" fill="currentColor" stroke="none" /></svg>
);
/** disable — the same switch, off */
export const IconToggleOff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2.5" y="7" width="19" height="10" rx="5" /><circle cx="7.5" cy="12" r="2.6" /></svg>
);
/** resize a tile — a frame with corner handles */
export const IconResize = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M8 3.5v3.5H3.5" /><path d="M16 20.5V17h4.5" /></svg>
);
/** move a tile — the four-way arrow */
export const IconMove = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3v18M3 12h18" /><path d="m9 6 3-3 3 3" /><path d="m9 18 3 3 3-3" /><path d="m6 9-3 3 3 3" /><path d="m18 9 3 3-3 3" /></svg>
);
export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 20V4" /><path d="m6 10 6-6 6 6" /></svg>
);
export const IconArrowDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 4v16" /><path d="m6 14 6 6 6-6" /></svg>
);
/** to the very start — an arrow meeting a wall */
export const IconToStart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 4h16" /><path d="M12 20V8" /><path d="m7 13 5-5 5 5" /></svg>
);
export const IconToEnd = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20h16" /><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /></svg>
);
/** hide a tile — an eye with a slash */
export const IconHide = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 12s3.5-6 9-6c1.7 0 3.2.6 4.4 1.4" /><path d="M20.2 9.3c.5.9.8 1.7.8 2.7 0 0-3.5 6-9 6-1.2 0-2.3-.3-3.2-.7" /><circle cx="12" cy="12" r="2.6" /><path d="m3.5 3.5 17 17" /></svg>
);
/** a reading/view mode toggle — an eye */
export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" /><circle cx="12" cy="12" r="2.6" /></svg>
);
/** paragraph mode — stacked text lines */
export const IconParagraph = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h16" /><path d="M4 10h16" /><path d="M4 14h11" /><path d="M4 18h11" /></svg>
);
/** an outline / table of contents */
export const IconOutline = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h4" /><path d="M11 6h9" /><path d="M4 12h4" /><path d="M11 12h9" /><path d="M4 18h4" /><path d="M11 18h9" /></svg>
);
/** a filter / clean-read broom */
export const IconFilter = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 5h17l-6.5 7.5V19l-4 2v-8.5L3.5 5Z" /></svg>
);
/** redaction — a struck-through block */
export const IconRedact = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3.5" y="6" width="17" height="5" rx="1" fill="currentColor" stroke="none" /><path d="M4 15h10" /><path d="M4 19h7" /></svg>
);
/** a printed page */
export const IconPrint = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M7 9V3.5h10V9" /><rect x="3.5" y="9" width="17" height="7" rx="2" /><path d="M7 14h10v6.5H7V14Z" /></svg>
);
/** a loudspeaker with waves — the OUTPUT device (the mic is the input) */
export const IconSpeaker = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" /><path d="M16.5 9a4.2 4.2 0 0 1 0 6" /><path d="M19 6.8a8 8 0 0 1 0 10.4" /></svg>
);
/** a plain envelope — mail as a SOURCE. `mailPlus` is the invite (asking
    somebody in); a workflow reading an inbox is neither inviting nor
    composing, and reusing the plus would say it was. */
export const IconMail = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.4 7 8.6 6 8.6-6" /></svg>
);
/** a paper plane: the mail workflow SENDS, and db/0065 calls its icon `send`.
    Drawn open (a stroke outline, not a filled dart) so it reads at 40px in a
    tile the same way the envelope and the calendar do. */
export const IconSend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M21 3.5 10.8 13.7" /><path d="M21 3.5 14.6 21l-3.8-7.3L3.5 9.9z" /></svg>
);
/** a month grid — calendar as a SOURCE, beside the envelope */
export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17" /><path d="M8 3.5v3M16 3.5v3" /></svg>
);
/** a folder — Drive as a SOURCE (your files), not the provider's brand
    triangle: source marks stay in the house line style, and brand assets
    are remote (CSP) anyway */
export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2L11.2 8H19a1.5 1.5 0 0 1 1.5 1.5V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17Z" /></svg>
);
/** a camera — Meet as a SOURCE: the meetings you join on video */
export const IconVideo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="7" width="12" height="10" rx="2" /><path d="m15 12 6-3.5v7z" /></svg>
);
/** a caution triangle — something about THIS content needs reading before it
    is trusted (the summary's grounding flags). Deliberately not the danger
    trash/close family: nothing is destroyed and nothing failed; a claim is
    unsupported, which is a thing to look at, not a thing to undo. */
export const IconWarn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3.8 21 19.4a1.4 1.4 0 0 1-1.2 2.1H4.2A1.4 1.4 0 0 1 3 19.4L12 3.8Z" /><path d="M12 9.5v4.4" /><circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none" /></svg>
);

/* =========================================================================
   THE LIST — one registry, one vocabulary
   =========================================================================
   Every icon in the platform, by name. A surface that needs a glyph looks
   it up here rather than importing a component and picking a size, which
   is how the set drifted into six sizes and a handful of text characters
   standing in for icons (＋, ✕, ▸ were all doing icon work).
   =======================================================================*/
export const ICONS = {
  "agent": IconAgent,
  "at": IconAt,
  "archive": IconArchive,
  "arrowDown": IconArrowDown,
  "arrowUp": IconArrowUp,
  "ask": IconAsk,
  "calendar": IconCalendar,
  "check": IconCheck,
  "chevronEnd": IconChevronEnd,
  "chevronRight": IconChevronRight,
  "chip": IconChip,
  "clock": IconClock,
  "close": IconClose,
  "copy": IconCopy,
  "dots": IconDots,
  "download": IconDownload,
  "eye": IconEye,
  "fileText": IconFileText,
  "filter": IconFilter,
  "folder": IconFolder,
  "gauge": IconGauge,
  "gavel": IconGavel,
  "globe": IconGlobe,
  "hide": IconHide,
  "key": IconKey,
  "history": IconHistory,
  "mail": IconMail,
  "send": IconSend,
  "mailPlus": IconMailPlus,
  "merge": IconMerge,
  "mic": IconMic,
  "micOff": IconMicOff,
  "micPlus": IconMicPlus,
  "move": IconMove,
  "open": IconOpen,
  "outline": IconOutline,
  "paragraph": IconParagraph,
  "pause": IconPause,
  "pencil": IconPencil,
  "people3": IconPeople3,
  "pin": IconPin,
  "sun": IconSun,
  "moon": IconMoon,
  "play": IconPlay,
  "plug": IconPlug,
  "plus": IconPlus,
  "print": IconPrint,
  "pulse": IconPulse,
  "redact": IconRedact,
  "resize": IconResize,
  "retry": IconRetry,
  "rows": IconRows,
  "search": IconSearch,
  "settings": IconSettings,
  "share": IconShare,
  "enter": IconEnter,
  "robot": IconRobot,
  "sparkle": IconSparkle,
  "speaker": IconSpeaker,
  "tag": IconTag,
  "team": IconTeam,
  "toEnd": IconToEnd,
  "toStart": IconToStart,
  "toggleOff": IconToggleOff,
  "toggleOn": IconToggleOn,
  "trash": IconTrash,
  "upload": IconUpload,
  "user": IconUser,
  "users": IconUsers,
  "video": IconVideo,
  "voice": IconVoice,
  "warn": IconWarn,
  "zap": IconZap,
} as const;
export type IconName = keyof typeof ICONS;

/**
 * The one way to render an icon.
 *
 * `size` comes from the closed scale; `off` draws the disabled state — the
 * same glyph under a red slash, so "unavailable" reads identically
 * wherever it appears instead of each surface inventing a grey.
 *
 * The slash is drawn by `.icon-off` in globals.css over a wrapper, not
 * baked into 57 second drawings: two drawings of one icon are two things
 * to keep in step, and only one of them ever gets updated.
 */
export function Icon({
  name,
  size = "md",
  off = false,
  className = "",
  title,
}: {
  name: IconName;
  size?: IconSize;
  /** the DISABLED reading: the glyph, struck through in the danger tone */
  off?: boolean;
  className?: string;
  title?: string;
}): ReactNode {
  const Glyph = ICONS[name];
  const px = ICON_SIZE[size];
  return (
    <span
      className={`icon${off ? " icon-off" : ""} ${className}`}
      style={{ width: px, height: px }}
      title={title}
      data-icon={name}
    >
      <Glyph width={px} height={px} />
    </span>
  );
}
