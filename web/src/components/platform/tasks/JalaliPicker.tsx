"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { digits, monthGridAt } from "@/lib/format";
import { IconChevronRight } from "@/components/icons";

/**
 * THE DATE PICKER, taken from the reference's own (walked 2026-09-01): a
 * preset row (امروز / فردا / هفته بعد / بدون مهلت), a month header with
 * arrows, weekday initials, and the month's grid — in the READER's calendar,
 * so a Persian reader picks a Jalali date and a Gregorian one picks theirs.
 *
 * It returns an ISO instant at local noon: a deadline is a DAY, and midnight
 * is the one hour of the day that lands on the wrong side of a timezone.
 */
export function JalaliPicker({ value, onPick, onClose }: {
  /** the current deadline, ISO — null = none set */
  value: string | null;
  onPick: (iso: string | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [offset, setOffset] = useState(0);
  const grid = useMemo(() => monthGridAt(new Date(), locale, offset), [locale, offset]);

  const dayIso = (key: number): string => {
    /* the key is a UTC midnight stamp for the day; noon keeps the date on
       both sides of any reasonable zone shift */
    return new Date(key + 12 * 3600 * 1000).toISOString();
  };
  const selectedKey = value === null ? null : (() => {
    const d = new Date(value);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  })();

  const preset = (label: string, days: number | null) => (
    <button
      type="button"
      onClick={() => {
        if (days === null) { onPick(null); onClose(); return; }
        const d = new Date();
        d.setDate(d.getDate() + days);
        d.setHours(12, 0, 0, 0);
        onPick(d.toISOString());
        onClose();
      }}
      /* 2026-09-03: the theme's compact control. This row and the meeting
         form's preset row (components/DateTimeFields.tsx) offer the same
         presets in the same shaped panel and were written twice — 32px/12px
         corner/11.5px solid here, 32px/12px/11px muted there. Both are
         `.btn-sm` now; `.btn` draws no border, so the outline is explicit. */
      className="btn btn-sm border border-border bg-surface font-medium text-fg hover:border-border-strong"
    >
      {label}
    </button>
  );

  return (
    <div className="w-[268px] rounded-2xl border border-border bg-surface p-3 shadow-island">
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
        {preset(t("dueToday"), 0)}
        {preset(t("dueTomorrow"), 1)}
        {preset(t("dueNextWeek"), 7)}
        {preset(t("dueNone"), null)}
      </div>

      {/* 2026-09-03: an icon-only control is `.btn btn-icon` — these were
          already 28px and centred, only the corner differed. The meeting
          form's picker carries the identical pair; they are now the identical
          line, which is the point of having a named size at all. */}
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" aria-label={t("prevMonth")} onClick={() => setOffset((v) => v - 1)}
          className="btn btn-icon text-fg-muted hover:text-fg">
          <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
        </button>
        <span className="text-sm font-semibold text-fg">{grid.title}</span>
        <button type="button" aria-label={t("nextMonth")} onClick={() => setOffset((v) => v + 1)}
          className="btn btn-icon text-fg-muted hover:text-fg">
          <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
        </button>
      </div>

      <ul className="grid grid-cols-7 gap-0.5">
        {grid.weekdays.map((day, i) => (
          <li key={i} className="py-1 text-center text-[10px] text-fg-subtle">{day}</li>
        ))}
      </ul>
      <ul className="grid grid-cols-7 gap-0.5">
        {grid.cells.map((cell) => {
          const selected = selectedKey !== null && cell.key === selectedKey;
          return (
            <li key={cell.key}>
              {/* NOT a `.btn`, recorded with its reason in
                  control.guard.test.ts: a day is a CELL of the month grid, not
                  a control with a label in it. `w-full` is the grid's own
                  seven-track width — `.btn-icon` would pin 28px and `.btn-sm`
                  would add 13px of inline padding either side of a two-digit
                  number — and this grid says which day is CHOSEN, and which is
                  TODAY, with `font-bold` against the rest; `.btn`'s own
                  `font-semibold` would close most of that gap on all
                  forty-two cells at once. */}
              <button
                type="button"
                onClick={() => { onPick(dayIso(cell.key)); onClose(); }}
                className={`tap grid h-8 w-full place-items-center rounded-lg text-xs tabular-nums transition-colors ${
                  selected
                    ? "bg-accent font-bold text-on-accent"
                    : cell.today
                      ? "bg-accent-soft font-bold text-accent"
                      : cell.weekend
                        ? "text-danger hover:bg-danger/10"
                        : cell.inMonth
                          ? "text-fg hover:bg-surface-2"
                          : "text-fg-subtle hover:bg-surface-2"
                }`}
              >
                {cell.label}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-center text-[10px] text-fg-subtle">
        {digits(grid.cells.filter((c) => c.inMonth).length, locale)} {t("daysInMonth")}
      </p>
    </div>
  );
}
