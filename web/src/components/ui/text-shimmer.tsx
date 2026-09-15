"use client";

import { memo, type CSSProperties, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A LABEL THAT IS STILL HAPPENING — a highlight travelling across the word.
 *
 * Ported from 21st.dev's `TextShimmer` (Agent Elements; MIT), the piece its
 * `SearchTool` uses for the pending state: while a tool runs it renders no
 * spinner at all, only `shimmerLabel` with this treatment on it. The API is
 * kept (`as`, `duration`, `spread`, `delay`, both fed in as custom
 * properties) so the upstream examples read straight; the CSS is ours,
 * because the upstream publishes the component and not its stylesheet, and
 * a hand-copied gradient would be a fourth place for our colours to live.
 *
 * ── WHY A SHIMMER SAYS SOMETHING A SPINNER DOES NOT ───────────────────────
 *
 * A spinner is a claim that the PRODUCT is busy; it turns at the same rate
 * beside every sentence and is the same picture whether the wait is a
 * database read or a model call. The shimmer is on the WORDS, so the thing
 * that is alive is the sentence describing what is happening — and when that
 * sentence changes («در حال جست‌وجو…» → «در حال آماده‌سازی…») the reader is
 * being told something rather than reassured.
 *
 * ── THE PARTS THAT ARE NOT DECORATION ─────────────────────────────────────
 *
 * The ink is `--fg-subtle` and the travelling highlight is `--fg`: both are
 * theme tokens `verify-pairs` holds to a contrast floor, so the label is
 * legible at every frame INCLUDING the darkest one. A gradient written in
 * hex would pass a review and fail a measurement.
 *
 * `background-clip: text` needs `color: transparent` to show, and a browser
 * without it would render the label INVISIBLE — the failure mode of a
 * loading indicator being invisible is the one that reads as "nothing is
 * happening". So the transparency is inside an `@supports`, and the fallback
 * is a plainly readable muted label (globals.css).
 *
 * Direction: the highlight travels the way the page reads — the animation
 * runs in reverse under `dir="rtl"` rather than being drawn twice.
 */
export const TextShimmer = memo(function TextShimmer({
  children,
  as: Component = "span",
  className,
  duration = 2,
  spread = 60,
  delay = 0,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** seconds for one pass */
  duration?: number;
  /** how wide the bright band is, in px */
  spread?: number;
  /** seconds before the first pass */
  delay?: number;
}) {
  const style = {
    "--shimmer-duration": `${duration}s`,
    "--shimmer-spread": `${spread}px`,
    animationDelay: delay > 0 ? `${delay}s` : undefined,
  } as CSSProperties;

  return (
    <Component className={cn("text-shimmer", className)} style={style}>
      {children}
    </Component>
  );
});
