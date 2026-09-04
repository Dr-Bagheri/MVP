"use client";

import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";
/* the MODULE, not the barrel: a partial `vi.mock` of `@/components/scaffold`
   anywhere in the suite would otherwise leave this import undefined, and the
   table would crash inside somebody else's test for a reason that has
   nothing to do with their subject */
import { Skeleton } from "@/components/scaffold/Skeleton";
import { KebabMenu, type KebabItem } from "@/components/rowActions";
import { PAGE_SIZE, Pagination, usePaged } from "@/components/Pagination";

/**
 * THE TABLE (user directive, 2026-08-26: "make the style of the records
 * table a default style for all tables in the theme and platform").
 *
 * Every table in the product is this one. The records table earned the
 * shape over a dozen rulings and they are all encoded here, so the next
 * table gets them without anyone remembering:
 *
 *  - the wrapper scrolls, the table does NOT crush its columns
 *    (`min-w-max` — a page-level overflow check certifies a screen as
 *    clean while a third of every row is unreadable);
 *  - the ACTIONS column keeps its space and loses its title, for screen
 *    readers only;
 *  - there is no delete icon and no ⋯ trigger in the row. Every action
 *    lives in ONE menu, opened by RIGHT-CLICKING the row;
 *  - the select checkbox appears under the pointer, and stays visible
 *    once anything is selected — a checkbox column that is always on
 *    spends a column of width on a state most people never enter;
 *  - the whole row is the way in; a cell that is itself interactive
 *    stops the click so a toggle is never also a navigation;
 *  - TEN ROWS, then numbered pages under the table (user directive,
 *    2026-08-27). It lives here rather than in each table for the same
 *    reason as everything above: a rule every caller has to remember is a
 *    rule that holds until the next table. `pageSize={null}` opts out, and
 *    the only honest reason to is a set that is bounded by construction
 *    (a workflow's own steps, the fixed queue list) — there, paging a
 *    complete short list would hide part of one answer behind a click.
 *
 * A table that needs something this does not do should GROW this file,
 * not fork it. The second copy is the one nobody maintains.
 */

export interface Column<T> {
  key: string;
  /** the header's text; omit for the actions column and pass `srOnly` */
  header?: string;
  /** the header exists for screen readers and renders as empty space */
  srOnly?: boolean;
  className?: string;
  headClassName?: string;
  cell: (row: T) => ReactNode;
  /** this cell holds its own controls — a click here is not a row click */
  stopClick?: boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** the row's primary action — omit and the row is not a link */
  onRowClick?: (row: T) => void;
  /** the row's whole action set, at the pointer; omit for a read-only table */
  menuItems?: (row: T) => KebabItem[];
  /** selection — pass all four or none */
  selected?: ReadonlySet<string>;
  onSelect?: (next: Set<string>) => void;
  selectableRow?: (row: T) => boolean;
  /**
   * What the row's checkbox is CALLED. Pass it: "select this row" is the
   * same sentence on every row, which tells a screen-reader user nothing
   * about which one they just ticked. The generic label is only the
   * fallback for a table whose rows have no name to give.
   */
  selectLabel?: (row: T) => string;
  rowClassName?: (row: T) => string;
  /** what stands in for the table when there are no rows at all */
  empty?: ReactNode;
  /**
   * The data has not arrived yet. The table renders its OWN frame — the
   * header row, the borders, the column widths — with skeleton cells where
   * the rows will be, so the section occupies its space from the first paint
   * and nothing moves when the answer lands.
   *
   * It is a separate prop from `rows: []` on purpose: an empty table and a
   * loading table are different statements, and rendering the empty state
   * while a fetch is in flight tells the reader there is nothing when nobody
   * has looked yet.
   */
  loading?: boolean;
  /** how many skeleton rows to reserve — match the usual page, not the max */
  loadingRows?: number;
  /** an extra row rendered at the TOP of the body — the inline add form */
  leadRow?: ReactNode;
  /** rendered under a row when it is expanded (the enrollment panel) */
  rowDetail?: (row: T) => ReactNode;
  /**
   * Rows per page. Ten by default (the house rule); `null` for a set that
   * is bounded by construction and belongs on screen whole.
   */
  pageSize?: number | null;
  className?: string;
  /**
   * Draw no visible header row (user directive, 2026-09-02: the users,
   * speakers and models lists "like the meeting table, with no header").
   * The <thead> stays in the DOM as sr-only — a screen reader still gets the
   * column names, and a person gets rows that read like the meetings list,
   * where the first thing under the toolbar is a record rather than a
   * caption for records.
   */
  hideHeader?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  menuItems,
  selected,
  onSelect,
  selectableRow,
  selectLabel,
  rowClassName,
  empty,
  loading = false,
  loadingRows = 5,
  leadRow,
  rowDetail,
  pageSize = PAGE_SIZE,
  className = "",
  hideHeader = false,
}: DataTableProps<T>) {
  const t = useTranslations("table");
  /* no pointer position to remember any more: the menu hangs off the row's
     own ⋯ button, so Radix places it and the table stops tracking clientX */

  /* MAX_SAFE_INTEGER rather than a branch: hooks cannot be conditional,
     and one page of everything is exactly what "no paging" means — the
     pager then draws nothing on its own account. */
  const { page, setPage, pageCount, visible } = usePaged(rows, pageSize ?? Number.MAX_SAFE_INTEGER);

  const selecting = selected !== undefined && onSelect !== undefined;
  const canSelect = (row: T) => selecting && (selectableRow?.(row) ?? true);
  /* select-all means THIS PAGE: a header checkbox that silently takes rows
     the person cannot see is a delete they did not read */
  const selectable = selecting ? visible.filter(canSelect) : [];
  const allSelected =
    selectable.length > 0 && selectable.every((row) => selected!.has(rowKey(row)));
  /* once ANYTHING is selected the column stops hiding — a checkbox that
     vanishes under the pointer mid-selection is a control that moves */
  const anySelected = selecting && selected!.size > 0;
  /** the total column count, for the detail row's colSpan */
  const span = columns.length + (selecting ? 1 : 0);

  function toggle(row: T): void {
    if (!selecting) return;
    const key = rowKey(row);
    const next = new Set(selected!);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelect!(next);
  }

  /* the empty state answers "there is nothing"; while `loading` it is not
     yet ours to say, so the frame below renders with skeleton rows instead */
  if (!loading && rows.length === 0 && leadRow === undefined && empty !== undefined) {
    return <>{empty}</>;
  }

  return (
    <>
      <div className={`overflow-x-auto ${className}`}>
        {/* the platform's ONE table shape (globals.css `.table-cards`):
            separated card rows in the meetings list's own clothes, so every
            table in the product changed by editing one class rather than
            fifteen screens (user directive, 2026-09-02) */}
        <table className="table-cards w-full min-w-max">
          <thead className={hideHeader ? "sr-only" : undefined}>
            <tr>
              {selecting ? (
                <th className="w-10 px-3 py-3">
                  {selectable.length > 0 ? (
                    <input
                      type="checkbox"
                      aria-label={t("selectAll")}
                      checked={allSelected}
                      className={
                        anySelected
                          ? ""
                          : "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/table:opacity-100"
                      }
                      onChange={() =>
                        onSelect!(
                          allSelected
                            ? new Set()
                            : new Set(selectable.map((row) => rowKey(row))),
                        )
                      }
                    />
                  ) : null}
                </th>
              ) : null}
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`table-head px-4 py-3 ${column.headClassName ?? ""}`}
                >
                  {column.srOnly ? (
                    <span className="sr-only">{column.header}</span>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
              {/* the actions column — named for a screen reader, blank on
                  screen: a heading over a column of ⋯ buttons is a word
                  explaining a glyph that already says it */}
              {menuItems ? (
                <th className="w-12 px-3 py-3">
                  <span className="sr-only">{t("rowActions")}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="group/table">
            {leadRow}
            {/* SKELETON ROWS, inside the real table (user directive: "just the
                information should load in it"). The header, the borders and
                the column widths are structure — they are known before the
                fetch and render with the page; only the cells wait. */}
            {loading
              ? Array.from({ length: loadingRows }, (_, i) => (
                  <tr key={`skeleton-${i}`}>
                    {selecting ? <td className="px-3 py-3" /> : null}
                    {columns.map((_column, c) => (
                      <td key={c} className="px-3 py-3">
                        {/* the FIRST cell wide, the rest narrower — a row of
                            equal bars reads as a rendering fault rather than
                            as a table about to arrive */}
                        <Skeleton className={`h-4 ${c === 0 ? "w-40" : "w-24"}`} />
                      </td>
                    ))}
                    {menuItems ? <td className="px-3 py-3" /> : null}
                  </tr>
                ))
              : null}
            {visible.map((row) => {
              const key = rowKey(row);
              return (
                <Fragment key={key}>
                  <tr
                    /* the row's own border and hover are the theme's now —
                       a card row highlights its EDGE, and the tinted band
                       that used to signal hover reads as a selection */
                    className={`group ${onRowClick ? "row-link" : ""} ${rowClassName?.(row) ?? ""}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selecting ? (
                      <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {canSelect(row) ? (
                          <input
                            type="checkbox"
                            aria-label={selectLabel?.(row) ?? t("selectRow")}
                            checked={selected!.has(key)}
                            /* under the pointer, or whenever a selection
                               is already under way */
                            className={
                              anySelected
                                ? ""
                                : "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                            }
                            onChange={() => toggle(row)}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-4 py-3.5 ${column.className ?? ""}`}
                        onClick={
                          column.stopClick ? (e) => e.stopPropagation() : undefined
                        }
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                    {/*
                      THE ⋯ AT THE END OF THE ROW (user directive, 2026-09-04:
                      "instead of right click kebab menu for all tables in the
                      platform, at the end of the row add the three dot that
                      opens the kebab menu with same details in it, and add
                      this to the platform theme for all").

                      It lives HERE rather than in each table's last column,
                      which is what makes it a theme rule instead of fifteen
                      screens that mostly agree: a table that passes
                      `menuItems` gets the button by BEING a table. The items
                      are the same function the right-click used, so the menu
                      cannot differ between the two ways of opening it — there
                      is now only one way, which is the point of the change.
                      Right-click was a hidden affordance: correct for whoever
                      knew, invisible to everyone else, and this platform has
                      rows whose only actions lived behind it.

                      `stopPropagation` because a row with `onRowClick` is a
                      link, and pressing its menu must not also open the thing
                      the row points at.
                    */}
                    {menuItems ? (
                      <td className="w-12 px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                        {menuItems(row).length > 0 ? (
                          <KebabMenu label={t("rowActions")} items={menuItems(row)} />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                  {rowDetail?.(row) !== undefined && rowDetail(row) !== null ? (
                    <tr className="bg-surface-2/50">
                      <td colSpan={span} className="px-4 py-3">
                        {rowDetail(row)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} onPage={setPage} />

    </>
  );
}

/**
 * The quiet state dot (records' READY, members' ACTIVE, a person's
 * ENROLLED). An ordinary good state is said once, softly — colour is
 * spent on the states worth noticing.
 */
export function StatusDot({
  label,
  tone = "success",
}: {
  label: string;
  tone?: "success" | "muted" | "warning" | "danger";
}) {
  const dot = {
    success: "bg-success",
    muted: "bg-fg-subtle",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
