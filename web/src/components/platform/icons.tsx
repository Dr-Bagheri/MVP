/**
 * Platform icon set — inline SVG, stroke-based, one visual family.
 *
 * SVG rather than an icon font or emoji (design-system rule). `currentColor`
 * throughout so a single `text-*` class drives the icon, which is what lets the
 * active rail tile flip icon and label together via `--on-accent`.
 */
import type { ReactElement, SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const HomeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5V21H3z" /></svg>
);

/**
 * Points at the PREVIOUS crumb, so it mirrors with the writing direction —
 * "back" is leftward in English and rightward in Persian. The caller flips it
 * rather than the icon guessing, because the icon has no locale.
 */
export const ChevronLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m15 5-7 7 7 7" /></svg>
);

export const UsersIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-1.5-5.6M21 20a5.5 5.5 0 0 0-4-5.3" />
  </svg>
);

export const CogIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" />
  </svg>
);

export const HelpIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.8-.9 1.4v.6" />
    <circle cx="12" cy="17.4" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const GithubIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 19c-4 1.4-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6.2 0C6.6 2.8 5.6 3.1 5.6 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.2 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  </svg>
);

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);

export const MicIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m4 12 16-8-6 8 6 8z" /></svg>
);

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);

export const ToolsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14.5 6.5a4 4 0 0 0 5 5L21 10v4l-9 9-3-3 9-9-3.5-4.5z" /></svg>
);

export const HistoryIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
);

export const MoreIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * Echo's app mark: a record button — filled circle inside a ring — in the ruled
 * soft red `#FF6F59` (M22).
 *
 * The colour is hard-coded rather than tokenised **on purpose**. It is a brand
 * mark, not a UI accent: marks identify, tokens theme. It must look identical
 * in both themes, and it must never become a second accent family — which is
 * precisely what a `--echo` token would invite.
 *
 * `#FF6F59` was chosen by measurement: the obvious soft reds sit within ~35
 * perceptual distance of `--danger`, which would make Echo's launcher read as
 * an error state. This one is 77 away and 7.1:1 on the hub canvas.
 */
export const EchoMark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="13" fill="none" stroke="#FF6F59" strokeWidth="2.5" />
    <circle cx="16" cy="16" r="7" fill="#FF6F59" />
  </svg>
);

/** Maps a nav key to its glyph. Echo is the mark, not an icon. */
export const NAV_ICON: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  hub: HomeIcon,
  management: UsersIcon,
  settings: CogIcon,
  help: HelpIcon,
  github: GithubIcon,
};
