"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IconCalendar, IconChevronRight, IconClock } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { asciiDigits, digits, formatDate, monthGridAt } from "@/lib/format";

/**
 * THE PLATFORM'S DATE AND TIME PICKERS.
 *
 * `<input type="date">` and `<input type="time">` hand the browser the whole
 * job, and the browser answers in ITS calendar: on a Persian-first product
 * the field read 09/02/2026 and its popup was a Gregorian month grid with
 * English weekday initials. There is no styling or attribute that changes
 * that — the control is drawn by Chrome, not by this stylesheet — which is
 * the same ceiling the native `<select>` hit and the same answer: draw it.
 *
 * So these are a button and a panel. The date panel is the reference
 * product's own shape (presets, a month header with arrows, a Jalali grid);
 * the time panel is its two columns of hours and minutes.
 *
 * The VALUE stays what it was — `YYYY-MM-DD` and `HH:mm`, ASCII, the shapes
 * a form submits and a server parses. Only the reading is Persian; a picker
 * that also changed the value would have moved the calendar problem into the
 * wire, where every consumer would meet it again.
 */

/** `YYYY-MM-DD` in and out — the panel is only how it is read and chosen */
export function DateField({ value, onChange, id }: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const grid = useMemo(() => monthGridAt(new Date(), locale, offset), [locale, offset]);

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  /** today + n days, as the form's own `YYYY-MM-DD` */
  const relative = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  };

  const preset = (label: string, days: number) => (
    <button
      type="button"
      onClick={() => pick(relative(days))}
      /* 2026-09-03: the theme's compact control, not a twelfth invented size.
         This chip and the one doing the identical job in the board's picker
         (tasks/JalaliPicker.tsx) were two spellings of one thing — 32px/12px
         corner/11px muted here, 32px/12px/11.5px solid there — which is the
         "ten different developers" complaint inside two panels that offer the
         same four presets. Both are `.btn-sm` now, in the spelling
         EchoSectionMenu already used. `.btn` draws NO border, so the outline
         that made this read as a chip is asked for explicitly. */
      className="btn btn-sm border border-border font-medium text-fg-muted hover:border-border-strong hover:text-fg"
    >
      {label}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        /* `h-10` came off here on 2026-09-03. `.input` is 44px below md and 40
           from md up, deliberately: it renders no `.tap` pseudo-element, so an
           input's VISUAL height IS its hit area. A restated `h-10` pinned 40 at
           every width — which put this field under the 44px ruling on a phone
           AND four pixels shorter than the title box in the same dialog, where
           the title box is a bare `.input`. */
        className="input flex w-full items-center justify-between gap-2 text-start"
      >
        <span className="truncate text-fg">
          {value === "" ? t("pickDate") : formatDate(`${value}T00:00:00`, locale)}
        </span>
        <IconCalendar width={14} height={14} className="shrink-0 text-fg-subtle" aria-hidden />
      </button>

      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-xl border-border bg-surface p-2 shadow-island">
        <div className="w-72">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {preset(t("dateToday"), 0)}
            {preset(t("dateTomorrow"), 1)}
            {preset(t("dateNextWeek"), 7)}
          </div>
          {/* 2026-09-03: an icon-only control is `.btn btn-icon`. These two
              were already the theme's 28px square and already centred — only
              the corner differed (12px against the icon button's 8) — which is
              the AvatarEditor camera-badge finding again: a control one class
              away from the theme, invisible until something counted it. */}
          <div className="mb-1 flex items-center justify-between">
            <button type="button" aria-label={t("prevMonth")} onClick={() => setOffset((v) => v - 1)}
              className="btn btn-icon text-fg-muted hover:text-fg">
              <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
            </button>
            <span className="text-xs font-semibold text-fg">{grid.title}</span>
            <button type="button" aria-label={t("nextMonth")} onClick={() => setOffset((v) => v + 1)}
              className="btn btn-icon text-fg-muted hover:text-fg">
              <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {grid.weekdays.map((w, i) => (
              <span key={`${w}-${i}`} className="py-1 text-[10px] text-fg-subtle">{w}</span>
            ))}
            {grid.cells.map((cell) => {
              /* the cell's key is a UTC-midnight stamp of the day it stands
                 for, so the form's `YYYY-MM-DD` comes straight off it — no
                 second calendar conversion, and therefore no chance of the
                 two disagreeing about which day was pressed */
              const iso = new Date(cell.key).toISOString().slice(0, 10);
              return (
                /* NOT a `.btn`, and the reason is recorded in
                   control.guard.test.ts rather than pattern-matched away: a day
                   is a CELL of the month grid, not a control with a label in
                   it. The grid sets its width — seven tracks in a 288px panel —
                   where `.btn-icon` pins 28px and `.btn-sm` puts 13px of inline
                   padding either side of a two-digit number; and this grid says
                   which day is CHOSEN with weight, which `.btn`'s own
                   `font-semibold` would flatten across all forty-two at once. */
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => pick(iso)}
                  className={`tap grid h-8 place-items-center rounded-lg text-xs ${
                    iso === value
                      ? "bg-accent font-semibold text-on-accent"
                      : cell.weekend ? "text-danger hover:bg-surface-2"
                        : cell.inMonth ? "text-fg hover:bg-surface-2" : "text-fg-subtle/50"
                  }`}
                >
                  {cell.label}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** `HH:mm` in and out */
export function TimeField({ value, onChange, id }: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  const [hh, mm] = value.split(":");
  const hour = Number(hh ?? "0");
  const minute = Number(mm ?? "0");

  const set = (h: number, m: number) => {
    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  const column = (label: string, values: number[], current: number, pick: (v: number) => void) => (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="mb-1 text-center text-[10px] text-fg-subtle">{label}</span>
      <div className="scroll-quiet h-40 overflow-y-auto">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => pick(v)}
            className={`tap block w-full rounded-lg py-1.5 text-center text-xs ${
              v === current ? "bg-accent font-semibold text-on-accent" : "text-fg hover:bg-surface-2"
            }`}
          >
            {digits(String(v).padStart(2, "0"), locale)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        /* the date field's line, verbatim: `.input` owns this height, and
           restating it cost the 44px hit area below md (2026-09-03). */
        className="input flex w-full items-center justify-between gap-2 text-start"
      >
        {/* the CLOCK reads in the page's digits; the value underneath stays
            ASCII `HH:mm`, which is what the form submits */}
        <span className="badge-num truncate text-fg" dir="ltr">
          {value === "" ? t("pickTime") : digits(asciiDigits(value), locale)}
        </span>
        <IconClock width={14} height={14} className="shrink-0 text-fg-subtle" aria-hidden />
      </button>

      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-xl border-border bg-surface p-2 shadow-island">
        {/* HOUR ON THE RIGHT, MINUTES ON THE LEFT, in both locales (user
            directive, 2026-09-02: "hour must be at the right side always").
            A flex row follows the page's direction, so in English the
            columns swapped sides and the same picker read back-to-front
            depending on language. `dir="rtl"` pins the layout; the digits
            inside stay the locale's own. */}
        <div className="flex w-40 gap-1" dir="rtl">
          {column(t("hourLabel"), HOURS, hour, (h) => set(h, minute))}
          <span className="w-px bg-border" aria-hidden />
          {column(t("minuteLabel"), MINUTES, minute, (m) => set(hour, m))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
