"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type {
  OrgPersonRecord, TaskCardRecord, TaskColumnRecord, TaskDetailRecord,
  TaskLabelRecord, TaskPriority, TaskTopicRecord,
} from "@/api/types";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import {
  LABEL_COLORS, NewTaskDialog, PRIORITY_CHIP, PRIORITY_ORDER, TONE_CHIP, TONE_DOT,
} from "./tasks/TaskDialogs";
import { TaskDetail } from "./tasks/TaskDetail";
import { TaskCalendar, TaskListView } from "./tasks/TaskViews";
import {
  IconCheck, IconClock, IconDots, IconFolder, IconPlus, IconTrash, IconUser, IconVideo, IconClose, IconPencil } from "@/components/icons";
import { useSeededName } from "@/lib/seededNames";
import { Avatar } from "@/components/Avatar";
import { digits, personName } from "@/lib/format";

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
  /* the inline topic composer — open, and the name being typed */
  const [addingTopic, setAddingTopic] = useState(false);
  const [topicName, setTopicName] = useState("");
  /** the topic being renamed — the inline composer doubles as the editor */
  const [renamingTopic, setRenamingTopic] = useState<{ id: string; name: string } | null>(null);
  const [me, setMe] = useState<{ id: string } | null>(null);

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

  useEffect(load, [load]);
  useEffect(loadLabels, [loadLabels]);
  useEffect(() => { void api.me().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { void api.orgPeople().then(setPeople).catch(() => setPeople([])); }, []);

  useEffect(() => {
    if (view !== "archive") return;
    void api.taskBoard({ archived: true })
      .then((b) => setArchive({ columns: b.columns, tasks: b.tasks }))
      .catch(() => setArchive(null));
  }, [view]);

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
      && (topic === "all" || (topic === "none" ? task.topic_id === null : task.topic_id === topic))
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

  const dropCard = (columnId: string, e: React.DragEvent) => {
    const id = e.dataTransfer.getData("text/task-id");
    if (id === "") return;
    setBoard((prev) => prev === null ? prev : {
      ...prev,
      tasks: prev.tasks.map((x) => (x.id === id ? { ...x, column_id: columnId, position: -Date.now() } : x)),
    });
    void patchTask(id, { column_id: columnId, position: -Date.now() });
  };

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

      {/* ── the topic row ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">

        {/* 2026-09-03: the theme's control. This row and the toolbar row above
            it are the same kind of chip and were TWO different boxes — h-9 /
            rounded-xl up there, h-8 / rounded-lg down here — eight pixels
            apart on one screen, which is the directive in miniature. The
            topic chip between them already wore `.btn btn-sm`; now its two
            neighbours match it instead of it standing out. */}
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

        {/* the meetings chip, field for field (user directive, 2026-09-02:
            "the added sub menu should have edit and delete option, fix it
            both in tasks and meetings") — the same menu component, so the
            two boards cannot grow different answers to one question */}
        {board.topics.map((entry) => (
          /* the meetings chip, field for field — the menu inside, the select
             a button within the chip rather than a span wearing a role */
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
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              {entry.name}
              <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
                {digits(board.tasks.filter((x) => x.topic_id === entry.id).length, locale)}
              </span>
            </button>
            <KebabMenu
              label={t("topicOptions")}
              triggerClassName="h-5 w-5 rounded text-current opacity-60 hover:opacity-100"
              items={[
                {
                  key: "rename",
                  label: t("renameTopic"),
                  icon: <IconPencil width={14} height={14} />,
                  onSelect: () => setRenamingTopic({ id: entry.id, name: entry.name }),
                },
                {
                  key: "remove",
                  label: t("removeTopic"),
                  icon: <IconTrash width={14} height={14} />,
                  danger: true,
                  /* archived, not deleted — the cards are re-pointed to
                     no-folder by the schema */
                  onSelect: () => {
                    void api.updateTaskTopic(entry.id, { archived: true })
                      .then(() => { setTopic((cur) => (cur === entry.id ? "all" : cur)); load(); })
                      .catch(refusal);
                  },
                },
              ]}
            />
          </span>
        ))}

        <button
          type="button"
          aria-pressed={topic === "none"}
          onClick={() => setTopic((cur) => (cur === "none" ? "all" : "none"))}
          /* 2026-09-03: the theme's control, matching «همه تسک‌ها» at the
             other end of the same strip */
          className={`btn btn-sm gap-1.5 border font-medium ${
            topic === "none" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          <IconFolder width={12} height={12} />
          {t("noTopic")}
          <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
            {digits(board.tasks.filter((x) => x.topic_id === null).length, locale)}
          </span>
        </button>

        {/*
          INLINE, never `window.prompt` (user directive, 2026-09-02: "this top
          pop up should never appear anywhere in the platform … fix it like
          the new column that you wrote there").
          A native prompt is the browser's dialog, not ours: it says
          "app.neurai.pt says", it is unstyled in both themes, it cannot be
          dismissed by the platform's own Escape handling, and it blocks the
          page while it is up. The column composer beside this row already
          solved the same problem the right way, so this is that pattern,
          not a second one.
        */}
        {addingTopic || renamingTopic !== null ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-accent bg-surface px-1.5">
            {/* ONE composer, two jobs: a new topic and a rename. Two boxes
                would be two places for the same rules to be written down.

                NOT `.input-sm` (2026-09-03): this field draws no box because
                the SPAN around it does — border, ground and corner belong to
                the composer, which is one silhouette holding a field and a ✕.
                A themed field here would put a second box inside the first,
                and `.input`'s own `w-full` would push the ✕ out of it. */}
            <input
              autoFocus
              value={renamingTopic !== null && topicName === "" ? renamingTopic.name : topicName}
              onChange={(e) => setTopicName(e.target.value)}
              onKeyDown={(e) => {
                const value = (topicName || renamingTopic?.name || "").trim();
                if (e.key === "Enter" && value !== "") {
                  const done = () => { setTopicName(""); setAddingTopic(false); setRenamingTopic(null); load(); };
                  void (renamingTopic !== null
                    ? api.updateTaskTopic(renamingTopic.id, { name: value })
                    : api.createTaskTopic(value)
                  ).then(done).catch(refusal);
                }
                if (e.key === "Escape") { setTopicName(""); setAddingTopic(false); setRenamingTopic(null); }
              }}
              placeholder={t("newTopicPrompt")}
              className="h-[30px] w-36 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
            />
            <button
              type="button"
              aria-label={t("cancel")}
              onClick={() => { setTopicName(""); setAddingTopic(false); setRenamingTopic(null); }}
              /* 2026-09-03: the theme's icon control. The guard could not see
                 this one — it spelled its corner as a bare `rounded`, and the
                 pattern reads `rounded-md|lg|xl|2xl|full` — but a 24px
                 hand-rolled square is the same invention as the 28px ones
                 above it, and converting only what a check can count is how a
                 file ends up half-converted and looking it. */
              className="btn btn-icon text-fg-muted hover:text-fg"
            >
              <IconClose width={12} height={12} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={t("newTopic")}
            title={t("newTopic")}
            onClick={() => setAddingTopic(true)}
            /* the MEETINGS chip-row's add button, exactly: dashed, the same
               square, in the same place. Two boards showing the same row
               should not disagree about what "add a folder" looks like. */
            className="btn btn-icon border border-dashed border-border text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <IconPlus width={12} height={12} />
          </button>
        )}
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/* ── the views ────────────────────────────────────────────────── */}
      {view === "kanban" ? (
        <div className="scroll-quiet flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {[...board.columns].sort((a, b) => a.position - b.position).map((col) => (
            <section
              key={col.id}
              data-column={col.id}
              draggable={renaming !== col.id}
              onDragStart={(e) => {
                draggedColumn.current = col.id;
                e.dataTransfer.setData("text/column-id", col.id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const columnId = e.dataTransfer.getData("text/column-id");
                if (columnId !== "" && columnId !== col.id) {
                  /* dropping column A onto column B takes B's slot */
                  void api.updateTaskColumn(columnId, { position: col.position - 0.5 })
                    .then(load).catch(refusal);
                  draggedColumn.current = null;
                  return;
                }
                dropCard(col.id, e);
              }}
              /* A COLUMN IS AS TALL AS THE BOARD, not as tall as its cards
                 (user directive): an empty column that hugs three lines of
                 chrome reads as a smaller thing than a full one, and a card
                 dragged toward it has almost no target. `self-stretch` fills
                 the scroller's height; `min-h-[70vh]` keeps it a column
                 rather than a strip when the board itself is short. */
              className="flex w-[300px] shrink-0 flex-col self-stretch rounded-2xl border border-border bg-surface p-2.5 shadow-card min-h-[70vh]"
              aria-label={seededName(col.name)}
            >
              {/* 2026-09-03: `gap-1`, not `gap-2` — the tone trigger beside it
                  became the theme's 28px well and carries 9px of inset of its
                  own, so the OLD 8px gap would have read as 17. The pair is a
                  relationship, not two numbers. */}
              <header className="flex items-center justify-between gap-1 px-1 py-1">
                <span className="flex min-w-0 items-center gap-1">
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
                      className="truncate text-sm font-semibold text-fg"
                    >
                      {seededName(col.name)}
                    </button>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="badge-num rounded-md bg-surface-2 px-1.5 text-[11px] text-fg-subtle">
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

              <div className="scroll-quiet min-h-0 flex-1 space-y-2 overflow-y-auto pt-1">
                {columnCards(col.id).map((task) => (
                  <Card
                    key={task.id}
                    task={task}
                    labels={labels}
                    people={people}
                    onOpen={() => openDetail(task.id)}
                    onToggleDone={(done) => void patchTask(task.id, { done })}
                  />
                ))}
                {/* the full form, opened FROM the column — a card is made
                    where it is going to live, and the board no longer carries
                    a separate «تسک جدید» that had to be told the column */}
                <button
                  type="button"
                  onClick={() => setCreating(col.id)}
                  /* 2026-09-03: the theme's control. This is Meetings.tsx's
                     dashed whole-width "add" row verbatim — the two boards
                     invite you to add a thing in the same words and, until
                     now, in two different boxes. The dashed border is the
                     invitation and stays; `.btn`/`.btn-sm` draw none. */
                  className="btn btn-sm w-full justify-center gap-1.5 border border-dashed border-border font-medium text-fg-muted hover:border-border-strong hover:text-fg"
                >
                  <IconPlus width={12} height={12} />
                  {t("addCard")}
                </button>
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
          defaultTopicId={topic !== "all" && topic !== "none" ? topic : null}
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
    </div>
  );
}

/** the reference's card: title, labels, its record, priority, progress */
function Card({ task, labels, people, onOpen, onToggleDone }: {
  task: TaskCardRecord;
  labels: TaskLabelRecord[];
  people: OrgPersonRecord[];
  onOpen: () => void;
  onToggleDone: (done: boolean) => void;
}) {
  const t = useTranslations("tasks");
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
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/task-id", task.id)}
      className="cursor-pointer rounded-xl border border-border bg-surface p-3 shadow-card transition-colors hover:border-border-strong"
      onClick={onOpen}
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
              {assigned[0] !== undefined ? (
                <>
                  <Avatar name={personName(assigned[0], locale)} size="xs" />
                  <span className="truncate">{personName(assigned[0], locale)}</span>
                </>
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
        className="tap flex w-[220px] shrink-0 items-start justify-center gap-2 self-stretch rounded-2xl border border-dashed border-border pt-4 text-sm text-fg-muted hover:border-border-strong hover:text-fg min-h-[70vh]"
      >
        <IconPlus width={14} height={14} />
        {t("addColumn")}
      </button>
    );
  }
  return (
    <div className="w-[220px] shrink-0 rounded-2xl border border-accent bg-surface p-2">
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
