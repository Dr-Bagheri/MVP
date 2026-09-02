"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconChevronRight } from "@/components/icons";

/**
 * THE PLATFORM'S DROPDOWN.
 *
 * A native `<select>` paints its option list on the BROWSER's own popup
 * sheet, and no stylesheet reaches it: the platform's surface, border radius
 * and accent stop at the closed control, and the open list is Chrome's white
 * rectangle with a Windows-blue selected row. `globals.css` already goes as
 * far as CSS can — it replaces the chevron and forces the option colours so
 * the list is at least legible — and that ceiling is exactly what the user
 * was looking at when they called the dropdowns ugly.
 *
 * So this is a button and a list, which is the only way the open state can
 * belong to the theme. What it must not lose in the trade is what the native
 * control gave for free, so all of it is here on purpose:
 *
 *   · a real listbox for screen readers (`aria-haspopup`, `aria-expanded`,
 *     `role="listbox"`, `aria-selected` per option),
 *   · keyboard operation — Enter/Space/ArrowDown to open, arrows to move,
 *     Enter to choose, Escape to dismiss, Tab to leave,
 *   · a click outside that closes rather than trapping,
 *   · direction-correctness: the panel is anchored to the inline start, so
 *     it sits under the control in both fa and en.
 *
 * `value` is matched against `options[].value`; an unknown value renders the
 * `placeholder` rather than silently showing a DIFFERENT option's label — a
 * select whose value matches no option shows its first one, which is a lie
 * about the record even when the record survives it.
 */
export interface SelectOption {
  value: string;
  label: string;
  /** an optional colour dot, for labels and column tones */
  dot?: string;
}

export function Select({
  value, options, onChange, placeholder, disabled = false, className = "", ariaLabel, id,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const shell = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (shell.current && !shell.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /* the cursor starts on the CURRENT value, so the first arrow press moves
     from where the person is rather than from the top of the list */
  const openList = () => {
    if (disabled) return;
    setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div ref={shell} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openList();
          }
        }}
        className="input flex h-10 w-full items-center justify-between gap-2 text-start disabled:opacity-60"
      >
        <span className={`flex min-w-0 items-center gap-2 truncate ${selected ? "text-fg" : "text-fg-subtle"}`}>
          {selected?.dot !== undefined ? (
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: selected.dot }} aria-hidden />
          ) : null}
          {selected?.label ?? placeholder ?? ""}
        </span>
        <IconChevronRight
          width={12}
          height={12}
          aria-hidden
          className={`shrink-0 text-fg-subtle transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
        />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`${listId}-${cursor}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); return; }
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(cursor); }
          }}
          ref={(node) => { node?.focus(); }}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-island outline-none"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setCursor(index)}
              onClick={() => choose(index)}
              className={`tap flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs ${
                index === cursor ? "bg-surface-2" : ""
              } ${option.value === value ? "font-semibold text-accent" : "text-fg"}`}
            >
              {option.dot !== undefined ? (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: option.dot }} aria-hidden />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
