"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type {
  OrgPersonRecord, TaskCardRecord, TaskColumnRecord, TaskDetailRecord,
  TaskLabelRecord, TaskPriority, TaskTopicRecord, ProjectRecord,
} from "@/api/types";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import {
  LABEL_COLORS, NewTaskDialog, PRIORITY_CHIP, PRIORITY_ORDER, TONE_CHIP, TONE_DOT,
} from "./tasks/TaskDialogs";
import { TaskDetail } from "./tasks/TaskDetail";
import {
  BOARD_ADD_COLUMN, BOARD_CARD, BOARD_CARDS, BOARD_COLUMN, BOARD_COUNT, BOARD_HEADER,
  BOARD_HEADER_END, BOARD_HEADER_START, BOARD_LANE, BOARD_TITLE, BoardAddRow,
} from "./board/boardStyle";
import { ProjectDialog } from "./ProjectDialog";
import { TopicNameBox } from "./TopicNameBox";
import { useHoldDrag } from "./board/holdDrag";
import { TaskCalendar, TaskListView } from "./tasks/TaskViews";
import {
  IconCheck, IconClock, IconDots, IconFolder, IconPlus, IconRetry,
  IconTrash, IconUser, IconVideo, IconPencil } from "@/components/icons";
import { useSeededName } from "@/lib/seededNames";
import { digits, personName } from "@/lib/format";
import { useRefreshEpoch } from "@/lib/refreshBus";

/**
 * THE TASK BOARD — rebuilt from the reference's own product (walked screen
 * by screen on 2026-09-01, not from a screenshot):
 *
 *   one toolbar row  کانبان|لیست|تقویم|آرشیو · همه|بحرانی|زیاد|متوسط|کم ·
 *                    فقط تسک‌های من · مهلت امروز        [تسک جدید]
 *   the topic row    [+] همه تسک‌ها · topics with a dot and a menu · بدون موضوع
 *   the board        columns that rename in place, take a tone, archive and
 *                    reorder by drag; cards that check off, wear labels and
 *                    carry the record they came from
 *
 * Everything the toolbar decides is a filter over ONE board read — under
 * RLS a client that filtered a page would report a count for whatever it
 * happened to have downloaded.
 */

type View = "kanban" | "list" | "calendar" | "archive";
type PriorityFilter = TaskPriority | "all";

export function TaskBoard() {
  const t = useTranslations("tasks");
  /* the four SEEDED column names localize until somebody renames one — the
     board writes them into the database in Persian on first visit */
  const seededName = useSeededName();
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const [board, setBoard] = useState<{
    columns: TaskColumnRecord[]; topics: TaskTopicRecord[]; tasks: TaskCardRecord[];
  } | null>(null);
  const [archive, setArchive] = useState<{ columns: TaskColumnRecord[]; tasks: TaskCardRecord[] } | null>(null);
  const [labels, setLabels] = useState<TaskLabelRecord[]>([]);
  const [people, setPeople] = useState<OrgPersonRecord[]>([]);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>("kanban");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [dueToday, setDueToday] = useState(false);
  const [topic, setTopic] = useState<string>("all");
  /* the folder strip's inline composer: adding, or the folder being renamed */
  const [addingTopic, setAddingTopic] = useState(false);
  const [renamingTopic, setRenamingTopic] = useState<{ id: string; name: string } | null>(null);
  /* every project, live and archived — the strip splits the board's folders
     into the ones that ARE a project's category and the plain ones (user,
     2026-09-05: "complete folder and its plus, and complete projects and its
     plus"); a topic carries no project id, so the split is read off the
     projects themselves */
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  /** the card in the air, and the column under the pointer (holdDrag) */
  const [lifted, setLifted] = useState<{ id: string; over: string | null } | null>(null);
  const [me, setMe] = useState<{ id: string } | null>(null);
  /* 0186 made creating a project an admin's act, and both doors below
     lead there. `false` while /me is in flight, so the controls are
     absent until the answer arrives rather than appearing and being
     refused — erring toward absent is the safe direction for a
     permission. */
  const [isAdmin, setIsAdmin] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);

  /* the COLUMN the new-card form was opened from — null when closed. A
     boolean would have lost which column was pressed, which is the whole
     reason the button moved into the column. */
  const [creating, setCreating] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<TaskDetailRecord | null>(null);
  const [condemnedColumn, setCondemnedColumn] = useState<TaskColumnRecord | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [toneMenu, setToneMenu] = useState<string | null>(null);
  const draggedColumn = useRef<string | null>(null);

  const load = useCallback(() => {
    void api.taskBoard()
      .then((b) => { setBoard(b); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);
  const loadLabels = useCallback(() => {
    void api.taskLabels().then(setLabels).catch(() => undefined);
  }, []);

  /*
   * A WRITE ANYWHERE REACHES THIS BOARD (user report, 2026-09-04: "when the
   * assistant adds a task the related tables should get refreshed — I have to
   * refresh by hand").
   *
   * The epoch bumps on any successful non-GET to `/api/tasks`, whoever made
   * it: this screen's own buttons, another tab, or the assistant's hands in
   * the panel beside it — they all press the same client methods, so they all
   * flow through the same announcer. In the deps of the load effect, a bump
   * is a refetch.
   *
   * A second fetch after this screen's OWN action is the price of never being
   * stale, and it is an idempotent GET.
   */
  const tasksEpoch = useRefreshEpoch("tasks");
  useEffect(load, [load, tasksEpoch]);
  useEffect(loadLabels, [loadLabels, tasksEpoch]);
  useEffect(() => {
    void api.me()
      .then((who) => {
        setMe(who);
        setIsAdmin(who?.role === "admin" || who?.role === "owner");
      })
      .catch(() => { setMe(null); setIsAdmin(false); });
  }, []);
  useEffect(() => { void api.orgPeople().then(setPeople).catch(() => setPeople([])); }, []);
  const projectsEpoch = useRefreshEpoch("projects");
  useEffect(() => {
    void Promise.all([api.projects(), api.projects({ archived: true })])
      .then(([live, archived]) => setProjects([...live, ...archived]))
      .catch(() => setProjects([]));
  }, [projectsEpoch, tasksEpoch]);

  useEffect(() => {
    if (view !== "archive") return;
    void api.taskBoard({ archived: true })
      .then((b) => setArchive({ columns: b.columns, tasks: b.tasks }))
      .catch(() => setArchive(null));
  }, [view]);

  /* ?topic= — a project's «وظایف» button lands on the board already
     standing in that project's folder (0181). Read ONCE into the filter
     rather than held as the source of truth: the chips must stay pressable
     afterwards, and a URL that keeps re-asserting itself is a filter the
     person cannot change. */
  const linkedTopic = params.get("topic");
  useEffect(() => {
    if (linkedTopic !== null) setTopic(linkedTopic);
  }, [linkedTopic]);

  /* ?task= deep link — the reference's own URL carries it too */
  const linkedTask = params.get("task");
  useEffect(() => {
    if (linkedTask === null) return;
    void api.taskDetail(linkedTask).then(setOpenTask).catch(() => undefined);
  }, [linkedTask]);

  const openDetail = useCallback((id: string) => {
    void api.taskDetail(id).then(setOpenTask).catch(() => setError(t("writeFailed")));
  }, [t]);

  const refusal = useCallback(() => setError(t("writeFailed")), [t]);

  const patchTask = useCallback(async (id: string, patch: Record<string, unknown>) => {
    try {
      setError(null);
      const updated = await api.updateTask(id, patch);
      setBoard((prev) => prev === null ? prev : {
        ...prev,
        tasks: prev.tasks.map((x) => (x.id === id ? { ...x, ...updated } : x)),
      });
      setOpenTask((prev) => (prev?.id === id ? updated : prev));
      if (patch.archived !== undefined) load();
    } catch {
      refusal();
      load(); /* the optimistic move comes back honestly */
    }
  }, [load, refusal]);

  const source = view === "archive" ? archive : board;
  const visible = useMemo(() => {
    const rows = source?.tasks ?? [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + 86_400_000;
    return rows.filter((task) =>
      (priority === "all" || task.priority === priority)
      && (topic === "all" || task.topic_id === topic)
      && (!mineOnly || me === null
          || task.assignee_ids.includes(me.id) || task.created_by === me.id)
      && (!dueToday || (task.due_at !== null
          && new Date(task.due_at).getTime() >= start.getTime()
          && new Date(task.due_at).getTime() < end)));
  }, [source, priority, topic, mineOnly, dueToday, me]);

  if (failed) return <p className="p-6 text-sm text-fg-muted">{t("readFailed")}</p>;
  if (board === null) return <p className="p-6 text-sm text-fg-muted">…</p>;

  const columnCards = (columnId: string) =>
    visible.filter((task) => task.column_id === columnId)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  /* a card dropped on a column: optimistic, then the write — a refused write
     reloads the truth (patchTask). The drop arrives from holdDrag now, never
     from the browser's dataTransfer. */
  const moveTask = (id: string, columnId: string) => {
    setBoard((prev) => prev === null ? prev : {
      ...prev,
      tasks: prev.tasks.map((x) => (x.id === id ? { ...x, column_id: columnId, position: -Date.now() } : x)),
    });
    void patchTask(id, { column_id: columnId, position: -Date.now() });
  };

  const projectByTopic = new Map(
    projects.filter((p) => p.topic_id !== null).map((p) => [p.topic_id as string, p]),
  );
  const folders = board.topics.filter((entry) => !projectByTopic.has(entry.id));
  const projectTopics = board.topics.filter((entry) => projectByTopic.has(entry.id));

  /* one chip for a folder and for a project's folder: the toggle, its count,
     and a ⋯ whose items are the caller's — the picture never differs, only
     what the menu offers */
  const topicChip = (entry: TaskTopicRecord, glyph: React.ReactNode, items: Parameters<typeof KebabMenu>[0]["items"]) => (
    <span
      key={entry.id}
      className={`btn btn-sm inline-flex cursor-default items-center gap-1.5 border pe-1 font-medium ${
        topic === entry.id ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted"
      }`}
    >
      <button
        type="button"
        aria-pressed={topic === entry.id}
        onClick={() => setTopic((cur) => (cur === entry.id ? "all" : entry.id))}
        className="tap inline-flex items-center gap-1.5 hover:text-fg"
      >
        {glyph}
        {entry.name}
        <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
          {digits(board.tasks.filter((x) => x.topic_id === entry.id).length, locale)}
        </span>
      </button>
      <KebabMenu label={t("topicOptions")} triggerClassName="h-5 w-5 rounded text-current opacity-60 hover:opacity-100" items={items} />
    </span>
  );

  /* 2026-09-03: the theme's compact control, not a twelfth invented size —
     and character for character the toolbar chip Meetings.tsx already wears,
     which is the point: two boards showing the same row of filters must not
     disagree about how a filter looks. The h-9/rounded-xl/px-3.5 it replaces
     was one of the eleven shapes the directive was describing. */
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── ONE toolbar row, in the reference's order ─────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {chip(view === "kanban", t("viewKanban"), () => setView("kanban"))}
          {chip(view === "list", t("viewList"), () => setView("list"))}
          {chip(view === "calendar", t("viewCalendar"), () => setView("calendar"))}
          {chip(view === "archive", t("viewArchive"), () => setView("archive"))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {chip(priority === "all", t("all"), () => setPriority("all"))}
          {PRIORITY_ORDER.map((level) =>
            chip(priority === level, t(`priority_${level}`), () => setPriority(level)))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {/*
           * THE WAY TO THE PROJECTS PAGE (user directive, 2026-09-05: "for
           * admins there must be a new button in the first sub menu before
           * only-my-tasks with the name projects, that when you press it will
           * navigate you to the project page so you can manage projects").
           *
           * Before «مال من», in the position the directive names. It is a
           * LINK and not a chip: the chips beside it change what this screen
           * shows and this one leaves it, so it never wears the pressed state
           * that would claim it is a filter. (It carried an arrow for that
           * until 2026-09-05 — "remove > icon from the projects" — the folder
           * glyph says enough.)
           *
           * Admin-only because managing projects is (0186) — and because the
           * rail entry was removed in the same directive, this is now the
           * door. A member reaches a project through its card on this board.
           */}
          {isAdmin ? (
            <Link
              href="/projects"
              className="btn btn-sm gap-1.5 border border-border font-medium text-fg-muted hover:text-fg"
            >
              <IconFolder width={12} height={12} />
              {t("projectsLink")}
            </Link>
          ) : null}
          {/* 2026-09-03: the same compact control as the chips beside them —
              these two were the same 36px box with a border added, which is
              a STATE (this filter is on), never a second geometry. `.btn` and
              `.btn-sm` draw no border of their own, so `border` stays. */}
          <button
            type="button"
            aria-pressed={mineOnly}
            onClick={() => setMineOnly((v) => !v)}
            className={`btn btn-sm gap-1.5 border font-medium ${
              mineOnly ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            <IconUser width={12} height={12} />
            {t("justMine")}
          </button>
          <button
            type="button"
            aria-pressed={dueToday}
            onClick={() => setDueToday((v) => !v)}
            className={`btn btn-sm gap-1.5 border font-medium ${
              dueToday ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            <IconClock width={12} height={12} />
            {t("dueTodayFilter")}
          </button>
        </div>
      </div>

      {/* ── the folder row: the board's folders, then its projects, each with
             its own + (user, 2026-09-05). «بدون موضوع» left the strip the same
             day — "in no folder" is a card's own fact, read on the card. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* 2026-09-03: the theme's control. This row and the toolbar row above
            it are the same kind of chip and were TWO different boxes — h-9 /
            rounded-xl up there, h-8 / rounded-lg down here — eight pixels
            apart on one screen, which is the directive in miniature. */}
        <button
          type="button"
          aria-pressed={topic === "all"}
          onClick={() => setTopic("all")}
          className={`btn btn-sm gap-1.5 border font-medium ${
            topic === "all" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          <IconFolder width={12} height={12} />
          {t("allTasks")}
          <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
            {digits(board.tasks.length, locale)}
          </span>
        </button>

        {/* plain folders: the meetings chip, field for field (user directive,
            2026-09-02: "the added sub menu should have edit and delete option,
            fix it both in tasks and meetings") — the same menu component, so
            the two boards cannot grow different answers to one question */}
        {folders.map((entry) => topicChip(entry, <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />, [
          {
            key: "rename",
            label: t("renameTopic"),
            icon: <IconPencil width={14} height={14} />,
            onSelect: () => { setAddingTopic(false); setRenamingTopic({ id: entry.id, name: entry.name }); },
          },
          {
            key: "remove",
            label: t("removeTopic"),
            icon: <IconTrash width={14} height={14} />,
            danger: true,
            /* archived, not deleted — the cards are re-pointed to no-folder
               by the schema */
            onSelect: () => {
              void api.updateTaskTopic(entry.id, { archived: true })
                .then(() => { setTopic((cur) => (cur === entry.id ? "all" : cur)); load(); })
                .catch(refusal);
            },
          },
        ]))}

        {/* THE FOLDER `+`, back (user, 2026-09-05: "return the previous new
            folder plus … with the same functions as before, like a new folder
            in meetings"): ONE composer for adding and renaming — the meetings
            strip's own box, shared now. Not admin-gated: a folder is a
            member's tool; a project (below) is an admin's. */}
        {addingTopic || renamingTopic !== null ? (
          <TopicNameBox
            initial={renamingTopic?.name ?? ""}
            placeholder={t("topicNamePlaceholder")}
            cancelLabel={t("cancel")}
            onCancel={() => { setAddingTopic(false); setRenamingTopic(null); }}
            onSubmit={(name) => {
              const target = renamingTopic;
              const done = () => { setAddingTopic(false); setRenamingTopic(null); load(); };
              void (target !== null
                ? api.updateTaskTopic(target.id, { name })
                : api.createTaskTopic(name).then(() => undefined))
                .then(done)
                .catch(() => { refusal(); done(); });
            }}
          />
        ) : (
          <button
            type="button"
            aria-label={t("addTopic")}
            title={t("addTopic")}
            onClick={() => setAddingTopic(true)}
            /* the MEETINGS chip-row's add button, exactly: dashed, the same
               square, in the same place */
            className="btn btn-icon border border-dashed border-border text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <IconPlus width={12} height={12} />
          </button>
        )}

        <span className="mx-1 h-5 w-px bg-border" aria-hidden />

        {/* PROJECTS: the folders that are a project's category (0181). The chip
            is the same chip; its menu opens the project, because the project
            owns the name — renaming the category under it would leave the
            board and the project disagreeing about what the thing is called. */}
        {projectTopics.map((entry) => {
          const project = projectByTopic.get(entry.id)!;
          return topicChip(
            entry,
            project.icon !== null
              ? <span className="text-[13px] leading-none" aria-hidden>{project.icon}</span>
              : <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />,
            [{
              key: "open",
              label: t("openProject"),
              icon: <IconFolder width={14} height={14} />,
              onSelect: () => router.push(`/projects?project=${project.id}`),
            }],
          );
        })}

        {isAdmin ? (
          /* THE PROJECT `+` (user directive, 2026-09-05: "the plus in the
             second top sub menu in tasks will open the new project pop up
             window") — at the end of the projects section, the same dashed
             square as the folder's. Admins only, and absent rather than
             disabled: 0186 made creating a project an admin's act, so for a
             member this button would open a dialog the wall refuses on save. */
          <button
            type="button"
            aria-label={t("newProjectFolder")}
            title={t("newProjectFolder")}
            onClick={() => setCreatingProject(true)}
            className="btn btn-icon border border-dashed border-border text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <IconPlus width={12} height={12} />
          </button>
        ) : null}
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/* ── the views ────────────────────────────────────────────────── */}
      {view === "kanban" ? (
        <div className={BOARD_LANE}>
          {[...board.columns].sort((a, b) => a.position - b.position).map((col) => (
            <section
              key={col.id}
              data-column={col.id}
              draggable={renaming !== col.id}
              onDragStart={(e) => {
                /*
                 * ONLY WHEN THE COLUMN ITSELF IS THE SOURCE (user report,
                 * 2026-09-04: "for moving cards by hand they all move
                 * together").
                 *
                 * `dragstart` BUBBLES. A card is inside its column and is
                 * draggable too, so picking one up fired the card's handler
                 * and then this one — the transfer left carrying BOTH a
                 * task id and a column id, and the drop below reads the
                 * column id first. Dragging one card moved the whole column,
                 * which on screen is every card in it moving at once.
                 *
                 * `e.target !== e.currentTarget` is the whole fix: the
                 * section starts a column drag only when the section is what
                 * was picked up.
                 */
                if (e.target !== e.currentTarget) return;
                draggedColumn.current = col.id;
                e.dataTransfer.setData("text/column-id", col.id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                /*
                 * ONE GUARD, at the source above — not two.
                 *
                 * This read was written as "prefer a task id, whatever else
                 * rode along", and it works; so does the source check. Which
                 * is the problem: with both in place NEITHER can fail for its
                 * own reason, and a probe that removed each in turn left the
                 * suite green — only removing both reproduced the bug. A
                 * second mechanism that the tests cannot exercise reads as
                 * rigour and is a place for a future edit to hide.
                 *
                 * The source check is the stronger single one: it stops the
                 * column id reaching the transfer at all, so `draggedColumn`
                 * is not set either, and there is one fact about what was
                 * picked up rather than two that could disagree.
                 */
                const columnId = e.dataTransfer.getData("text/column-id");
                if (columnId !== "" && columnId !== col.id) {
                  /* dropping column A onto column B takes B's slot */
                  void api.updateTaskColumn(columnId, { position: col.position - 0.5 })
                    .then(load).catch(refusal);
                  draggedColumn.current = null;
                  return;
                }
              }}
              /* A COLUMN IS AS TALL AS THE BOARD, not as tall as its cards
                 (user directive): an empty column that hugs three lines of
                 chrome reads as a smaller thing than a full one, and a card
                 dragged toward it has almost no target. `self-stretch` fills
                 the scroller's height; `min-h-[70vh]` keeps it a column
                 rather than a strip when the board itself is short. */
              className={`${BOARD_COLUMN} ${lifted !== null && lifted.over === col.id ? "ring-2 ring-accent/60" : ""}`}
              aria-label={seededName(col.name)}
            >
              {/* 2026-09-03: `gap-1`, not `gap-2` — the tone trigger beside it
                  became the theme's 28px well and carries 9px of inset of its
                  own, so the OLD 8px gap would have read as 17. The pair is a
                  relationship, not two numbers. */}
              <header className={BOARD_HEADER}>
                <span className={BOARD_HEADER_START}>
                  <span className="relative">
                    {/* 2026-09-03: the theme's icon control — and the PICTURE is
                        unchanged: the 10px tone dot moved INSIDE a `.btn-icon`
                        well instead of being the button itself. It is the same
                        widget as the swatches in the menu it opens — those are
                        already `btn btn-icon` with a coloured square inside, so
                        "a pressable that shows a colour" now has one spelling
                        in this file rather than two. What actually
                        changes is the target: a 10px box with no `.tap` becomes
                        28px with a 44px hit area below md, and the header was
                        already that tall — the trash at its other end is a
                        `.btn-icon`. The menu's offset moves with it (top-5 →
                        top-8) or it would open across the button it belongs
                        to. */}
                    <button
                      type="button"
                      aria-label={t("columnColor")}
                      title={t("columnColor")}
                      onClick={() => setToneMenu((cur) => (cur === col.id ? null : col.id))}
                      className="btn btn-icon hover:bg-surface-2"
                    >
                      <span
                        className={`block h-2.5 w-2.5 rounded-full ${TONE_DOT[col.tone] ?? TONE_DOT.grey!}`}
                        aria-hidden
                      />
                    </button>
                    {toneMenu === col.id ? (
                      <span className="absolute top-8 z-40 flex w-40 flex-wrap gap-1 rounded-xl border border-border bg-surface p-2 shadow-island">
                        {LABEL_COLORS.map((tone) => (
                          <button
                            key={tone}
                            type="button"
                            aria-label={tone}
                            onClick={() => {
                              setToneMenu(null);
                              void api.updateTaskColumn(col.id, { tone }).then(load).catch(refusal);
                            }}
                            /* 2026-09-03: the theme's icon control. The 16px
                               swatch INSIDE it is the picture and stays as
                               it is — what changed is the 28px box a person
                               presses, which is `.btn-icon` and was h-7/
                               rounded-lg spelled by hand. */
                            className="btn btn-icon hover:bg-surface-2"
                          >
                            <span className={`h-4 w-4 rounded-md ${TONE_DOT[tone] ?? TONE_DOT.grey!}`} />
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  {renaming === col.id ? (
                    /* KEPT hand-drawn, and this is a measurement rather than a
                       preference (2026-09-03). It is an in-place editor over a
                       28px header row — the tone well and the trash either side
                       of it are `.btn-icon`, 28 — and it carries the title's own
                       `text-sm font-semibold` so the name does not change size
                       when you click it. `.input-sm` COMPILES TO 44px (40 from
                       md), not the 34 its name promises: `@apply input …` re-
                       states `.input`'s min-height after the compact one, so the
                       override never reaches the stylesheet. Converting today
                       would grow this header by 12px on click and shrink the
                       title to 11.5px. First candidate the day that token
                       actually emits its own height. */
                    <input
                      autoFocus
                      defaultValue={col.name}
                      onBlur={(e) => {
                        setRenaming(null);
                        const name = e.target.value.trim();
                        if (name !== "" && name !== col.name) {
                          void api.updateTaskColumn(col.id, { name }).then(load).catch(refusal);
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      className="h-7 w-32 rounded-lg border border-accent bg-surface px-2 text-sm font-semibold text-fg outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      title={t("renameColumn")}
                      onClick={() => setRenaming(col.id)}
                      className={BOARD_TITLE}
                    >
                      {seededName(col.name)}
                    </button>
                  )}
                </span>
                <span className={BOARD_HEADER_END}>
                  <span className={BOARD_COUNT}>
                    {digits(columnCards(col.id).length, locale)}
                  </span>
                  <button
                    type="button"
                    aria-label={t("archiveColumn", { name: seededName(col.name) })}
                    title={t("archiveColumn", { name: seededName(col.name) })}
                    onClick={() => setCondemnedColumn(col)}
                    /* 2026-09-03: the theme's icon control — an icon-only
                       button is exactly what `.btn-icon` is measured for */
                    className="btn btn-icon text-fg-subtle hover:text-danger"
                  >
                    <IconTrash width={12} height={12} />
                  </button>
                </span>
              </header>

              <div className={BOARD_CARDS}>
                {columnCards(col.id).map((task) => (
                  <Card
                    key={task.id}
                    task={task}
                    labels={labels}
                    people={people}
                    lifted={lifted !== null && lifted.id === task.id}
                    onLift={() => setLifted({ id: task.id, over: null })}
                    onOver={(over) => setLifted((cur) => (cur !== null && cur.id === task.id ? { id: cur.id, over } : cur))}
                    onDrop={(over) => {
                      setLifted(null);
                      if (over !== null && over !== task.column_id) moveTask(task.id, over);
                    }}
                    onCancel={() => setLifted(null)}
                    onOpen={() => openDetail(task.id)}
                    onToggleDone={(done) => void patchTask(task.id, { done })}
                  />
                ))}
                {/* the full form, opened FROM the column — a card is made
                    where it is going to live, and the board no longer carries
                    a separate «تسک جدید» that had to be told the column */}
                <BoardAddRow label={t("addCard")} onClick={() => setCreating(col.id)} />
              </div>
            </section>
          ))}

          {/* a window.prompt is the browser's dialog, not ours — and it was
              the one place on this board that still looked like somebody
              else's product. Same inline shape as adding a card. */}
          <AddColumnInline onAdded={load} onRefused={refusal} />
        </div>
      ) : null}

      {view === "list" ? (
        <TaskListView
          tasks={visible}
          columns={board.columns}
          labels={labels}
          onOpen={openDetail}
          onToggleDone={(id, done) => void patchTask(id, { done })}
        />
      ) : null}

      {view === "calendar" ? (
        <TaskCalendar
          tasks={visible}
          labels={labels}
          onOpen={openDetail}
          onToggleDone={(id, done) => void patchTask(id, { done })}
        />
      ) : null}

      {view === "archive" ? (
        archive === null ? <p className="p-4 text-sm text-fg-muted">…</p>
          : archive.tasks.length === 0 ? <p className="p-4 text-sm text-fg-muted">{t("archiveEmpty")}</p>
            : (
              <TaskListView
                tasks={visible}
                columns={archive.columns}
                labels={labels}
                onOpen={openDetail}
                onToggleDone={(id) => {
                  void api.updateTask(id, { archived: false }).then(() => {
                    load();
                    void api.taskBoard({ archived: true })
                      .then((b) => setArchive({ columns: b.columns, tasks: b.tasks }))
                      .catch(() => undefined);
                  }).catch(refusal);
                }}
              />
            )
      ) : null}

      {creating !== null ? (
        <NewTaskDialog
          people={people}
          columns={board.columns}
          topics={board.topics}
          labels={labels}
          defaultColumnId={creating}
          defaultTopicId={topic !== "all" ? topic : null}
          onClose={() => setCreating(null)}
          onCreated={() => { setCreating(null); load(); }}
          onLabelsChanged={loadLabels}
        />
      ) : null}

      {openTask !== null ? (
        <TaskDetail
          task={openTask}
          columns={board.columns}
          topics={board.topics}
          labels={labels}
          people={people}
          onClose={() => {
            setOpenTask(null);
            if (linkedTask !== null) router.replace("/tasks");
            load();
          }}
          onChanged={() => {
            load();
            setOpenTask((prev) => {
              if (prev === null) return prev;
              void api.taskDetail(prev.id).then(setOpenTask).catch(() => undefined);
              return prev;
            });
          }}
          onLabelsChanged={loadLabels}
        />
      ) : null}

      {condemnedColumn !== null ? (
        <ConfirmDialog
          title={t("archiveColumnTitle", { name: condemnedColumn.name })}
          body={t("archiveColumnBody")}
          confirmLabel={t("archiveConfirm")}
          cancelLabel={t("cancel")}
          onCancel={() => setCondemnedColumn(null)}
          onConfirm={() => {
            const target = condemnedColumn;
            setCondemnedColumn(null);
            void api.updateTaskColumn(target.id, { archived: true })
              .then(load).catch(refusal);
          }}
        />
      ) : null}

      {/* THE PROJECT DIALOG, the board's own copy of the projects page's —
          the SAME component, so the two doors into "make a project" cannot
          grow different fields. `load()` afterwards rather than a redirect:
          the person opened this from the board and the new folder appears in
          the row they pressed, which is where they were looking. */}
      {creatingProject ? (
        <ProjectDialog
          mode="create"
          people={people}
          meId={me?.id ?? null}
          onClose={() => setCreatingProject(false)}
          onSaved={() => { setCreatingProject(false); load(); }}
          onFailed={() => { setCreatingProject(false); refusal(); }}
        />
      ) : null}
    </div>
  );
}

/** the reference's card: title, labels, its record, priority, progress —
    and the thing a hand moves (holdDrag: a click opens it, a hold lifts it) */
function Card({ task, labels, people, lifted, onLift, onOver, onDrop, onCancel, onOpen, onToggleDone }: {
  task: TaskCardRecord;
  labels: TaskLabelRecord[];
  people: OrgPersonRecord[];
  lifted: boolean;
  onLift: () => void;
  onOver: (columnId: string | null) => void;
  onDrop: (columnId: string | null) => void;
  onCancel: () => void;
  onOpen: () => void;
  onToggleDone: (done: boolean) => void;
}) {
  const t = useTranslations("tasks");
  const drag = useHoldDrag({ onLift, onOver, onDrop, onCancel });
  const locale = useLocale();
  const worn = labels.filter((label) => task.label_ids.includes(label.id));
  /*
   * WHO IT IS FOR, on the card (user directive, 2026-09-04: "in the same row
   * as the priority, on the other end, add the assigned person name").
   *
   * The board already holds the roster, so this costs no request. Order is
   * the roster's, not `assignee_ids`', so two cards showing the same pair of
   * people name the same one first — a card is scanned, and a list that
   * reorders itself between rows cannot be.
   */
  const assigned = people.filter((person) => task.assignee_ids.includes(person.id));
  /* somebody is assigned whom the roster does not carry — a former colleague,
     or a roster that came back empty. The COUNT is still true, so the card
     says how many rather than quietly saying nobody. */
  const unnamed = task.assignee_ids.length - assigned.length;
  return (
    <div
      data-card={task.id}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerLeave={drag.onPointerLeave}
      onPointerCancel={drag.onPointerCancel}
      /* a lifted card rides above its column and says so; the transform that
         carries it is written by the hook, not by a render per pointer move */
      className={`${BOARD_CARD} ${lifted ? "relative z-50 cursor-grabbing ring-2 ring-accent shadow-island" : ""}`}
      onClick={() => { if (drag.consumeClick()) return; onOpen(); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
    >
      <div className="flex items-start gap-2">
        {/* KEPT, and recorded in control.guard.test.ts's worklist (2026-09-03):
            this is a CHECKBOX, not a button — 16px is the box a tick lives in,
            and the platform draws the same one in five places (the checklist
            and the list row here, the meeting's items panel and mini-tasks).
            `.btn-icon` is 28px, which beside a 14px line of text stops reading
            as a checkbox, and converting one of the five would create the
            divergence this guard exists to close. If they ever move, they move
            together — as a checkbox, not as five buttons. */}
        <button
          type="button"
          aria-label={t("markDone")}
          onClick={(e) => { e.stopPropagation(); onToggleDone(!task.done); }}
          className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
            task.done ? "border-accent bg-accent text-on-accent" : "border-border"
          }`}
        >
          {task.done ? <IconCheck width={12} height={12} /> : null}
        </button>
        <span className={`min-w-0 flex-1 text-sm leading-5 ${task.done ? "text-fg-subtle line-through" : "text-fg"}`}>
          {task.title}
        </span>
      </div>

      {worn.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {worn.map((label) => (
            <span key={label.id}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TONE_CHIP[label.color] ?? TONE_CHIP.grey!}`}>
              {label.name}
            </span>
          ))}
        </div>
      ) : null}

      {task.call_id !== null ? (
        <span className="mt-2 flex items-center gap-1 truncate rounded-md bg-accent-soft px-1.5 py-1 text-[11px] text-accent">
          <IconVideo width={12} height={12} />
          {t("fromRecord")}: {task.call_title ?? t("recordGone")}
        </span>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_CHIP[task.priority]}`}>
          {t(`priority_${task.priority}`)}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-fg-subtle">
          {assigned.length > 0 || unnamed > 0 ? (
            <span className="flex min-w-0 items-center gap-1" title={
              [...assigned.map((p) => personName(p, locale)),
                ...(unnamed > 0 ? [t("assigneeUnnamed")] : [])].join("، ")
            }>
              {/* name only — see the assignee chip (user directive) */}
              {assigned[0] !== undefined ? (
                <span className="truncate">{personName(assigned[0], locale)}</span>
              ) : (
                <span className="truncate">{t("assigneeUnnamed")}</span>
              )}
              {/* the rest as a count, so a card with five owners stays a card */}
              {task.assignee_ids.length > 1 ? (
                <span className="ltr shrink-0">+{digits(task.assignee_ids.length - 1, locale)}</span>
              ) : null}
            </span>
          ) : null}
          {task.due_at !== null ? <span>{t("due")}</span> : null}
          {task.checklist_total > 0 ? (
            <span className="ltr">{digits(task.checklist_done, locale)}/{digits(task.checklist_total, locale)}</span>
          ) : null}
          {task.comment_count > 0 ? (
            <span className="ltr">{digits(task.comment_count, locale)}</span>
          ) : null}
          {/* A REPEATING ORDER (0186), marked on the card because it changes
              what finishing MEANS: ticking this one produces the next. A
              person moving it to «انجام‌شده» should be able to see that from
              the board rather than discover it when the card comes back. */}
          {task.recurrence_id !== null ? (
            <IconRetry width={12} height={12} aria-label={t("repeats")} />
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** the reference's foot-of-column composer: type, Enter, it lands on top */
/**
 * ADDING A COLUMN, written the way adding a card is (user directive).
 *
 * It replaced a `window.prompt`, which is the browser's dialog and not
 * ours — the one control on this board that still looked like somebody
 * else's product, with somebody else's typeface and somebody else's buttons.
 * This is the same anatomy as the card adder it sits beside: a dashed
 * invitation that becomes a field with cancel and add.
 */
function AddColumnInline({ onAdded, onRefused }: {
  onAdded: () => void; onRefused: () => void;
}) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const add = () => {
    if (name.trim() === "") { setOpen(false); return; }
    void api.createTaskColumn(name.trim())
      .then(() => { setName(""); setOpen(false); onAdded(); })
      .catch(onRefused);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={BOARD_ADD_COLUMN}
      >
        <IconPlus width={14} height={14} />
        {t("addColumn")}
      </button>
    );
  }
  return (
    <div className="card w-[220px] shrink-0 border-accent p-2">
      {/* NOT `.input-sm` (2026-09-03): the CARD is the box — border, ground and
          corner are the column-shaped panel this composer becomes — so a themed
          field would draw a second one inside it. Same shape as the topic
          composer above, deliberately. */}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
          if (e.key === "Escape") { setName(""); setOpen(false); }
        }}
        placeholder={t("columnNamePlaceholder")}
        className="h-8 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
      {/* 2026-09-03: the theme's compact control on both. These two were a
          TWELFTH shape — h-7 / rounded-lg / 11px — and the guard walked past
          them only because neither spelled a centring class; a dialog footer
          is the case `.btn-sm` was measured for. `disabled:opacity-50` goes
          with them: `.btn` already carries the disabled treatment. */}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={() => { setName(""); setOpen(false); }}
          className="btn btn-sm text-fg-muted hover:text-fg">
          {t("cancel")}
        </button>
        <button type="button" onClick={add} disabled={name.trim() === ""}
          className="btn btn-sm bg-accent text-on-accent">
          {t("add")}
        </button>
      </div>
    </div>
  );
}

export { IconDots };
