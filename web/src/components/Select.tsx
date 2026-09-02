"use client";

import { useId, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconChevronRight } from "@/components/icons";

/**
 * THE PLATFORM'S DROPDOWN.
 *
 * A native `<select>` paints its option list on the BROWSER's popup sheet, and
 * no stylesheet reaches it: our surface, radius and accent stop at the closed
 * control, and the open list is Chrome's white rectangle with a Windows-blue
 * row. That is why this is drawn rather than native.
 *
 * The PANEL is Radix's, via shadcn's popover, and that replaced a hand-rolled
 * one that had to learn each of these the hard way:
 *
 *  · it does not affect layout (the first version made the profile's role row
 *    taller and pushed Save down the screen),
 *  · it is not clipped by an ancestor with `overflow: hidden`,
 *  · it flips above the trigger when there is no room below,
 *  · and — the one that finally settled it — it works INSIDE A DIALOG. Radix
 *    marks everything outside an open modal `pointer-events: none`, so a
 *    panel portalled to the body by hand renders perfectly and cannot be
 *    clicked. Nesting is not a detail a second implementation gets right.
 *
 * What stays ours is the LISTBOX semantics and one behaviour worth keeping:
 * a value matching no option shows the `placeholder`, never another option's
 * label. A native select shows its first option there, which is a lie about
 * the record even when the record survives it — an org stored as `fa-IR` once
 * displayed as Persian.
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
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? null;

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    onChange(option.value);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        /* the cursor starts on the CURRENT value, so the first arrow press
           moves from where the person is rather than from the top */
        if (next) setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          /* Radix's trigger opens on Enter and Space; a combobox opens on the
             ARROWS too, and the old hand-rolled one did — losing it would be
             a keyboard regression hidden inside an upgrade */
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
              setOpen(true);
            }
          }}
          className={`input flex h-10 w-full items-center justify-between gap-2 text-start disabled:opacity-60 ${className}`}
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
      </PopoverTrigger>

      <PopoverContent
        align="start"
        /* at least as wide as the trigger and free to grow: pinned to the
           control's width a list of long labels truncated every one of them
           to "Pro…", "En…", "De…", and a menu nobody can read is a menu
           nobody can choose from */
        className="w-auto min-w-[var(--radix-popover-trigger-width)] max-w-[min(22rem,80vw)] rounded-xl border-border bg-surface p-1 shadow-island"
        /* the handler belongs on the element that RECEIVES focus. Radix
           focuses the CONTENT, and a keydown on the content does not reach a
           handler bound to its child — the first version put it on the list
           and the arrows did nothing. */
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); return; }
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(cursor); }
        }}
      >
        <ul
          id={listId}
          role="listbox"
          aria-activedescendant={`${listId}-${cursor}`}
          className="max-h-60 overflow-y-auto whitespace-nowrap outline-none"
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
              <span className="min-w-0 flex-1">{option.label}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
