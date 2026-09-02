import type { ReactNode } from "react";

/**
 * A PANEL'S HEADER — the platform's one answer to "a titled box with
 * something to press in it".
 *
 * User directive, 2026-09-02: "look at the position of the full calendar, in
 * the same row with upcoming meetings, and it has a divider. Make it like
 * this — and not just for this, for all items that need it. Make it a rule in
 * the theme for the whole platform."
 *
 * What it replaces is a title, and then a link on the line UNDER it. That
 * costs a whole row of a small card to say something the title's own row had
 * space for, and it puts the action where a reader has already started
 * scanning content — so the first item in the list reads as the second thing
 * in the panel.
 *
 * The hairline is part of the header rather than something a panel draws when
 * somebody remembers to: that is how half the platform ended up with one and
 * half without, which is the same reasoning `PageHeader` carried before the
 * page title itself went.
 *
 * `action` is deliberately a NODE and not an href: some panels navigate, some
 * open a composer, and a header that only accepted a link would send the
 * second kind back to hand-rolling the row.
 */
export function PanelHeader({
  icon,
  title,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`mb-2.5 flex items-center gap-3 border-b border-border pb-2 ${className}`}
    >
      {icon !== undefined ? <span className="tile-chip shrink-0">{icon}</span> : null}
      <h2 className="min-w-0 flex-1 select-none truncate text-base font-semibold text-fg">
        {title}
      </h2>
      {/* the action sits at the row's END and never wraps: a two-word link
          that breaks onto its own line has re-created the shape this exists
          to remove */}
      {action !== undefined ? (
        <span className="shrink-0 whitespace-nowrap text-xs">{action}</span>
      ) : null}
    </header>
  );
}
