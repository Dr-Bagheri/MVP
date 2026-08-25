"use client";

/**
 * The table-row action kit (user directive, 2026-08-24 cleanup): every
 * table stops spelling its actions as a row of text links. The pattern is
 * ONE component set so no table can drift into its own dialect:
 *
 *  - `IconAction` — a bare icon button (pencil-on-hover rename, trash).
 *  - `KebabMenu`  — the ⋯ dropdown holding the secondary actions.
 *  - `ConfirmDialog` — the are-you-sure popup that replaced typed reasons
 *    on product deletes (the LEDGER still receives a reason: a fixed,
 *    platform-authored sentence — the popup's confirm IS the consent).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconDots } from "@/components/icons";

export function IconAction({
  label,
  onClick,
  children,
  danger = false,
  disabled = false,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`tap inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        danger
          ? "text-danger/70 hover:bg-danger/10 hover:text-danger"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      } disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export interface KebabItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** a toggle stays IN the menu when pressed (redact, view modes) */
  keepOpen?: boolean;
  /** a SUB-menu (2026-08-25 redesign, the Supabase reference): a FLYOUT
      panel that steps a little OUT of the parent menu — overlapping its
      edge — instead of indenting inside it. This is the theme's default
      for every kebab everywhere; grouping into subs is also how a long
      menu stays scroll-free (the menu itself never scrolls). */
  sub?: KebabItem[];
}

const MENU_W = 176; // matches min-w-44
const ITEM_H = 34;  // one row's height — the no-scroll placement math

function MenuEntry({
  item, expanded, setExpanded, close,
}: {
  item: KebabItem;
  expanded: string | null;
  setExpanded: (key: string | null, anchor?: DOMRect) => void;
  close: () => void;
}) {
  const isOpen = expanded === item.key;
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup={item.sub ? "menu" : undefined}
      aria-expanded={item.sub ? isOpen : undefined}
      disabled={item.disabled}
      onClick={(e) => {
        if (item.sub) {
          return setExpanded(
            isOpen ? null : item.key,
            (e.currentTarget as HTMLElement).getBoundingClientRect(),
          );
        }
        item.onSelect?.();
        if (!item.keepOpen) close();
      }}
      className={`flex w-full items-center gap-2.5 py-2 pe-3 ps-3 text-start text-xs transition-colors ${
        item.danger
          ? "text-danger hover:bg-danger/10"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      } ${isOpen ? "bg-surface-2 text-fg" : ""} disabled:pointer-events-none disabled:opacity-40`}
    >
      {item.icon ? <span className="shrink-0 opacity-80">{item.icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.sub ? (
        <span aria-hidden className="inline-block text-[10px] rtl:-scale-x-100">▸</span>
      ) : null}
    </button>
  );
}

export function KebabMenu({
  label,
  items,
  trigger,
}: {
  label: string;
  items: KebabItem[];
  /** replaces the ⋯ glyph (e.g. the player's speed readout «۱.۵×») */
  trigger?: ReactNode;
}) {
  const [expanded, setExpandedKey] = useState<string | null>(null);
  /** where the open flyout sits — computed from its parent item's rect */
  const [flyoutAt, setFlyoutAt] = useState<{ top: number; left: number } | null>(null);
  /** null = closed; otherwise the VIEWPORT position the portal renders at.
      The menu portals to <body> (user report, 2026-08-24: opening it inside
      a table's overflow container clipped the menu and scrolled the table —
      "the menu should be always on top"). position:fixed + a portal escapes
      every ancestor overflow; any scroll or resize simply closes it. */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  /**
   * NO-SCROLL PLACEMENT (user directive, 2026-08-25): the menu always opens
   * COMPLETELY — below the trigger when it fits, flipped above it when it
   * doesn't, and it never grows a scrollbar of its own. When a menu wants
   * more rows than a viewport holds, the caller groups them into `sub`
   * flyouts — that is the theme's answer, not scrolling.
   */
  function toggle() {
    if (at) return closeAll();
    setExpandedKey(null);
    setFlyoutAt(null);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rtl = document.documentElement.dir === "rtl";
    const left = rtl ? rect.left : rect.right - MENU_W;
    const height = items.length * ITEM_H + 10;
    const below = rect.bottom + 4;
    const top = below + height <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - 4 - height);
    setAt({
      top,
      left: Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8)),
    });
  }

  function closeAll() {
    setAt(null);
    setExpandedKey(null);
    setFlyoutAt(null);
  }

  /**
   * The flyout steps OUT of the parent menu — outward in the reading
   * direction, overlapping the parent's edge by ~12px (the Supabase-style
   * reference the user pointed at) — and flips to the other side when the
   * viewport ends. Its top clamps so it, too, opens completely.
   */
  function setExpanded(key: string | null, anchor?: DOMRect) {
    setExpandedKey(key);
    if (!key || !anchor || !at) return setFlyoutAt(null);
    const item = items.find((i) => i.key === key);
    const height = (item?.sub?.length ?? 0) * ITEM_H + 10;
    const rtl = document.documentElement.dir === "rtl";
    const outward = rtl ? at.left - MENU_W + 12 : at.left + MENU_W - 12;
    const fits = outward >= 8 && outward + MENU_W <= window.innerWidth - 8;
    const flipped = rtl ? at.left + MENU_W - 12 : at.left - MENU_W + 12;
    setFlyoutAt({
      top: Math.max(8, Math.min(anchor.top - 5, window.innerHeight - height - 8)),
      left: fits ? outward : Math.max(8, Math.min(flipped, window.innerWidth - MENU_W - 8)),
    });
  }

  useEffect(() => {
    if (!at) return;
    const close = () => closeAll();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target)
        && !menuRef.current?.contains(target)
        && !flyoutRef.current?.contains(target)
      ) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeAll is stable in spirit
  }, [at]);

  const openSub = expanded ? items.find((i) => i.key === expanded)?.sub : undefined;

  return (
    <span ref={rootRef} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <IconAction label={label} onClick={toggle} className={trigger ? "w-auto px-1.5" : ""}>
        {trigger ?? <IconDots />}
      </IconAction>
      {at
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: "fixed", top: at.top, left: at.left, minWidth: MENU_W }}
              className="z-50 rounded-lg border border-border bg-surface py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((item) => (
                <MenuEntry
                  key={item.key}
                  item={item}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  close={closeAll}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
      {at && openSub && flyoutAt
        ? createPortal(
            <div
              ref={flyoutRef}
              role="menu"
              style={{ position: "fixed", top: flyoutAt.top, left: flyoutAt.left, minWidth: MENU_W }}
              className="z-[51] rounded-lg border border-border bg-surface py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {openSub.map((child) => (
                <MenuEntry
                  key={child.key}
                  item={child}
                  expanded={null}
                  setExpanded={() => undefined}
                  close={closeAll}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/**
 * A RIGHT-CLICK menu (user directive, 2026-08-25): table rows stopped
 * showing a ⋯ trigger — the same items open as a context menu at the
 * pointer instead. Same panel, same discipline (portal, full open with a
 * flip, outside/Escape/scroll closes). The caller owns the open state:
 * `onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX,
 * y: e.clientY }); }}`.
 */
export function ContextMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number };
  items: KebabItem[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const height = items.length * ITEM_H + 10;
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const left = rtl ? at.x - MENU_W : at.x;
  const top = at.y + height <= window.innerHeight - 8
    ? at.y
    : Math.max(8, at.y - height);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{
        position: "fixed",
        top,
        left: Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8)),
        minWidth: MENU_W,
      }}
      className="z-50 rounded-lg border border-border bg-surface py-1 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <MenuEntry
          key={item.key}
          item={item}
          expanded={null}
          setExpanded={() => undefined}
          close={onClose}
        />
      ))}
    </div>,
    document.body,
  );
}

export interface SelectMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * THE platform dropdown (user directive, 2026-08-25): every select opens a
 * panel styled EXACTLY like the kebab menu — same border, surface, shadow,
 * item hover — instead of the browser's native option list. A theme
 * STRUCTURE item beside KebabMenu: new dropdowns use this; remaining native
 * selects (AuditLogs, OrgFields, profile — their tests grip the native
 * element) swap as they are next touched.
 *
 * Same discipline as the kebab: portal to <body>, fixed position, opens
 * COMPLETELY (flips up when the viewport ends, never scrolls internally),
 * closes on outside click / Escape / scroll / resize.
 */
export function SelectMenu({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  ariaLabel: string;
  /** sizing/spacing for the TRIGGER (defaults to the input look) */
  className?: string;
  disabled?: boolean;
}) {
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.value === value);

  function toggle() {
    if (at) return setAt(null);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 160);
    const rtl = document.documentElement.dir === "rtl";
    const left = rtl ? rect.right - width : rect.left;
    const height = options.length * ITEM_H + 10;
    const below = rect.bottom + 4;
    const top = below + height <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - 4 - height);
    setAt({
      top,
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      width,
    });
  }

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  return (
    <>
      <button
        type="button"
        ref={rootRef}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={at !== null}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={`input flex items-center justify-between gap-2 text-start ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? ""}</span>
        <span aria-hidden className="shrink-0 text-[10px] text-fg-muted">▾</span>
      </button>
      {at
        ? createPortal(
            <div
              ref={panelRef}
              role="listbox"
              aria-label={ariaLabel}
              style={{ position: "fixed", top: at.top, left: at.left, minWidth: at.width }}
              className="z-50 rounded-lg border border-border bg-surface py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  disabled={o.disabled}
                  onClick={() => {
                    setAt(null);
                    if (o.value !== value) onChange(o.value);
                  }}
                  className={`flex w-full items-center gap-2.5 py-2 pe-3 ps-3 text-start text-xs transition-colors ${
                    o.value === value
                      ? "bg-surface-2 font-semibold text-fg"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                  } disabled:pointer-events-none disabled:opacity-40`}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.value === value ? <span aria-hidden className="text-[10px]">✓</span> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {body ? <p className="mt-2 text-sm leading-6 text-fg-muted">{body}</p> : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary h-9 min-h-0 px-4 text-sm" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`${danger ? "btn-danger" : "btn-primary"} h-9 min-h-0 px-4 text-sm`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
