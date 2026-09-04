"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type {
  OrgPersonRecord, ProjectRecord, ProjectTone,
  TaskCardRecord, TaskColumnRecord, TaskTopicRecord,
} from "@/api/types";
import { Overlay } from "./Overlay";
import { Avatar } from "@/components/Avatar";
import { TONE_CHIP, TONE_DOT } from "./tasks/TaskDialogs";
import {
  IconCheck, IconChevronRight, IconClock, IconClose, IconFolder,
  IconPeople3, IconPlus, IconUser,
} from "@/components/icons";
import { SkeletonCards } from "@/components/scaffold";
import { dayKeyOf, digits, formatDate, monthGridAt, personName } from "@/lib/format";

/** what `api.taskBoard()` answers — the shape this screen reads it for */
type Board = {
  columns: TaskColumnRecord[];
  topics: TaskTopicRecord[];
  tasks: TaskCardRecord[];
};

/**
 * PROJECTS (0181; rebuilt to the board's shape 2026-09-05).
 *
 * User directive: "the project page must look like the tasks page with the
 * same sub menus on top — کانبان / لیست / تقویم / آرشیو | تازه‌ترین / بر اساس
 * نام / بر اساس پیشرفت | مهلت امروز — and also a second menu with the same
 * look: پروژه‌های من / همه پروژه‌ها. And in the kanban it will have the same
 * columns; it will have a list view and calendar view as well."
 *
 * ── ONE TOOLBAR, TWO ROWS, THE BOARD'S OWN ────────────────────────────────
 *
 * Every chip here is the board's `btn btn-sm`, in the board's order, because
 * a person who has learned one toolbar in this product has learned all of
 * them. `آرشیو` is a VIEW rather than a filter for the same reason it is on
 * the board: archived work is a place you go, not a box you tick.
 *
 * ── WHERE A PROJECT SITS ON THE KANBAN ────────────────────────────────────
 *
 * The columns are the BOARD'S columns — the same rows, the same order, read
 * from the same endpoint — because "the same columns" is what was asked for
 * and because inventing a second set would be a second answer to "what are
 * the stages of work here".
 *
 * A project has no column of its own, so one is DERIVED, by a rule that fits
 * in a sentence: **a project sits where its earliest unfinished work sits.**
 * No tasks at all → the first column (nothing has started). Nothing left
 * undone → the last (nothing to move). Otherwise the leftmost column still
 * holding one of its cards.
 *
 * The alternative — a card in every column its work touches — was rejected:
 * one project appearing three times reads as a bug, and a board is a place
 * where each thing is in one place.
 *
 * ── AND WHY THIS SCREEN READS THE BOARD ───────────────────────────────────
 *
 * Two requests, deliberately: the projects list carries counts, and the board
 * carries WHICH column and WHICH deadline. Everything the three views draw is
 * counted off the board on every read — the column, the days, «مهلت امروز» —
 * so nothing here can disagree with the board a click away. That is 0181's
 * rule (progress is counted, never stored) applied to four more facts.
 */

export const PROJECT_TONES: ProjectTone[] = [
  "grey", "blue", "green", "amber", "red", "purple", "teal", "pink",
];

/* the eight the reference offers. A closed set for the same reason the tone
   is closed: a free emoji field is a text input somebody pastes a sentence
   into, and the card draws it at 20px. */
const ICON_CHOICES = ["📁", "🚀", "🎯", "🧩", "📈", "🛠️", "💡", "🌱"];

type Scope = "all" | "mine";
type View = "kanban" | "list" | "calendar" | "archive";
type Sort = "recent" | "name" | "progress";

/** how far the work has got, as a fraction — null when there is no work yet,
    which renders as a dash rather than as a confident 0% */
function progressOf(p: ProjectRecord): number | null {
  return p.task_total === 0 ? null : p.task_done / p.task_total;
}

export function Projects({ meId, isAdmin }: { meId: string | null; isAdmin: boolean }) {
  const t = useTranslations("projects");
  const tTasks = useTranslations("tasks");
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<ProjectRecord[] | null | "failed">(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [people, setPeople] = useState<OrgPersonRecord[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [view, setView] = useState<View>("kanban");
  const [sort, setSort] = useState<Sort>("recent");
  const [dueToday, setDueToday] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.projects({ archived: view === "archive" })
      .then(setRows)
      .catch(() => setRows("failed"));
    /* the board, for the column, the deadlines and «مهلت امروز» — a failed
       read leaves an EMPTY board rather than null, so the kanban draws its
       columns and says nothing rather than looking like it is still loading */
    void api.taskBoard()
      .then(setBoard)
      .catch(() => setBoard({ columns: [], topics: [], tasks: [] }));
  }, [view]);
  /* the same subscription every list takes: a project the assistant creates
     lands here without a reload. `tasks` too, because this screen draws the
     board's own facts and a card moved on the board moves a project here. */
  const epoch = useRefreshEpoch("projects");
  const taskEpoch = useRefreshEpoch("tasks");
  useEffect(load, [load, epoch, taskEpoch]);

  useEffect(() => {
    void api.orgPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  /** a project's live cards on the board, by the category it owns (0181) */
  const cardsOf = useCallback((p: ProjectRecord): TaskCardRecord[] => {
    if (board === null || p.topic_id === null) return [];
    return board.tasks.filter((task) => task.topic_id === p.topic_id && !task.archived);
  }, [board]);

  const columns = useMemo(
    () => [...(board?.columns ?? [])].sort((a, b) => a.position - b.position),
    [board],
  );

  /** the rule from the header, in one place so the kanban and nothing else
      decides where a project stands */
  const columnOf = useCallback((p: ProjectRecord): string | null => {
    if (columns.length === 0) return null;
    const cards = cardsOf(p);
    if (cards.length === 0) return columns[0]!.id;
    const open = cards.filter((task) => !task.done);
    if (open.length === 0) return columns[columns.length - 1]!.id;
    let best: { id: string; at: number } | null = null;
    for (const task of open) {
      const at = columns.findIndex((c) => c.id === task.column_id);
      if (at < 0) continue;
      if (best === null || at < best.at) best = { id: task.column_id, at };
    }
    return best?.id ?? columns[0]!.id;
  }, [columns, cardsOf]);

  const shown = useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const today = dayKeyOf(new Date());
    const list = rows.filter((p) => {
      if (scope === "mine" && !(meId !== null && p.member_ids.includes(meId))) return false;
      if (!dueToday) return true;
      /* «مهلت امروز» on a project means UNFINISHED work due today. A done
         card that was due this morning is not something anybody needs to be
         shown at four in the afternoon. */
      return cardsOf(p).some((task) =>
        !task.done && task.due_at !== null && dayKeyOf(task.due_at) === today);
    });
    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, locale);
      if (sort === "progress") {
        /* a project with no tasks sorts LAST rather than first: zero-of-zero
           is not "nothing done", it is "nothing to do yet", and putting it
           at the head of a progress sort answers a question nobody asked */
        const pa = progressOf(a), pb = progressOf(b);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pb - pa;
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [rows, scope, sort, dueToday, meId, locale, cardsOf]);

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`btn btn-sm gap-1.5 font-medium ${
        active ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── row one: the board's toolbar, chip for chip ───────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {chip(view === "kanban", tTasks("viewKanban"), () => setView("kanban"))}
          {chip(view === "list", tTasks("viewList"), () => setView("list"))}
          {chip(view === "calendar", tTasks("viewCalendar"), () => setView("calendar"))}
          {chip(view === "archive", tTasks("viewArchive"), () => setView("archive"))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {chip(sort === "recent", t("sortRecent"), () => setSort("recent"))}
          {chip(sort === "name", t("sortName"), () => setSort("name"))}
          {chip(sort === "progress", t("sortProgress"), () => setSort("progress"))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {/* the board's own «مهلت امروز», the same box with a border for the
              on state — a state, never a second geometry */}
          <button
            type="button"
            aria-pressed={dueToday}
            onClick={() => setDueToday((v) => !v)}
            className={`btn btn-sm gap-1.5 border font-medium ${
              dueToday ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            <IconClock width={12} height={12} />
            {tTasks("dueTodayFilter")}
          </button>
        </div>
        {/* «پروژهٔ جدید» LEFT THIS ROW on 2026-09-05 (user directive: "remove
            the add new project on top and add it like tasks in the column").
            The way in is the dashed row inside each kanban column now — the
            board's own shape, and a project is made where it will sit. It is
            still admin-only (0186), and still ABSENT rather than disabled for
            everybody else: a greyed control is a promise the product has no
            intention of keeping.

            The LIST, CALENDAR and ARCHIVE views have no column to put it in,
            so they carry the button; the kanban does not. That is written
            down because it looks like an inconsistency and is not one. */}
        {isAdmin && view !== "kanban" ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn bg-accent text-on-accent shadow-accent hover:opacity-90"
          >
            <IconPlus width={14} height={14} />
            {t("newProject")}
          </button>
        ) : null}
      </div>

      {/* ── row two: whose projects, in the board's second-row shape ───── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={scope === "mine"}
            onClick={() => setScope("mine")}
            className={`btn btn-sm gap-1.5 border font-medium ${
              scope === "mine" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
            }`}
          >
            <IconUser width={12} height={12} />
            {t("scopeMine")}
          </button>
          <button
            type="button"
            aria-pressed={scope === "all"}
            onClick={() => setScope("all")}
            className={`btn btn-sm gap-1.5 border font-medium ${
              scope === "all" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
            }`}
          >
            <IconFolder width={12} height={12} />
            {t("scopeAll")}
            <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
              {digits(Array.isArray(rows) ? rows.length : 0, locale)}
            </span>
          </button>
        </div>
        <span className="text-xs text-fg-subtle">
          {t("count", { n: digits(shown.length, locale) })}
        </span>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/* ── the views ────────────────────────────────────────────────── */}
      {rows === null ? (
        <SkeletonCards count={3} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" height="h-36" />
      ) : rows === "failed" ? (
        <p className="text-sm text-fg-muted">{t("readFailed")}</p>
      ) : view === "kanban" && columns.length > 0 ? (
        /* THE BOARD RENDERS EVEN WITH NOTHING ON IT, and that is not a
           cosmetic choice: the way to create a project now lives INSIDE a
           column, so an empty state here would leave an admin with no
           projects and no way to make one — on the default view. A kanban
           with no cards still has its columns; that is what a kanban is. */
        <ProjectKanban
          columns={columns}
          projects={shown}
          columnOf={columnOf}
          people={people}
          locale={locale}
          isAdmin={isAdmin}
          onAdd={() => setCreating(true)}
        />
      ) : shown.length === 0 ? (
        /* the two nothings said apart: an organisation with no projects is
           not the same as a filter that matched none of them */
        <div className="tile flex flex-col items-center gap-2 p-8 text-center">
          <IconFolder width={24} height={24} />
          <p className="text-sm font-medium text-fg">
            {scope === "all" && !dueToday && view !== "archive" ? t("emptyTitle") : t("emptyFiltered")}
          </p>
          {scope === "all" && !dueToday && view !== "archive" ? (
            <p className="max-w-sm text-xs text-fg-muted">
              {isAdmin ? t("emptyBody") : t("emptyBodyMember")}
            </p>
          ) : null}
        </div>
      ) : view === "list" ? (
        <ProjectList projects={shown} cardsOf={cardsOf} people={people} locale={locale} />
      ) : view === "calendar" ? (
        <ProjectCalendar projects={shown} cardsOf={cardsOf} locale={locale} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} people={people} locale={locale} />
          ))}
        </div>
      )}

      {creating ? (
        <NewProjectDialog
          people={people}
          meId={meId}
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            router.push(`/projects/${p.id}`);
          }}
          onFailed={() => { setCreating(false); setError(t("writeFailed")); }}
        />
      ) : null}
    </div>
  );
}

/* ═══ the three views ═══════════════════════════════════════════════════ */

/**
 * THE BOARD'S COLUMNS, carrying projects.
 *
 * No drag: a project's column is DERIVED from where its work sits (see the
 * header's rule), so a card somebody could drag would be a control that looks
 * like it moves something and cannot — the shape this repo keeps finding and
 * removing. Work moves on the board; this screen reports where it got to.
 */
function ProjectKanban({ columns, projects, columnOf, people, locale, isAdmin, onAdd }: {
  columns: TaskColumnRecord[];
  projects: ProjectRecord[];
  columnOf: (p: ProjectRecord) => string | null;
  people: OrgPersonRecord[];
  locale: string;
  isAdmin: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations("projects");
  return (
    /* THE BOARD'S OWN SCROLLER (user directive, 2026-09-05: "use the same
       size fixed position column for the kanban like tasks"). Every number
       here is TaskBoard's: the 300px column, the 2xl corner, the surface
       ground, the card shadow and the 70vh floor. Two boards on one product
       showing the same shape must not disagree about it — and the version
       this replaces was a 288px column on a tinted ground with no floor, so
       the columns changed height as projects moved between them. */
    <div className="scroll-quiet flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const here = projects.filter((p) => columnOf(p) === col.id);
        return (
          <section
            key={col.id}
            className="flex min-h-[70vh] w-[300px] shrink-0 flex-col self-stretch rounded-2xl border border-border bg-surface p-2.5 shadow-card"
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <h2 className="truncate text-xs font-semibold text-fg">
                <bdi>{col.name}</bdi>
              </h2>
              <span className="badge-num rounded-md bg-surface-2 px-1.5 text-[10px] text-fg-subtle">
                {digits(here.length, locale)}
              </span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {here.map((p) => (
                <ProjectCard key={p.id} project={p} people={people} locale={locale} compact />
              ))}
              {/* THE WAY IN LIVES IN THE COLUMN (same directive: "remove the
                  add new project on top and add it like tasks in the column").
                  The board's own dashed row, verbatim — a project is made
                  where it is going to sit, and the page no longer carries a
                  separate button at the top that has to be told nothing.
                  Admin-only, because creating a project is (0186). */}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={onAdd}
                  className="btn btn-sm w-full justify-center gap-1.5 border border-dashed border-border font-medium text-fg-muted hover:border-border-strong hover:text-fg"
                >
                  <IconPlus width={12} height={12} />
                  {t("addProject")}
                </button>
              ) : here.length === 0 ? (
                /* a member gets a sentence rather than an empty box — the
                   column still has to say what it is showing */
                <p className="px-1 py-4 text-center text-[11px] text-fg-subtle">{t("noneHere")}</p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** the board's list view, one row per project */
function ProjectList({ projects, cardsOf, people, locale }: {
  projects: ProjectRecord[];
  cardsOf: (p: ProjectRecord) => TaskCardRecord[];
  people: OrgPersonRecord[];
  locale: string;
}) {
  const t = useTranslations("projects");
  return (
    <div className="flex flex-col gap-1.5">
      {projects.map((p) => {
        const cards = cardsOf(p);
        const open = cards.filter((task) => !task.done).length;
        const members = p.member_ids
          .map((id) => people.find((x) => x.id === id))
          .filter((x): x is OrgPersonRecord => x !== undefined);
        return (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="tile flex items-center gap-3 px-3 py-2.5 transition-colors hover:border-accent/40"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[p.tone] ?? TONE_DOT.grey!}`} aria-hidden />
            <span aria-hidden className="text-base">{p.icon ?? "📁"}</span>
            <span className="min-w-0 flex-1">
              <bdi className="block truncate text-sm font-medium text-fg">{p.name}</bdi>
              {p.summary === "" ? null : (
                <bdi className="block truncate text-[11px] text-fg-muted">{p.summary}</bdi>
              )}
            </span>
            <span className="badge-num shrink-0 text-[11px] text-fg-subtle">
              {t("openCount", { n: digits(open, locale) })}
            </span>
            <span className="badge-num shrink-0 text-[11px] text-fg-muted">
              {p.task_total === 0 ? "—" : t("doneOf", {
                done: digits(p.task_done, locale), total: digits(p.task_total, locale),
              })}
            </span>
            <span className="flex shrink-0 -space-x-1.5">
              {members.slice(0, 3).map((m) => (
                <Avatar key={m.id} name={personName(m, locale)} size="xs" />
              ))}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A MONTH OF DEADLINES, by project.
 *
 * A project has no date of its own, so the day a project appears on is a day
 * one of ITS cards is due — which is the only project-shaped thing a calendar
 * can honestly say. The square carries the project and how many of its cards
 * land there, so a day with one deadline and a day with nine do not look the
 * same.
 */
function ProjectCalendar({ projects, cardsOf, locale }: {
  projects: ProjectRecord[];
  cardsOf: (p: ProjectRecord) => TaskCardRecord[];
  locale: string;
}) {
  const t = useTranslations("projects");
  const tTasks = useTranslations("tasks");
  const [offset, setOffset] = useState(0);
  const month = useMemo(() => monthGridAt(new Date(), locale, offset), [locale, offset]);

  /** day → the projects with work due that day, and how much */
  const byDay = useMemo(() => {
    const out = new Map<number, { project: ProjectRecord; n: number }[]>();
    for (const p of projects) {
      const days = new Map<number, number>();
      for (const task of cardsOf(p)) {
        if (task.due_at === null) continue;
        const key = dayKeyOf(task.due_at);
        days.set(key, (days.get(key) ?? 0) + 1);
      }
      for (const [key, n] of days) {
        const bucket = out.get(key);
        if (bucket) bucket.push({ project: p, n });
        else out.set(key, [{ project: p, n }]);
      }
    }
    return out;
  }, [projects, cardsOf]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setOffset(0)} className="btn btn-sm border border-border text-fg-muted hover:text-fg">
            {tTasks("today")}
          </button>
          <button type="button" aria-label={tTasks("prev")} onClick={() => setOffset((n) => n - 1)}
            className="btn btn-icon border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
          </button>
          <button type="button" aria-label={tTasks("next")} onClick={() => setOffset((n) => n + 1)}
            className="btn btn-icon border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
          </button>
        </div>
        <span className="text-sm font-semibold text-fg">{month.title}</span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-fg-subtle">
        {month.weekdays.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1">
        {month.cells.map((cell) => (
          <div
            key={cell.key}
            className={`min-h-[5rem] rounded-lg border p-1 ${
              cell.today ? "border-accent bg-accent-soft/30"
                : cell.weekend ? "border-border bg-surface-2/40" : "border-border bg-surface"
            } ${cell.inMonth ? "" : "opacity-40"}`}
          >
            <span className="badge-num block text-[10px] text-fg-subtle">{cell.label}</span>
            <div className="mt-0.5 flex flex-col gap-0.5">
              {(byDay.get(cell.key) ?? []).slice(0, 3).map(({ project, n }) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className={`tap flex items-center gap-1 rounded px-1 py-0.5 text-[10px] ${TONE_CHIP[project.tone] ?? TONE_CHIP.grey!}`}
                >
                  <bdi className="min-w-0 flex-1 truncate">{project.name}</bdi>
                  <span className="badge-num">{digits(n, locale)}</span>
                </Link>
              ))}
              {(byDay.get(cell.key) ?? []).length > 3 ? (
                <span className="px-1 text-[10px] text-fg-subtle">
                  {t("more", { n: digits((byDay.get(cell.key) ?? []).length - 3, locale) })}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The colour swatches, ONE component — the create dialog and the edit dialog
 * ask the same question, and a second copy is the one that stops matching the
 * first the day either gains a rule.
 *
 * The box is the BOARD'S (its 2026-09-03 note: the 16px colour inside is the
 * picture, `.btn-icon` is the 28px box a person presses — which was `h-7
 * rounded-lg` spelled by hand until the control guard said so). Only the
 * selected ring belongs to this picker.
 */
export function TonePicker({ value, onChange, label }: {
  value: ProjectTone;
  onChange: (tone: ProjectTone) => void;
  label: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {PROJECT_TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            aria-label={tone}
            aria-pressed={value === tone}
            onClick={() => onChange(tone)}
            className={`btn btn-icon hover:bg-surface-2 ${value === tone ? "ring-2 ring-accent" : ""}`}
          >
            <span className={`h-4 w-4 rounded-md ${TONE_DOT[tone] ?? TONE_DOT.grey!}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, people, locale, compact = false }: {
  project: ProjectRecord;
  people: OrgPersonRecord[];
  locale: string;
  /** on the kanban, where the card lives in a 288px column: the same card
      with less air, never a second card. Two drawings of one thing is the
      pair that stops matching the first time either gains a field. */
  compact?: boolean;
}) {
  const t = useTranslations("projects");
  const ratio = progressOf(project);
  const members = project.member_ids
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is OrgPersonRecord => p !== undefined);

  return (
    <Link
      href={`/projects/${project.id}`}
      /*
       * `h-auto shrink-0` ON THE KANBAN CARD, and it is not a nicety: `.tile`
       * declares `height: 100%`, which inside a flex COLUMN resolves against
       * the column's height — so every project card stretched to fill the
       * whole 70vh lane and two projects filled the screen. On the projects
       * LIST the tile is in a grid, where 100% is what makes a row of cards
       * the same height, so the override belongs to the compact variant
       * alone.
       */
      className={`tile flex flex-col transition-colors hover:border-accent/40 ${
        compact ? "h-auto shrink-0 gap-1.5 p-2.5" : "gap-3 p-4"
      }`}
    >
      <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
        {/* the icon, or the first letter — the same fallback a person's
            avatar takes, so an unnamed swatch never renders as an empty box */}
        <span
          aria-hidden
          className={`flex shrink-0 items-center justify-center rounded-xl bg-surface-2 ${
            compact ? "h-7 w-7 text-sm" : "h-10 w-10 text-lg"
          } ${project.icon === null ? "text-sm font-bold text-fg-muted" : ""}`}
        >
          {project.icon ?? [...project.name][0] ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[project.tone] ?? TONE_DOT.grey!}`} aria-hidden />
            <h3 className="truncate text-sm font-semibold text-fg">{project.name}</h3>
            {project.archived_at !== null ? (
              <span className="badge-num shrink-0 rounded-md bg-surface-2 px-1.5 text-[10px] text-fg-muted">
                {t("archived")}
              </span>
            ) : null}
          </div>
          {compact ? null : (
            <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
              {project.summary === "" ? t("noSummary") : project.summary}
            </p>
          )}
        </div>
      </div>

      {/* progress: the bar and the numbers, or a dash. A zero-width bar under
          a project with no tasks reads as "nothing done" — which is a claim
          about the work rather than about the board being empty. */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          {ratio === null ? null : (
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(ratio * 100)}%` }} />
          )}
        </div>
        <span className="badge-num shrink-0 text-[11px] text-fg-muted">
          {ratio === null
            ? "—"
            : t("progress", {
                done: digits(project.task_done, locale),
                total: digits(project.task_total, locale),
              })}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* the roster, overlapped the way a shared thing reads — a
            negative logical margin on every avatar but the first, so the
            stack leans the right way in both directions */}
        <div className="flex items-center gap-0 [&>*+*]:-ms-1.5">
          {members.slice(0, 4).map((m) => (
            <Avatar key={m.id} name={personName(m, locale)} size="xs" className="ring-2 ring-surface" />
          ))}
          {members.length > 4 ? (
            <span className="badge-num ms-1 text-[11px] text-fg-muted">
              +{digits(members.length - 4, locale)}
            </span>
          ) : null}
          {members.length === 0 ? (
            <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
              <IconPeople3 width={12} height={12} />
              {t("noMembers")}
            </span>
          ) : null}
        </div>
        <span className="badge-num text-[11px] text-fg-subtle">
          {formatDate(project.created_at, locale)}
        </span>
      </div>
    </Link>
  );
}

/**
 * THE CREATE DIALOG, field for field from the reference: a name, a line of
 * description, a colour, an icon, and who is on it.
 *
 * The people picker is a LIST OF TOGGLES rather than a search box, and that
 * is a size judgement rather than a preference: these are colleagues in one
 * organisation, so the list is short enough to read. When an org outgrows
 * that, the box arrives — and it arrives with a reason, not because a search
 * field looks more finished.
 */
export function NewProjectDialog({ people, meId, onClose, onCreated, onFailed }: {
  people: OrgPersonRecord[];
  meId: string | null;
  onClose: () => void;
  onCreated: (project: ProjectRecord) => void;
  onFailed: () => void;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [tone, setTone] = useState<ProjectTone>("blue");
  const [icon, setIcon] = useState<string | null>("📁");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    void api.createProject({
      name: name.trim(),
      summary: summary.trim(),
      tone,
      icon,
      member_ids: members,
    })
      .then(onCreated)
      .catch(() => { setBusy(false); onFailed(); });
  };

  return (
    <Overlay onClose={onClose} label={t("newProject")} size="md">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">{t("newProject")}</h2>
        <button type="button" onClick={onClose} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldName")}</span>
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={t("namePlaceholder")}
            className="input w-full"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldSummary")}</span>
          <textarea
            value={summary}
            maxLength={400}
            rows={2}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t("summaryPlaceholder")}
            className="input w-full resize-none py-2"
          />
        </label>

        <TonePicker value={tone} onChange={setTone} label={t("fieldTone")} />

        <div>
          <span className="mb-1.5 block text-xs font-medium text-fg-muted">{t("fieldIcon")}</span>
          <div className="flex flex-wrap gap-1.5">
            {ICON_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={icon === choice}
                onClick={() => setIcon((cur) => (cur === choice ? null : choice))}
                /* the same box as the colour swatch beside it — a picker
                   whose two rows are different sizes reads as two features */
                className={`btn btn-icon text-base hover:bg-surface-2 ${
                  icon === choice ? "bg-accent-soft ring-2 ring-accent" : ""
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-fg-muted">{t("fieldMembers")}</span>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
            {people.length === 0 ? (
              <p className="px-1 py-2 text-xs text-fg-subtle">{t("noColleagues")}</p>
            ) : people.map((person) => {
              /* THE CREATOR IS ALREADY ON IT and the row says so rather than
                 offering a toggle that changes nothing: the server adds them
                 unconditionally (a project you made and are not on reads as
                 somebody else's), so a switch here would be a control whose
                 off position the server ignores. */
              const isMe = person.id === meId;
              const on = isMe || members.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  disabled={isMe}
                  aria-pressed={on}
                  onClick={() => setMembers((cur) =>
                    cur.includes(person.id) ? cur.filter((id) => id !== person.id) : [...cur, person.id])}
                  className={`tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs ${
                    on ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2"
                  } ${isMe ? "cursor-default" : ""}`}
                >
                  <Avatar name={personName(person, locale)} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{personName(person, locale)}</span>
                  {isMe ? <span className="text-[10px]">{t("you")}</span> : null}
                  {on ? <IconCheck width={12} height={12} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} className="btn text-fg-muted hover:text-fg">
          {tCommon("cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={name.trim() === "" || busy}
          className="btn bg-accent text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50"
        >
          <IconPlus width={14} height={14} />
          {busy ? t("creating") : t("create")}
        </button>
      </div>
    </Overlay>
  );
}

