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
export const CogIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9.7 1.9L14.3 1.9L14.3 5.6L16.4 6.8L19.6 4.9L21.9 9.0L18.7 10.8L18.7 13.2L21.9 15.0L19.6 19.1L16.4 17.2L14.3 18.4L14.3 22.1L9.7 22.1L9.7 18.4L7.6 17.2L4.4 19.1L2.1 15.0L5.3 13.2L5.3 10.8L2.1 9.0L4.4 4.9L7.6 6.8L9.7 5.6Z" />
    <circle cx="12" cy="12" r="3.4" />
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
  /*
   * The plane points INLINE-FORWARD: the path aims left (RTL-forward, right
   * for fa), so LTR flips it — the user caught it aiming backwards in the
   * English UI. Baked into the icon rather than each call site, so no usage
   * can point backwards again.
   */
  <svg {...base(p)} className={`ltr:-scale-x-100 ${p.className ?? ""}`}>
    <path d="m4 12 16-8-6 8 6 8z" />
  </svg>
);

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);

export const DocumentIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v5h5M9 12h6M9 16h6" />
  </svg>
);

export const ToolsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m5 19 8-8 3 3-8 8z" />
    <path d="M17 3v4M15 5h4" />
  </svg>
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
export const EchoMark = ({
  size = 22,
  tone = "brand",
}: {
  size?: number;
  /**
   * "brand" is the ruled Echo red; "current" inherits the surrounding
   * colour (2026-08-26, the record button — the mark sits ON a red fill
   * there, and a brand-red mark on a red button is invisible). Same
   * drawing either way: the mark is the mark, the ink is the context's.
   */
  tone?: "brand" | "current";
}) => {
  const ink = tone === "brand" ? "#FF6F59" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke={ink} strokeWidth="2.5" />
      <circle cx="16" cy="16" r="7" fill={ink} />
    </svg>
  );
};

/** Maps a nav key to its glyph. Echo is the mark, not an icon. */
export const PlugIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <path d="M9 7V3M15 7V3" />
    <path d="M6 7h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V7z" />
    <path d="M12 17v4" />
  </svg>
);

/**
 * The rail's DASHBOARD tile (2026-08-25) — a four-pane board, the shape
 * every dashboard in every product wears; it reads as "the overview" at
 * 18px where a gauge needle does not.
 */
export const BoardIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <rect x="3.5" y="3.5" width="7" height="8.5" rx="1.6" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.6" />
    <rect x="3.5" y="15" width="7" height="5.5" rx="1.6" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.6" />
  </svg>
);

/**
 * The ASSISTANT's own tile (2026-08-25, replacing the house): a spark —
 * the orb's grammar in a line icon, and unmistakably "the intelligence"
 * rather than "home".
 */
export const AssistantIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <path d="M12 3.5 13.7 8.3 18.5 10 13.7 11.7 12 16.5 10.3 11.7 5.5 10 10.3 8.3 12 3.5Z" />
    <path d="M18 16.5 18.7 18.3 20.5 19 18.7 19.7 18 21.5 17.3 19.7 15.5 19 17.3 18.3 18 16.5Z" />
  </svg>
);

/** The TASK BOARD's tile (0144): a checklist — lines with their marks. */
const TasksIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <path d="m3.5 6 1.2 1.2L7 4.9" />
    <path d="m3.5 12 1.2 1.2L7 10.9" />
    <path d="m3.5 18 1.2 1.2L7 16.9" />
    <path d="M10.5 6.2H20.5M10.5 12.2H20.5M10.5 18.2H20.5" />
  </svg>
);

/** MEETINGS (0145): a calendar page with a marked slot. */
const MeetingsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    <path d="M8 14.5h4" />
  </svg>
);

export const NAV_ICON: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  dashboard: BoardIcon,
  tasks: TasksIcon,
  meetings: MeetingsIcon,
  assistant: AssistantIcon,
  hub: HomeIcon,
  history: HistoryIcon,
  search: SearchIcon,
  integrations: PlugIcon,
  management: UsersIcon,
  settings: CogIcon,
  help: HelpIcon,
  github: GithubIcon,
};
