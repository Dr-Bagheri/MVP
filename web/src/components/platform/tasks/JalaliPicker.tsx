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
      className="tap h-8 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-fg hover:border-border-strong"
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

      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" aria-label={t("prevMonth")} onClick={() => setOffset((v) => v - 1)}
          className="tap grid h-7 w-7 place-items-center rounded-lg text-fg-muted hover:text-fg">
          <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
        </button>
        <span className="text-sm font-semibold text-fg">{grid.title}</span>
        <button type="button" aria-label={t("nextMonth")} onClick={() => setOffset((v) => v + 1)}
          className="tap grid h-7 w-7 place-items-center rounded-lg text-fg-muted hover:text-fg">
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
