"use client";

import type { ReactNode } from "react";

/**
 * A titled group inside a navigation menu — the ONE pattern for every grouped
 * menu on the platform.
 *
 * **What went wrong without it.** The Settings sidebar rendered its group titles
 * (پیکربندی / اتصال‌ها / انطباق و سوابق) in `--fg-muted` — the exact colour of
 * its inactive items — with 6px of separation. A user read the whole sidebar as
 * one flat menu, because on the only two axes that signal grouping it said
 * nothing: the titles neither receded nor sat apart. Uppercase and letter-
 * spacing were doing all the work, and they are not enough on their own.
 *
 * Two things carry the grouping here, and they are deliberately both:
 *
 * 1. **Colour — the title RECEDES.** `--fg-subtle` sits closer to the surface
 *    than `--fg-muted` does, so a title reads as a label rather than a
 *    destination. In dark that means lighter-toward-the-surface; in light,
 *    darker. **That is one semantic, not two** — recede means move toward the
 *    surface, and the surface moves with the theme. `verify-pairs.mjs` asserts
 *    both the legibility (≥4.5:1) and the *relationship* (subtle must measure
 *    lower than muted), because a future "improvement" that made labels more
 *    readable would silently restore the flat menu while every contrast check
 *    still passed.
 *
 * 2. **Space — a gap above the group and beneath its title.** Proximity is what
 *    the eye actually uses to group; colour alone would leave items and labels
 *    equally spaced and therefore equally weighted.
 *
 * Used by the Settings sidebar today. Anything else that grows titled groups —
 * a Management sub-nav, sectioned avatar menus, Echo's own menus — uses this
 * rather than approximating it, so one visual rule cannot drift into three.
 */
export function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
        {title}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}
