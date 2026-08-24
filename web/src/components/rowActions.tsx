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
  /** a SUB-menu (2026-08-24, the export group): expands inline under the
      item — flyouts fight small screens; indentation doesn't */
  sub?: KebabItem[];
}

const MENU_W = 176; // matches min-w-44

function MenuEntry({
  item, depth, expanded, setExpanded, close,
}: {
  item: KebabItem;
  depth: number;
  expanded: string | null;
  setExpanded: (key: string | null) => void;
  close: () => void;
}) {
  const isOpen = expanded === item.key;
  return (
    <>
      <button
        type="button"
        role="menuitem"
        disabled={item.disabled}
        onClick={() => {
          if (item.sub) return setExpanded(isOpen ? null : item.key);
          item.onSelect?.();
          if (!item.keepOpen) close();
        }}
        className={`flex w-full items-center gap-2.5 py-2 pe-3 text-start text-xs transition-colors ${
          depth > 0 ? "ps-8" : "ps-3"
        } ${
          item.danger
            ? "text-danger hover:bg-danger/10"
            : "text-fg-muted hover:bg-surface-2 hover:text-fg"
        } disabled:pointer-events-none disabled:opacity-40`}
      >
        {item.icon ? <span className="shrink-0 opacity-80">{item.icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.sub ? <span aria-hidden className="text-[10px]">{isOpen ? "▾" : "▸"}</span> : null}
      </button>
      {item.sub && isOpen
        ? item.sub.map((child) => (
            <MenuEntry
              key={child.key}
              item={child}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
              close={close}
            />
          ))
        : null}
    </>
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
  const [expanded, setExpanded] = useState<string | null>(null);
  /** null = closed; otherwise the VIEWPORT position the portal renders at.
      The menu portals to <body> (user report, 2026-08-24: opening it inside
      a table's overflow container clipped the menu and scrolled the table —
      "the menu should be always on top"). position:fixed + a portal escapes
      every ancestor overflow; any scroll or resize simply closes it. */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function toggle() {
    if (at) return setAt(null);
    setExpanded(null);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rtl = document.documentElement.dir === "rtl";
    const left = rtl ? rect.left : rect.right - MENU_W;
    setAt({
      top: Math.min(rect.bottom + 4, window.innerHeight - 8),
      left: Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8)),
    });
  }

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
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
              className="z-50 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((item) => (
                <MenuEntry
                  key={item.key}
                  item={item}
                  depth={0}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  close={() => setAt(null)}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
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
