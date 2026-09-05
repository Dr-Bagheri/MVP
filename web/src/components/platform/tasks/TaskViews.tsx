"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { TaskCardRecord, TaskColumnRecord, TaskLabelRecord } from "@/api/types";
import { PRIORITY_CHIP, TONE_CHIP, TONE_DOT } from "./TaskDialogs";
import { TAB_BAR } from "./panelStyle";
import { IconCheck, IconChevronRight, IconVideo } from "@/components/icons";
import { dayKeyOf, digits, monthGridAt, weekRangeLabel, weekStrip } from "@/lib/format";

/**
 * The board's OTHER views, taken from the reference (walked 2026-09-01):
 *
 *   · تقویم — [امروز] [‹ ›] range on one side, [ماه|هفته|روز] on the other,
 *     a «بدون مهلت (N)» drawer above the grid, and the deadline cards laid
 *     on their days. Friday tints, today wears the accent.
 *   · لیست — grouped by deadline bucket, each row a card: the checkbox, the
 *     priority chip, the title with its meta line, and the column chip.
 */

type Scale = "month" | "week" | "day";

export function TaskCalendar({ tasks, labels, onOpen, onToggleDone }: {
  tasks: TaskCardRecord[];
  labels: TaskLabelRecord[];
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [scale, setScale] = useState<Scale>("month");
  const [offset, setOffset] = useState(0);
  const [drawer, setDrawer] = useState(false);

  const month = useMemo(() => monthGridAt(new Date(), locale, offset), [locale, offset]);
  const week = useMemo(() => weekStrip(new Date(), locale, offset), [locale, offset]);
  const dayKey = useMemo(() => {
    const base = dayKeyOf(new Date());
    return base + offset * 86_400_000;
  }, [offset]);

  const byDay = new Map<number, TaskCardRecord[]>();
  const undated: TaskCardRecord[] = [];
  for (const task of tasks) {
    if (task.due_at === null) { undated.push(task); continue; }
    const key = dayKeyOf(task.due_at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(task);
    else byDay.set(key, [task]);
  }

  const label = scale === "month" ? month.title
    : scale === "week" ? weekRangeLabel(week, locale)
      : new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB",
        { dateStyle: "full", timeZone: "UTC" }).format(new Date(dayKey));

  const chip = (task: TaskCardRecord) => (
    <button
      key={task.id}
      type="button"
      onClick={() => onOpen(task.id)}
      title={task.title}
      className={`block w-full truncate rounded-md px-1.5 py-0.5 text-start text-[10px] leading-4 ${
        task.done ? "bg-surface-2 text-fg-subtle line-through" : "bg-accent-soft text-accent"
      }`}
    >
      {task.title}
    </button>
  );

  return (
    <div className="tile flex min-h-0 flex-1 flex-col p-3">
      {/* ── the calendar's own top bar ────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {/* 2026-09-03: the theme's controls, not a twelfth invented size —
              and character for character the [امروز] [‹ ›] row Meetings.tsx
              already wears. The two surfaces render the SAME toolbar over the
              same month grid, so a difference between them is one a person
              finds by switching tabs. `.btn`/`.btn-sm` draw no border of their
              own, so `border border-border` stays; `.tap` goes because `.btn`
              composes it. */}
          <button type="button" onClick={() => setOffset(0)}
            className="btn btn-sm border border-border text-fg hover:border-border-strong">
            {t("today")}
          </button>
          <button type="button" aria-label={t("prev")} onClick={() => setOffset((v) => v - 1)}
            className="btn btn-icon border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
          </button>
          <span className="px-1 text-sm font-semibold text-fg">{label}</span>
          <button type="button" aria-label={t("next")} onClick={() => setOffset((v) => v + 1)}
            className="btn btn-icon border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
          </button>
        </div>
        <div className={TAB_BAR} role="tablist">
          {/* 2026-09-03: `.btn-sm` IS the segmented tab — globals.css says so
              by name ("its segmented tabs and toolbar buttons" is what the
              34px/8px size was measured off). This group sat at the other end
              of the row I just converted, in its own h-8/12px shape, and the
              guard could not see it: no centring class, so it never counted.
              Converting only what a check can see is how a file ends up
              half-converted and looking it. The state classes are untouched —
              they are the element's, not the geometry's — and
              `transition-colors` goes because `.btn` already transitions, and
              two utilities from one property group are settled by stylesheet
              order rather than by the order they are written. */}
          {(["month", "week", "day"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={scale === option}
              onClick={() => { setScale(option); setOffset(0); }}
              className={`btn btn-sm font-medium ${
                scale === option ? "bg-accent text-on-accent" : "text-fg-muted hover:text-fg"
              }`}
            >
              {t(`scale_${option}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ── the «بدون مهلت» drawer ────────────────────────────────────── */}
      <div className="mb-2 border-b border-border pb-2">
        <button type="button" onClick={() => setDrawer((v) => !v)}
          className="tap flex h-7 items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
          <IconChevronRight width={12} height={12}
            className={drawer ? "-rotate-90" : "rotate-180 rtl:rotate-0"} />
          {t("noDeadline")} ({digits(undated.length, locale)})
        </button>
        {drawer ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {undated.length === 0 ? (
              <span className="text-xs text-fg-subtle">{t("noUndated")}</span>
            ) : undated.map((task) => (
              <button key={task.id} type="button" onClick={() => onOpen(task.id)}
                className="tap rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-fg hover:bg-border">
                {task.title}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── the grid ─────────────────────────────────────────────────── */}
      {scale === "month" ? (
        <>
          <ul className="grid grid-cols-7 gap-1.5 pb-1">
            {month.weekdays.map((day, i) => (
              <li key={i} className="text-center text-[10px] text-fg-subtle">{day}</li>
            ))}
          </ul>
          <ul className="scroll-quiet grid min-h-0 flex-1 grid-cols-7 gap-1.5 overflow-y-auto">
            {month.cells.map((cell) => (
              <li key={cell.key}
                className={`flex min-h-24 flex-col rounded-xl border p-1.5 ${
                  cell.today ? "border-accent/40 bg-accent-soft"
                    : cell.weekend ? "border-transparent bg-danger/5"
                      : cell.inMonth ? "border-border bg-surface"
                        : "border-transparent bg-surface-2/40"
                }`}>
                {/* a DATE, not a person: the round well says "today", so it is
                    not an avatar however much it looks like one (2026-09-03) */}
                <span className={`mb-1 text-xs tabular-nums ${
                  cell.today ? "grid h-5 w-5 place-items-center rounded-full bg-accent font-bold text-on-accent"
                    : cell.weekend ? "text-danger" : cell.inMonth ? "text-fg" : "text-fg-subtle"
                }`}>
                  {cell.label}
                </span>
                <div className="min-h-0 flex-1 space-y-1">
                  {(byDay.get(cell.key) ?? []).map(chip)}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : scale === "week" ? (
        <ul className="grid min-h-0 flex-1 grid-cols-7 gap-1.5">
          {week.map((cell) => (
            <li key={cell.key}
              className={`flex min-h-0 flex-col rounded-xl border ${
                cell.today ? "border-accent/40 bg-accent-soft"
                  : cell.weekend ? "border-transparent bg-danger/5"
                    : "border-border bg-surface"
              }`}>
              <div className={`border-b px-1 py-1.5 text-center ${
                cell.today ? "border-accent/20" : "border-border/60"
              }`}>
                <span className={`block truncate text-[10px] ${cell.today ? "text-accent" : "text-fg-muted"}`}>
                  {cell.weekday}
                </span>
                {/* the week's own day NUMBER — the same round well as the month
                    grid's, and the same not-a-person (2026-09-03) */}
                <span className={`mx-auto mt-0.5 grid h-6 w-6 place-items-center rounded-full text-xs tabular-nums ${
                  cell.today ? "bg-accent font-bold text-on-accent" : cell.weekend ? "text-danger" : "text-fg"
                }`}>
                  {cell.label}
                </span>
              </div>
              <div className="scroll-quiet min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
                {(byDay.get(cell.key) ?? []).map(chip)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card min-h-0 flex-1 p-3">
          {(byDay.get(dayKey) ?? []).length === 0 ? (
            <p className="p-4 text-center text-sm text-fg-muted">{t("dayEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              {(byDay.get(dayKey) ?? []).map((task) => (
                <li key={task.id}>
                  <TaskRow task={task} labels={labels} column={null}
                    onOpen={onOpen} onToggleDone={onToggleDone} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── one list row, the reference's shape ──────────────────────────────── */
export function TaskRow({ task, labels, column, onOpen, onToggleDone }: {
  task: TaskCardRecord;
  labels: TaskLabelRecord[];
  column: TaskColumnRecord | null;
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const worn = labels.filter((label) => task.label_ids.includes(label.id));
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(task.id); }}
      /* `tile-row`: a list line, not a card — see globals.css */
      className="tile tile-row flex cursor-pointer items-center gap-3 p-3.5 transition-colors hover:border-border-strong"
    >
      {/* KEPT, and this file's one worklist entry in control.guard.test.ts
          (2026-09-03): a CHECKBOX, not a button. 16px is the box a tick lives
          in, and the platform draws the identical one in five places (the board
          card, the task screen's checklist, the meeting's items panel and
          mini-tasks). `.btn-icon` is 28px, which beside a 14px line stops
          reading as a checkbox — and converting one of five would create the
          divergence the guard exists to close. */}
      <button
        type="button"
        aria-label={t("markDone")}
        onClick={(e) => { e.stopPropagation(); onToggleDone(task.id, !task.done); }}
        className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
          task.done ? "border-accent bg-accent text-on-accent" : "border-border"
        }`}
      >
        {task.done ? <IconCheck width={12} height={12} /> : null}
      </button>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${PRIORITY_CHIP[task.priority]}`}>
        {t(`priority_${task.priority}`)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-semibold ${task.done ? "text-fg-subtle line-through" : "text-fg"}`}>
          {task.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-subtle">
          {task.checklist_total > 0 ? (
            <span className="ltr">{digits(task.checklist_done, locale)}/{digits(task.checklist_total, locale)}</span>
          ) : null}
          {task.call_id !== null ? (
            <span className="flex items-center gap-1 truncate">
              <IconVideo width={12} height={12} />
              {task.call_title ?? t("recordGone")}
            </span>
          ) : null}
          {worn.map((label) => (
            <span key={label.id} className={`rounded px-1.5 ${TONE_CHIP[label.color] ?? TONE_CHIP.grey!}`}>
              {label.name}
            </span>
          ))}
        </span>
      </span>
      {column !== null ? (
        <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-fg-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[column.tone] ?? TONE_DOT.grey!}`} aria-hidden />
          {column.name}
        </span>
      ) : null}
    </div>
  );
}

/* ── the list view: grouped by deadline bucket ────────────────────────── */
export function TaskListView({ tasks, columns, labels, onOpen, onToggleDone }: {
  tasks: TaskCardRecord[];
  columns: TaskColumnRecord[];
  labels: TaskLabelRecord[];
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const today = dayKeyOf(new Date());

  const groups: Array<{ key: string; rows: TaskCardRecord[] }> = [
    { key: "overdue", rows: [] },
    { key: "today", rows: [] },
    { key: "soon", rows: [] },
    { key: "later", rows: [] },
    { key: "none", rows: [] },
  ];
  const at = (key: string) => groups.find((g) => g.key === key)!;
  for (const task of tasks) {
    if (task.due_at === null) { at("none").rows.push(task); continue; }
    const day = dayKeyOf(task.due_at);
    if (day < today) at("overdue").rows.push(task);
    else if (day === today) at("today").rows.push(task);
    else if (day <= today + 7 * 86_400_000) at("soon").rows.push(task);
    else at("later").rows.push(task);
  }

  const live = groups.filter((group) => group.rows.length > 0);
  if (live.length === 0) return <p className="p-4 text-sm text-fg-muted">{t("listEmpty")}</p>;

  return (
    <div className="scroll-quiet min-h-0 flex-1 space-y-4 overflow-y-auto">
      {live.map((group) => (
        <section key={group.key} aria-label={t(`group_${group.key}` as "group_today")}>
          <h3 className="mb-1.5 text-xs text-fg-muted">
            {t(`group_${group.key}` as "group_today")} ({digits(group.rows.length, locale)})
          </h3>
          <ul className="space-y-2">
            {group.rows.map((task) => (
              <li key={task.id}>
                <TaskRow
                  task={task}
                  labels={labels}
                  column={columns.find((c) => c.id === task.column_id) ?? null}
                  onOpen={onOpen}
                  onToggleDone={onToggleDone}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
