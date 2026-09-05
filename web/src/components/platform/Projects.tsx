"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { ProjectDetail } from "./ProjectDetail";
import { ProjectDialog } from "./ProjectDialog";
import { filterChipClass } from "./sectionTabs";
import { useHoldDrag, type HoldDragHandlers } from "./board/holdDrag";
import { ConfirmDialog } from "@/components/rowActions";
import { notify } from "@/lib/notify";
import {
  BOARD_CARD, BOARD_CARDS, BOARD_COLUMN, BOARD_COUNT, BOARD_HEADER, BOARD_HEADER_END,
  BOARD_HEADER_START, BOARD_LANE, BOARD_TITLE, BoardAddRow, BoardTone,
} from "./board/boardStyle";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type {
  OrgPersonRecord, ProjectRecord,
  TaskCardRecord, TaskColumnRecord, TaskTopicRecord,
} from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { TONE_CHIP, TONE_DOT } from "./tasks/TaskDialogs";
import {
  IconChevronRight, IconClock, IconFolder,
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
  /* ?project= deep link (R18): the panel has an address, the way ?task= does */
  const params = useSearchParams();
  const openId = params.get("project");
  const [rows, setRows] = useState<ProjectRecord[] | null | "failed">(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [people, setPeople] = useState<OrgPersonRecord[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [view, setView] = useState<View>("kanban");
  const [sort, setSort] = useState<Sort>("recent");
  const [dueToday, setDueToday] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** a project dropped on a column, waiting for the person to confirm what moves */
  const [pendingMove, setPendingMove] = useState<{ project: ProjectRecord; columnId: string; tasks: TaskCardRecord[] } | null>(null);
  const [moving, setMoving] = useState(false);

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

  /*
   * DRAGGING A PROJECT MOVES ITS WORK (user, 2026-09-05: "add it for the
   * projects kanban as well"). Nothing about a project is stored per column —
   * the column is counted off its tasks — so the one thing a drop can mean is
   * "this project's unfinished work is now at this stage": every open card of
   * the project goes to the column it was dropped on, done cards stay. It
   * ASKS FIRST, naming the count: a drop moves other people's cards, and a
   * bulk move nobody confirmed is the kind of surprise that teaches a team not
   * to touch the board.
   */
  const requestMove = useCallback((project: ProjectRecord, columnId: string) => {
    const tasks = cardsOf(project).filter((task) => !task.done && task.column_id !== columnId);
    if (tasks.length === 0) { notify(t("moveNothing")); return; }
    setPendingMove({ project, columnId, tasks });
  }, [cardsOf, t]);

  const confirmMove = useCallback(async () => {
    if (pendingMove === null) return;
    setMoving(true);
    try {
      /* one card at a time, each its own idempotent write — the board's own
         move, applied to each; a refused write stops the run and the reload
         below shows what actually moved */
      for (const task of pendingMove.tasks) {
        await api.updateTask(task.id, { column_id: pendingMove.columnId, position: -Date.now() });
      }
    } catch {
      setError(t("writeFailed"));
    } finally {
      setMoving(false);
      setPendingMove(null);
      load();
    }
  }, [pendingMove, load, t]);

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
            className={filterChipClass(scope === "mine")}
          >
            <IconUser width={12} height={12} />
            {t("scopeMine")}
          </button>
          <button
            type="button"
            aria-pressed={scope === "all"}
            onClick={() => setScope("all")}
            className={filterChipClass(scope === "all")}
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
          onMove={requestMove}
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

      {openId !== null ? (
        <ProjectDetail id={openId} meId={meId} isAdmin={isAdmin} onClose={() => router.replace("/projects")} />
      ) : null}

      {pendingMove !== null ? (
        <ConfirmDialog
          title={t("moveTitle")}
          body={t("moveBody", {
            n: digits(pendingMove.tasks.length, locale),
            name: pendingMove.project.name,
            column: columns.find((c) => c.id === pendingMove.columnId)?.name ?? "",
          })}
          confirmLabel={t("moveConfirm")}
          cancelLabel={tTasks("cancel")}
          danger={false}
          busy={moving}
          onConfirm={() => void confirmMove()}
          onCancel={() => setPendingMove(null)}
        />
      ) : null}

      {creating ? (
        <ProjectDialog
          mode="create"
          people={people}
          meId={meId}
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false);
            router.push(`/projects?project=${p.id}`);
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
 * DRAG MOVES THE WORK (user, 2026-09-05: "add it for the projects kanban as
 * well"). A project's column is DERIVED from where its work sits (see the
 * header's rule), so a dragged project card cannot be stored anywhere — what
 * it can do is carry the project's unfinished tasks to the column it was
 * dropped on, after a confirm that names how many (`requestMove` above). Done
 * tasks stay. The derived column then reads the target, which is what the
 * hand asked for.
 */
function ProjectKanban({ columns, projects, columnOf, people, locale, isAdmin, onAdd, onMove }: {
  columns: TaskColumnRecord[];
  projects: ProjectRecord[];
  columnOf: (p: ProjectRecord) => string | null;
  people: OrgPersonRecord[];
  locale: string;
  isAdmin: boolean;
  onAdd: () => void;
  onMove: (project: ProjectRecord, columnId: string) => void;
}) {
  const t = useTranslations("projects");
  /** the card in the air, and the column under the pointer (holdDrag) */
  const [lifted, setLifted] = useState<{ id: string; over: string | null } | null>(null);
  return (
    /* THE BOARD, from the board's own module (R17, user ruling 2026-09-05:
       "two same kanban tables … supposed to be the same but they are
       different"). The first version of this function COPIED TaskBoard's
       numbers, and by the same evening the copies disagreed — a 12px title
       here against the board's 13, the count in a different corner, cards in
       a different box, no tone on the column. Nothing here is a number now;
       every class is boardStyle's, and the guard keeps it that way. */
    <div className={BOARD_LANE}>
      {columns.map((col) => {
        const here = projects.filter((p) => columnOf(p) === col.id);
        return (
          <section
            key={col.id}
            data-column={col.id}
            className={`${BOARD_COLUMN} ${lifted !== null && lifted.over === col.id ? "ring-2 ring-accent/60" : ""}`}
            aria-label={col.name}
          >
            <header className={BOARD_HEADER}>
              <span className={BOARD_HEADER_START}>
                <BoardTone tone={col.tone} />
                <h2 className={BOARD_TITLE}>
                  <bdi>{col.name}</bdi>
                </h2>
              </span>
              <span className={BOARD_HEADER_END}>
                <span className={BOARD_COUNT}>{digits(here.length, locale)}</span>
              </span>
            </header>
            <div className={BOARD_CARDS}>
              {here.map((p) => (
                <DraggableProjectCard
                  key={p.id}
                  project={p}
                  people={people}
                  locale={locale}
                  lifted={lifted !== null && lifted.id === p.id}
                  onLift={() => setLifted({ id: p.id, over: null })}
                  onOver={(over) => setLifted((cur) => (cur !== null && cur.id === p.id ? { id: cur.id, over } : cur))}
                  onDrop={(over) => {
                    setLifted(null);
                    if (over !== null && over !== col.id) onMove(p, over);
                  }}
                  onCancel={() => setLifted(null)}
                />
              ))}
              {/* THE WAY IN LIVES IN THE COLUMN (user directive, 2026-09-05):
                  a project is made where it is going to sit. Admin-only,
                  because creating a project is (0186). */}
              {isAdmin ? (
                <BoardAddRow label={t("addProject")} onClick={onAdd} />
              ) : here.length === 0 ? (
                <p className="px-1 py-4 text-center text-[11px] text-fg-subtle">{t("noneHere")}</p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** the kanban's card with a hand on it — one hook per card, which is why it
    is its own component rather than a loop body */
function DraggableProjectCard({ project, people, locale, lifted, onLift, onOver, onDrop, onCancel }: {
  project: ProjectRecord;
  people: OrgPersonRecord[];
  locale: string;
  lifted: boolean;
  onLift: () => void;
  onOver: (columnId: string | null) => void;
  onDrop: (columnId: string | null) => void;
  onCancel: () => void;
}) {
  const drag = useHoldDrag({ onLift, onOver, onDrop, onCancel });
  return <ProjectCard project={project} people={people} locale={locale} compact drag={drag} lifted={lifted} />;
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
            href={`/projects?project=${p.id}`}
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
                  href={`/projects?project=${project.id}`}
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

function ProjectCard({ project, people, locale, compact = false, drag, lifted = false }: {
  project: ProjectRecord;
  people: OrgPersonRecord[];
  locale: string;
  /** on the kanban, where the card lives in a 288px column: the same card
      with less air, never a second card. Two drawings of one thing is the
      pair that stops matching the first time either gains a field. */
  compact?: boolean;
  /** the kanban's hand (holdDrag) — absent on the list and the calendar */
  drag?: HoldDragHandlers;
  lifted?: boolean;
}) {
  const t = useTranslations("projects");
  const ratio = progressOf(project);
  const members = project.member_ids
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is OrgPersonRecord => p !== undefined);

  return (
    <Link
      href={`/projects?project=${project.id}`}
      /* on the kanban the card is also the thing a hand moves (holdDrag): an
         anchor's own native drag is switched off so a mouse can lift it, and
         the click the browser fires after a drop is swallowed */
      draggable={false}
      data-card={project.id}
      onPointerDown={drag?.onPointerDown}
      onClick={(e) => { if (drag?.consumeClick()) e.preventDefault(); }}
      /*
       * `h-auto shrink-0` ON THE KANBAN CARD, and it is not a nicety: `.tile`
       * declares `height: 100%`, which inside a flex COLUMN resolves against
       * the column's height — so every project card stretched to fill the
       * whole 70vh lane and two projects filled the screen. On the projects
       * LIST the tile is in a grid, where 100% is what makes a row of cards
       * the same height, so the override belongs to the compact variant
       * alone.
       */
      className={
        compact
          ? /* on the board it is the board's card — the box a task sits in,
               read from the same module (R17) */
            `${BOARD_CARD} flex flex-col gap-1.5 ${lifted ? "relative z-50 cursor-grabbing ring-2 ring-accent shadow-island" : ""}`
          : "tile flex flex-col gap-3 p-4 transition-colors hover:border-accent/40"
      }
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
