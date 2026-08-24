/**
 * The platform's line-icon set (user directive, 2026-08-24, from the sana
 * reference): thin stroke icons for menu items and row actions. Drawn
 * in-house on a 24px grid, 1.7px stroke, rendered at 16px in menus —
 * `currentColor` throughout so active/hover states color them for free.
 * One file so a new surface can never invent a second visual language.
 */
import type { SVGProps } from "react";

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
export const IconChevronEnd = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m9 5.5 6.5 6.5L9 18.5" /></svg>
);
export const IconTag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 11V4.5A1 1 0 0 1 4.5 3.5H11a2 2 0 0 1 1.4.6l7.5 7.5a2 2 0 0 1 0 2.8l-5.5 5.5a2 2 0 0 1-2.8 0L4.1 12.4a2 2 0 0 1-.6-1.4Z" /><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" /></svg>
);
