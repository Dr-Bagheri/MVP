/**
 * THE SIDE SUB-MENU — the home page's column, as tokens (user ruling,
 * 2026-09-15: "in case of the home we have the second sub menu on the side;
 * other pages do not have it, but if for some reason we need to add it later
 * for some page it must follow the home side menu style").
 *
 * Home is the one surface with a menu beside the page today, and the next
 * one — whichever page grows one — reads these two strings rather than
 * re-deriving them. `SectionMenu` (the scaffold's vertical menu, the
 * conversations page's) reads the row from here too, so a vertical menu has
 * one face in the product wherever it stands.
 *
 * The column is `glass-soft`: the sheet's tone at a third of the chrome's
 * alpha, calibrated on 2026-09-08 to sit beside a thread without reading as a
 * second header. What separates it from the page is the TONE and the seam
 * against the content, never a pane border.
 */

/** the column: the soft sheet, the menu width, the seam toward the page */
export const SIDE_MENU_COLUMN =
  "glass-soft flex h-full w-64 shrink-0 flex-col overflow-hidden border-e border-fg/[.07] px-2 py-3";

/**
 * One row: the menu-item corner, the recessed ground when chosen or under the
 * pointer. A `sub` row — a route menu's child entry — indents and steps its
 * type down; it is the same row otherwise, which is the point.
 */
export function sideMenuRowClass(active: boolean, variant: "row" | "sub" = "row"): string {
  const size = variant === "sub" ? "ps-8 pe-3 text-xs" : "px-2 text-sm";
  return `flex w-full items-center gap-2 rounded-lg py-1.5 text-start font-medium transition-colors ${size} ${
    active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
  }`;
}
