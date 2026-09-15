"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import type { MeetingRecord, Me, TaskCardRecord } from "@/api/types";
import {
  IconCalendar, IconCheck, IconChevronRight, IconVideo,
} from "@/components/icons";
import { SkeletonLines } from "@/components/scaffold/Skeleton";
import { PRIORITY_BADGE, PRIORITY_CODE, PRIORITY_ORDER } from "@/components/platform/tasks/TaskDialogs";
import {
  formatDayMonth, formatTime, hourInResolvedZone, personName,
} from "@/lib/format";

/**
 * THE HOME PAGE'S EMPTY STATE.
 *
 * **It is the EMPTY state, and that is a design decision rather than a
 * placement.** The moment a conversation starts, the thread is what the person
 * came for and every panel here would be furniture beside it — so this renders
 * only while the composer is blank, and disappears without a control to
 * dismiss. The dashboard it replaces had the opposite arrangement: a board of
 * tiles was the whole page, and asking a question meant navigating away from
 * the day's facts to a different address.
 *
 * **Compact means a GLANCE and a DOOR.** Two meetings, four tasks, and each
 * panel ends in a row that navigates to the surface that owns the list — not
 * a pager, not a filter, and not a smaller copy of `/meetings`. A person who
 * wants the whole list wants the page that can search and sort it.
 *
 * **The greeting is the dashboard's, unchanged** — the salute reads the
 * PLATFORM's hour rather than the browser's, because the top bar's clock beside
 * it reads the stored zone and «شب بخیر» under a clock saying ten in the
 * morning is the two-clocks defect wearing a hello.
 */

/** two meetings and four tasks — what a glance is worth beside a prompt box */
const MEETING_ROWS = 2;
const TASK_ROWS = 4;

/** the two priorities that make a task "important" without anybody saying so */
const URGENT: ReadonlySet<string> = new Set(["high", "critical"]);

export function HomeSnapshot() {
  const t = useTranslations("home");
  /* the priority WORD lives in the tasks namespace, and the badge borrows it
     for the label a screen reader reads instead of «P1» */
  const t2 = useTranslations("tasks");
  const locale = useLocale();

  const [me, setMe] = useState<Me | null>(null);
  /** `null` = the read has not answered; `"failed"` = it answered badly.
      Two different nothings, and a failed read must never wear the empty
      state's copy — «جلسه‌ای در پیش نداری» about a list we could not read is
      a claim about the person's week made out of our own outage. */
  const [meetings, setMeetings] = useState<MeetingRecord[] | null | "failed">(null);
  const [tasks, setTasks] = useState<TaskCardRecord[] | null | "failed">(null);

  useEffect(() => {
    let alive = true;
    void api.me().then((identity) => { if (alive) setMe(identity); }).catch(() => { if (alive) setMe(null); });
    void api.meetings()
      .then((rows) => { if (alive) setMeetings(rows); })
      .catch(() => { if (alive) setMeetings("failed"); });
    /* `seed: false` — a READ must not create the default columns on an empty
       board. The home page is the first thing a new member opens, and a glance
       at their tasks is not a reason to write three columns into their org. */
    void api.taskBoard({ seed: false })
      .then((board) => { if (alive) setTasks(board.tasks); })
      .catch(() => { if (alive) setTasks("failed"); });
    return () => { alive = false; };
  }, []);

  const hour = hourInResolvedZone(new Date().toISOString());
  const salute = hour < 5 ? t("greetNight")
    : hour < 12 ? t("greetMorning")
      : hour < 16 ? t("greetNoon")
        : hour < 20 ? t("greetEvening")
          : t("greetNight");
  const name = me === null ? "" : personName(me, locale);

  const now = Date.now();
  const ahead = Array.isArray(meetings)
    ? meetings
      .filter((m) => new Date(m.scheduled_at).getTime() >= now && m.call_id === null)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    : [];

  /*
   * IMPORTANT = MINE, OR URGENT — and mine first.
   *
   * A board's own idea of importance is the priority column; a PERSON's is
   * "the thing I am carrying". Neither alone is the answer on a page that
   * greets somebody by name: a critical card nobody has been given is still
   * the org's most urgent work, and an ordinary card assigned to the reader is
   * still the reader's afternoon. So both qualify and the reader's own sort
   * first, then by deadline, and a card with no deadline sorts last — somebody
   * who never set one did not mean "immediately".
   */
  const mine = Array.isArray(tasks)
    ? tasks
      .filter((task) => !task.done && !task.archived)
      .filter((task) => (me !== null && task.assignee_ids.includes(me.id)) || URGENT.has(task.priority))
      .sort((a, b) => {
        const aMine = me !== null && a.assignee_ids.includes(me.id) ? 0 : 1;
        const bMine = me !== null && b.assignee_ids.includes(me.id) ? 0 : 1;
        if (aMine !== bMine) return aMine - bMine;
        if ((a.due_at === null) !== (b.due_at === null)) return a.due_at === null ? 1 : -1;
        if (a.due_at !== null && b.due_at !== null) {
          const byDue = a.due_at.localeCompare(b.due_at);
          if (byDue !== 0) return byDue;
        }
        /* THE RANK IS THE LAST WORD, not the first (2026-09-08, with the P
           codes). A deadline is a fact about the world and a priority is an
           opinion about the work, so the date still leads — but two cards due
           the same day, or neither due at all, are now settled by the badge
           the reader can see, instead of arriving in whatever order the board
           happened to return them. A list showing P4 above P1 for no visible
           reason reads as a bug in the badge. */
        return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      })
    : [];

  /* one panel shape for both lists — the panel IS the difference between a
     glance and a page, so it is drawn once and told what it holds */
  const panel = (
    label: string,
    icon: ReactNode,
    href: string,
    body: ReactNode,
  ) => (
    <section className="card flex min-h-0 flex-col" aria-label={label}>
      <header className="mb-2.5 flex items-center gap-2.5 border-b border-border pb-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
          {icon}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</h2>
        {/* THE DOOR, and it is a link rather than a pager (the directive's
            "actionable load more that will navigate me to the correct
            location in the platform"). It is in the HEADER rather than under
            the last row so it holds still: a foot-anchored link moves with
            the number of rows, which on a two-row list is most of the panel. */}
        <Link
          href={href}
          className="flex shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-caption text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
        >
          {t("loadMore")}
          <IconChevronRight width={12} height={12} className="rtl:-scale-x-100" />
        </Link>
      </header>
      <div className="min-h-0">{body}</div>
    </section>
  );

  /* the empty and unreadable states, said apart (rule 12: a failed read is a
     different nothing from an empty list, and only one of them is about the
     person's week) */
  const nothing = (word: string) => (
    <p className="py-3 text-center text-detail text-fg-subtle">{word}</p>
  );

  return (
    <div className="space-y-4">
      {/* ── the welcome, exactly as the dashboard said it ──────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-fg">
          {name === "" ? salute : t("greetWithName", { salute, name })} 👋
        </h1>
        {/*
          THE ONE CTA (the directive's "first page should have a CTA for
          starting a new meeting"). `?new=1` opens the meetings page with the
          create dialog already up and its time fields defaulted to the click
          moment — the same door the dashboard's «شروع ضبط جلسه» used, so
          there is one create flow rather than a second one written here.
        */}
        <Link href={{ pathname: "/meetings", query: { new: "1" } } as never} className="btn btn-primary shrink-0">
          <IconVideo width={14} height={14} />
          {t("startMeeting")}
        </Link>
      </div>

      {/* ── the glance: two panels, side by side from md ───────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        {panel(
          t("nextMeetings"),
          <IconCalendar width={16} height={16} />,
          "/meetings",
          meetings === null ? <SkeletonLines lines={2} />
            : meetings === "failed" ? nothing(t("readFailed"))
              : ahead.length === 0 ? nothing(t("noUpcomingMeetings"))
                : (
                  <ul className="divide-y divide-border/60">
                    {ahead.slice(0, MEETING_ROWS).map((m) => (
                      <li key={m.id}>
                        <Link
                          href={`/meetings/${m.id}`}
                          className="flex items-center gap-2.5 py-1.5 transition-colors hover:text-accent"
                        >
                          {/* the date BLOCK leads — day over month, the shape a
                              calendar row has, because a time on its own does
                              not say which day */}
                          <span className="date-block">
                            <span className="badge-num block text-base font-bold leading-5 text-fg">
                              {formatDayMonth(m.scheduled_at, locale).day}
                            </span>
                            <span className="block text-micro leading-3 text-fg-subtle">
                              {formatDayMonth(m.scheduled_at, locale).month}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg" title={m.title}>{m.title}</span>
                            <span className="badge-num mt-0.5 block text-micro text-fg-subtle">
                              {formatTime(m.scheduled_at, locale)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ),
        )}

        {panel(
          t("importantTasks"),
          <IconCheck width={16} height={16} />,
          "/tasks",
          tasks === null ? <SkeletonLines lines={3} />
            : tasks === "failed" ? nothing(t("readFailed"))
              : mine.length === 0 ? nothing(t("noTasks"))
                : (
                  <ul className="divide-y divide-border/60">
                    {mine.slice(0, TASK_ROWS).map((task) => (
                      <li key={task.id}>
                        <Link
                          href={{ pathname: "/tasks", query: { task: task.id } } as never}
                          className="flex items-center gap-2 py-1.5 transition-colors hover:text-accent"
                        >
                          {/* the priority is a RANK CODE, not a word and no
                              longer a dot (user, 2026-09-08). Four rows of
                              «بحرانی» beside four titles is a column of labels
                              competing with the thing they label; a dot was
                              quiet enough but said only "redder than that
                              one", in a colour nobody was taught. «P1» is the
                              dot's width and reads without a legend — and it
                              carries its word in `title`/`aria-label`, so the
                              screen reader still hears «بحرانی» rather than
                              the letter P and a digit. */}
                          <span
                            aria-label={t2(`priority_${task.priority}`)}
                            title={t2(`priority_${task.priority}`)}
                            className={`badge-num shrink-0 rounded px-1 py-0.5 text-micro font-bold leading-none ring-1 ring-inset ${PRIORITY_BADGE[task.priority]}`}
                          >
                            {PRIORITY_CODE[task.priority]}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-fg" title={task.title}>
                            {task.title}
                          </span>
                          {task.due_at !== null ? (
                            <span className="badge-num shrink-0 text-micro text-fg-subtle">
                              {formatDayMonth(task.due_at, locale).day} {formatDayMonth(task.due_at, locale).month}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ),
        )}
      </div>

      {/*
        NO COUNT STRIP. One line said «۰ جلسه در
        پیش · ۰ تسک باز» directly under two panels that had just said the same
        thing with the rows themselves — and on an empty week it was three
        zeroes stacked. The dashboard's four-card version went for the same
        reason; a strip of numbers under a prompt box is the board coming back
        one card at a time.
      */}
    </div>
  );
}
