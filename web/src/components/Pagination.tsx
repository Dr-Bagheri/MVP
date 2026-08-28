"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { digits } from "@/lib/format";

/**
 * THE PAGER (user directive, 2026-08-27: "another general rule for tables —
 * show the latest 10 rows, then pages with the numbers at the bottom of the
 * table; apply it to all tables and put it in the theme").
 *
 * One page size, one control, one place. `DataTable` uses it by default, so
 * every table in the product inherits the rule without anyone remembering
 * it; the row-shaped lists that are tables in all but markup import it
 * directly. A second copy is the one nobody maintains — the argument that
 * put every table in one file applies to the thing under every table too.
 *
 * Three decisions worth their lines:
 *
 *  - **Fewer rows than a page renders NOTHING.** A pager under a five-row
 *    table is chrome that answers a question nobody asked, and "1" as the
 *    only page reads as a control that does not work.
 *  - **The page CLAMPS when the row set shrinks.** Filter a list while
 *    standing on page 4 and the honest answer is the last page that
 *    exists, never an empty table under a page number — an empty result
 *    and a page past the end look identical on screen, and only one of
 *    them is true.
 *  - **Direction is the document's.** The row is a plain flex row, so RTL
 *    orders it without a second implementation; only the chevron mirrors,
 *    because an arrow is a picture of a direction and Persian's "next" is
 *    to the left.
 */

/** The house page size. Every table starts here; a caller may widen it. */
export const PAGE_SIZE = 10;

/**
 * Slice `rows` into pages of `size`, clamping the current page whenever the
 * row set changes underneath it (a filter, a refetch, a deletion).
 */
export function usePaged<T>(rows: readonly T[], size: number = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));

  /* the clamp: page 4 of a list that just became one page long is page 1 */
  useEffect(() => {
    setPage((current) => (current > pageCount ? pageCount : current));
  }, [pageCount]);

  const safePage = Math.min(page, pageCount);
  const visible = useMemo(
    () => rows.slice((safePage - 1) * size, safePage * size),
    [rows, safePage, size],
  );

  return { page: safePage, setPage, pageCount, visible, total: rows.length };
}

/**
 * The numbers to draw for `page` of `pageCount`, with `"gap"` where a run
 * was elided. First and last are always present — they are the two a person
 * jumps to without reading — and the current page always sits inside a
 * window of its neighbours, so the control never moves under the pointer.
 */
export function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const out: (number | "gap")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pageCount - 1, page + 1);
  if (from > 2) out.push("gap");
  for (let n = from; n <= to; n += 1) out.push(n);
  if (to < pageCount - 1) out.push("gap");
  out.push(pageCount);
  return out;
}

export function Pagination({
  page,
  pageCount,
  onPage,
  className = "",
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const t = useTranslations("table");
  const locale = useLocale();

  /* one page is not a choice — see the header */
  if (pageCount <= 1) return null;

  const step = (to: number) => () => onPage(Math.min(Math.max(1, to), pageCount));

  return (
    <nav
      aria-label={t("pagination")}
      className={`mt-3 flex flex-wrap items-center justify-center gap-1 ${className}`}
    >
      <button
        type="button"
        className="tap grid h-9 min-w-9 place-items-center rounded-lg px-2 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        aria-label={t("previousPage")}
        disabled={page <= 1}
        onClick={step(page - 1)}
      >
        <Chevron />
      </button>

      {pageWindow(page, pageCount).map((entry, index) =>
        entry === "gap" ? (
          <span key={`gap-${index}`} aria-hidden className="px-1 text-fg-subtle">
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            aria-label={t("goToPage", { page: digits(entry, locale) })}
            aria-current={entry === page ? "page" : undefined}
            className={`tap grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm tabular-nums transition-colors ${
              entry === page
                ? "bg-accent-soft font-semibold text-accent"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg"
            }`}
            onClick={step(entry)}
          >
            {digits(entry, locale)}
          </button>
        ),
      )}

      <button
        type="button"
        className="tap grid h-9 min-w-9 place-items-center rounded-lg px-2 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        aria-label={t("nextPage")}
        disabled={page >= pageCount}
        onClick={step(page + 1)}
      >
        <Chevron next />
      </button>
    </nav>
  );
}

/** A chevron that means "back"/"forward", not "left"/"right" (RTL flips it). */
function Chevron({ next = false }: { next?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-4 w-4 rtl:-scale-x-100 ${next ? "" : "-scale-x-100"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M7.5 4.5 13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
