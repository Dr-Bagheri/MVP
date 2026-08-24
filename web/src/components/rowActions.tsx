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
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function KebabMenu({ label, items }: { label: string; items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <IconAction label={label} onClick={() => setOpen((v) => !v)}>
        <IconDots />
      </IconAction>
      {open ? (
        <div
          role="menu"
          className="absolute end-0 top-8 z-40 min-w-44 rounded-lg border border-border bg-surface py-1 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-xs transition-colors ${
                item.danger
                  ? "text-danger hover:bg-danger/10"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              } disabled:pointer-events-none disabled:opacity-40`}
            >
              {item.icon ? <span className="shrink-0 opacity-80">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
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
