"use client";

import { Fragment, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ContextMenu, type KebabItem } from "@/components/rowActions";

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
 *    stops the click so a toggle is never also a navigation.
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
  /** an extra row rendered at the TOP of the body — the inline add form */
  leadRow?: ReactNode;
  /** rendered under a row when it is expanded (the enrollment panel) */
  rowDetail?: (row: T) => ReactNode;
  className?: string;
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
  leadRow,
  rowDetail,
  className = "",
}: DataTableProps<T>) {
  const t = useTranslations("table");
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);

  const selecting = selected !== undefined && onSelect !== undefined;
  const canSelect = (row: T) => selecting && (selectableRow?.(row) ?? true);
  const selectable = selecting ? rows.filter(canSelect) : [];
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

  if (rows.length === 0 && leadRow === undefined && empty !== undefined) {
    return <>{empty}</>;
  }

  return (
    <>
      <div className={`overflow-x-auto ${className}`}>
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border">
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
            </tr>
          </thead>
          <tbody className="group/table">
            {leadRow}
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <Fragment key={key}>
                  <tr
                    className={`group border-b border-border last:border-0 ${
                      onRowClick ? "row-link" : "transition-colors hover:bg-surface-2"
                    } ${rowClassName?.(row) ?? ""}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onContextMenu={
                      menuItems
                        ? (e) => {
                            if (menuItems(row).length === 0) return;
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, key });
                          }
                        : undefined
                    }
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
                        className={`px-4 py-3 ${column.className ?? ""}`}
                        onClick={
                          column.stopClick ? (e) => e.stopPropagation() : undefined
                        }
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {rowDetail?.(row) !== undefined && rowDetail(row) !== null ? (
                    <tr className="border-b border-border bg-surface-2/50 last:border-0">
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

      {menu !== null && menuItems !== undefined ? (() => {
        const row = rows.find((candidate) => rowKey(candidate) === menu.key);
        if (!row) return null;
        return (
          <ContextMenu
            at={menu}
            onClose={() => setMenu(null)}
            items={menuItems(row)}
          />
        );
      })() : null}
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
