import type { SVGProps } from "react";

/**
 * THE FLOW'S PICTURES — drawn in-house, in the theme's own tokens.
 *
 * The reference pairs every question with a warm line illustration; ours
 * are the same idea in our palette: `currentColor` strokes on a `text-fg`
 * parent, the accent as the one colour, `--warning` and `--info` as the two
 * warm and cool companions. Nothing is imported, so nothing is somebody
 * else's brand — and every one scales with its column because it is a
 * viewBox, not a bitmap.
 *
 * One file, one visual language: a new step gets a scene HERE or reuses
 * one, never a picture from a stock site that reads as a different product.
 */
const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 480 360",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

/** a conversation becoming notes: two bubbles, a page, the wave between them */
export function SceneConversation(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="52" y="70" width="200" height="86" rx="26" className="fill-accent-soft" />
      <path d="M92 156 l-14 34 l40 -34" className="fill-accent-soft" />
      <rect x="228" y="150" width="200" height="86" rx="26" className="fill-warning/20" />
      <path d="M392 236 l14 34 l-40 -34" className="fill-warning/20" />
      <path d="M88 98 h128 M88 118 h96 M88 138 h60" strokeOpacity=".55" />
      <path d="M264 178 h128 M264 198 h96 M264 218 h60" strokeOpacity=".55" />
      <path d="M60 296 q20 -40 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" className="stroke-accent" strokeWidth="4" />
      <rect x="330" y="40" width="96" height="86" rx="12" />
      <path d="M350 64 h56 M350 82 h56 M350 100 h36" strokeOpacity=".55" />
      <circle cx="418" cy="48" r="10" className="fill-accent" stroke="none" />
    </svg>
  );
}

/** two framed pictures, «meetings» and «assistant» — the goals step */
export function SceneFrames(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="36" y="60" width="196" height="240" rx="10" className="fill-surface" />
      <rect x="52" y="76" width="164" height="150" rx="6" strokeOpacity=".5" />
      <circle cx="134" cy="150" r="22" className="fill-accent-soft" />
      <path d="M134 128 v-14 M118 150 h-16 M166 150 h-16 M134 172 v14" className="stroke-accent" />
      <path d="M96 208 q10 -18 20 0 t20 0 t20 0 t20 0" className="stroke-accent" strokeWidth="4" />
      <path d="M84 258 h100" strokeOpacity=".5" strokeWidth="5" />
      <rect x="248" y="60" width="196" height="240" rx="10" className="fill-surface" />
      <rect x="264" y="76" width="164" height="150" rx="6" strokeOpacity=".5" />
      <path d="M346 116 l8 20 l20 8 l-20 8 l-8 20 l-8 -20 l-20 -8 l20 -8 z" className="fill-warning/40 stroke-warning" />
      <rect x="284" y="180" width="124" height="30" rx="15" className="fill-accent-soft" />
      <path d="M298 195 h64" strokeOpacity=".6" />
      <path d="M296 258 h100" strokeOpacity=".5" strokeWidth="5" />
    </svg>
  );
}

/** three tilted portraits with speech — the work step */
export function ScenePeople(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <g transform="rotate(-8 130 190)">
        <rect x="40" y="90" width="180" height="200" rx="10" className="fill-surface" />
        <circle cx="130" cy="160" r="30" className="fill-accent-soft" />
        <path d="M80 250 q50 -50 100 0" className="fill-accent-soft" />
        <circle cx="118" cy="156" r="3" className="fill-fg" stroke="none" />
        <circle cx="142" cy="156" r="3" className="fill-fg" stroke="none" />
        <path d="M122 172 q8 6 16 0" />
      </g>
      <g transform="rotate(5 300 190)">
        <rect x="210" y="70" width="180" height="200" rx="10" className="fill-surface" />
        <circle cx="300" cy="140" r="30" className="fill-warning/30" />
        <path d="M250 230 q50 -50 100 0" className="fill-warning/30" />
        <circle cx="288" cy="136" r="3" className="fill-fg" stroke="none" />
        <circle cx="312" cy="136" r="3" className="fill-fg" stroke="none" />
        <path d="M292 152 q8 6 16 0" />
      </g>
      <rect x="360" y="40" width="96" height="52" rx="26" className="fill-accent-soft" />
      <path d="M380 66 q6 -12 12 0 t12 0 t12 0 t12 0" className="stroke-accent" />
      <rect x="20" y="300" width="96" height="44" rx="22" className="fill-info/20" />
      <path d="M40 322 q6 -10 12 0 t12 0 t12 0 t12 0" className="stroke-info" />
    </svg>
  );
}

/** a desk with a screen and things flying into it — the places step */
export function SceneDesk(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M60 300 h360" strokeWidth="5" />
      <path d="M100 300 v40 M380 300 v40" />
      <rect x="190" y="130" width="180" height="120" rx="10" className="fill-surface" />
      <path d="M280 250 v50 M240 300 h80" />
      <rect x="206" y="146" width="148" height="88" rx="6" className="fill-accent-soft" />
      <path d="M222 168 h64 M222 188 h100 M222 208 h80" className="stroke-accent" strokeOpacity=".8" />
      <circle cx="120" cy="200" r="28" className="fill-warning/30" />
      <path d="M92 260 q28 -40 56 0" className="fill-warning/30" />
      <circle cx="110" cy="196" r="3" className="fill-fg" stroke="none" />
      <circle cx="130" cy="196" r="3" className="fill-fg" stroke="none" />
      <rect x="392" y="80" width="64" height="44" rx="8" className="fill-info/20" />
      <path d="M392 88 l32 22 l32 -22" className="stroke-info" />
      <path d="M380 130 q-30 40 -60 60" strokeDasharray="6 8" strokeOpacity=".6" />
      <rect x="60" y="60" width="72" height="52" rx="8" className="fill-accent-soft" />
      <path d="M74 78 h44 M74 94 h28" className="stroke-accent" />
    </svg>
  );
}

/** a folder with a lock — the data step */
export function SceneLock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M80 140 h110 l24 24 h186 v150 a12 12 0 0 1 -12 12 h-296 a12 12 0 0 1 -12 -12 z" className="fill-warning/30" />
      <path d="M80 180 h320 v134 a12 12 0 0 1 -12 12 h-296 a12 12 0 0 1 -12 -12 z" className="fill-warning/40" />
      <rect x="300" y="60" width="110" height="130" rx="10" transform="rotate(12 355 125)" className="fill-accent-soft stroke-accent" />
      <path d="M330 100 l40 6 M326 124 l50 8" className="stroke-accent" />
      <circle cx="180" cy="120" r="46" className="fill-fg" stroke="none" />
      <rect x="158" y="112" width="44" height="34" rx="6" className="fill-bg" stroke="none" />
      <path d="M166 112 v-10 a14 14 0 0 1 28 0 v10" className="stroke-bg" strokeWidth="5" />
      <circle cx="180" cy="128" r="4" className="fill-fg" stroke="none" />
      <path d="M120 230 v50 M144 216 v64 M168 240 v40 M192 220 v60" className="stroke-fg" strokeWidth="6" />
    </svg>
  );
}

/** a paper plane with speed lines — the "faster" reveal */
export function ScenePlane(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M100 200 l300 -110 l-60 240 l-70 -80 z" className="fill-accent-soft" />
      <path d="M340 90 l-130 160 M210 250 l60 80" />
      <path d="M40 150 h70 M20 190 h90 M46 230 h60" className="stroke-warning" strokeWidth="5" />
      <path d="M380 250 q40 -10 50 30" className="stroke-warning" strokeWidth="5" />
      <circle cx="430" cy="284" r="8" className="fill-warning" stroke="none" />
    </svg>
  );
}

/** a clock with the saved hours as a wedge — the savings screen's picture */
export function SceneClock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="240" cy="180" r="120" className="fill-surface" />
      <path d="M240 180 L240 60 A120 120 0 0 1 344 120 z" className="fill-accent-soft" stroke="none" />
      <circle cx="240" cy="180" r="120" />
      <path d="M240 72 v14 M348 180 h-14 M240 288 v-14 M132 180 h14" />
      <path d="M240 180 L240 96" className="stroke-accent" strokeWidth="6" />
      <path d="M240 180 L300 214" strokeWidth="6" />
      <circle cx="240" cy="180" r="7" className="fill-fg" stroke="none" />
      <path d="M400 70 l6 16 l16 6 l-16 6 l-6 16 l-6 -16 l-16 -6 l16 -6 z" className="fill-warning/40 stroke-warning" />
      <path d="M70 250 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" className="fill-warning/40 stroke-warning" />
      <path d="M60 110 h40 M50 140 h60" className="stroke-warning" strokeWidth="5" />
    </svg>
  );
}

/** the soft swash behind the centred steps — a wave, not a wallpaper */
export function Watermark() {
  return (
    <svg
      viewBox="0 0 1200 600"
      className="pointer-events-none absolute inset-0 h-full w-full text-fg"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="70"
      strokeLinecap="round"
      strokeOpacity=".045"
    >
      <path d="M-80 420 C 120 120, 320 120, 520 420 S 920 720, 1120 420 S 1520 120, 1720 420" />
      <path d="M-80 160 C 120 -140, 320 -140, 520 160 S 920 460, 1120 160" />
    </svg>
  );
}
