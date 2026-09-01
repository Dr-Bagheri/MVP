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
import { ConfirmDialog } from "@/components/rowActions";
import {
  LABEL_COLORS, NewTaskDialog, PRIORITY_CHIP, PRIORITY_ORDER, TONE_CHIP, TONE_DOT,
} from "./tasks/TaskDialogs";
import { TaskDetail } from "./tasks/TaskDetail";
import { TaskCalendar, TaskListView } from "./tasks/TaskViews";
import {
  IconCheck, IconClock, IconDots, IconFolder, IconPlus, IconTrash, IconUser, IconVideo,
} from "@/components/icons";
import { digits } from "@/lib/format";

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
  const [me, setMe] = useState<{ id: string } | null>(null);

  const [creating, setCreating] = useState(false);
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

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`tap flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-colors ${
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
          <button
            type="button"
            aria-pressed={mineOnly}
            onClick={() => setMineOnly((v) => !v)}
            className={`tap flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
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
            className={`tap flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
              dueToday ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            <IconClock width={12} height={12} />
            {t("dueTodayFilter")}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="tap flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent shadow-accent hover:opacity-90"
        >
          <IconPlus width={14} height={14} />
          {t("newTask")}
        </button>
      </div>

      {/* ── the topic row ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-label={t("newTopic")}
          title={t("newTopic")}
          onClick={() => {
            const name = window.prompt(t("newTopicPrompt"));
            if (name !== null && name.trim() !== "") {
              void api.createTaskTopic(name.trim()).then(load).catch(refusal);
            }
          }}
          className="tap grid h-8 w-8 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg"
        >
          <IconPlus width={12} height={12} />
        </button>

        <button
          type="button"
          aria-pressed={topic === "all"}
          onClick={() => setTopic("all")}
          className={`tap flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
            topic === "all" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          <IconFolder width={12} height={12} />
          {t("allTasks")}
          <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
            {digits(board.tasks.length, locale)}
          </span>
        </button>

        {board.topics.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={topic === entry.id}
            onClick={() => setTopic((cur) => (cur === entry.id ? "all" : entry.id))}
            className={`tap flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
              topic === entry.id ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            {entry.name}
            <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
              {digits(board.tasks.filter((x) => x.topic_id === entry.id).length, locale)}
            </span>
          </button>
        ))}

        <button
          type="button"
          aria-pressed={topic === "none"}
          onClick={() => setTopic((cur) => (cur === "none" ? "all" : "none"))}
          className={`tap flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
            topic === "none" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          <IconFolder width={12} height={12} />
          {t("noTopic")}
          <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
            {digits(board.tasks.filter((x) => x.topic_id === null).length, locale)}
          </span>
        </button>
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
              className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-border bg-surface p-2.5 shadow-card"
              aria-label={col.name}
            >
              <header className="flex items-center justify-between gap-1 px-1 py-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="relative">
                    <button
                      type="button"
                      aria-label={t("columnColor")}
                      title={t("columnColor")}
                      onClick={() => setToneMenu((cur) => (cur === col.id ? null : col.id))}
                      className={`block h-2.5 w-2.5 rounded-full ${TONE_DOT[col.tone] ?? TONE_DOT.grey!}`}
                    />
                    {toneMenu === col.id ? (
                      <span className="absolute top-5 z-40 flex w-40 flex-wrap gap-1 rounded-xl border border-border bg-surface p-2 shadow-island">
                        {LABEL_COLORS.map((tone) => (
                          <button
                            key={tone}
                            type="button"
                            aria-label={tone}
                            onClick={() => {
                              setToneMenu(null);
                              void api.updateTaskColumn(col.id, { tone }).then(load).catch(refusal);
                            }}
                            className="tap grid h-7 w-7 place-items-center rounded-lg hover:bg-surface-2"
                          >
                            <span className={`h-4 w-4 rounded-md ${TONE_DOT[tone] ?? TONE_DOT.grey!}`} />
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  {renaming === col.id ? (
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
                      {col.name}
                    </button>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="badge-num rounded-md bg-surface-2 px-1.5 text-[11px] text-fg-subtle">
                    {digits(columnCards(col.id).length, locale)}
                  </span>
                  <button
                    type="button"
                    aria-label={t("archiveColumn", { name: col.name })}
                    title={t("archiveColumn", { name: col.name })}
                    onClick={() => setCondemnedColumn(col)}
                    className="tap grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:text-danger"
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
                    onOpen={() => openDetail(task.id)}
                    onToggleDone={(done) => void patchTask(task.id, { done })}
                  />
                ))}
                <AddCardInline
                  columnId={col.id}
                  {...(topic !== "all" && topic !== "none" ? { topicId: topic } : {})}
                  onAdded={load}
                  onRefused={refusal}
                />
              </div>
            </section>
          ))}

          <button
            type="button"
            onClick={() => {
              const name = window.prompt(t("newColumnPrompt"));
              if (name !== null && name.trim() !== "") {
                void api.createTaskColumn(name.trim()).then(load).catch(refusal);
              }
            }}
            className="tap flex h-14 w-[220px] shrink-0 items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm text-fg-muted hover:text-fg"
          >
            <IconPlus width={14} height={14} />
            {t("addColumn")}
          </button>
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

      {creating ? (
        <NewTaskDialog
          columns={board.columns}
          topics={board.topics}
          labels={labels}
          defaultColumnId={board.columns[0]?.id ?? null}
          defaultTopicId={topic !== "all" && topic !== "none" ? topic : null}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
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
function Card({ task, labels, onOpen, onToggleDone }: {
  task: TaskCardRecord;
  labels: TaskLabelRecord[];
  onOpen: () => void;
  onToggleDone: (done: boolean) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const worn = labels.filter((label) => task.label_ids.includes(label.id));
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
        <span className="flex items-center gap-2 text-[11px] text-fg-subtle">
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
function AddCardInline({ columnId, topicId, onAdded, onRefused }: {
  columnId: string; topicId?: string; onAdded: () => void; onRefused: () => void;
}) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const add = () => {
    if (title.trim() === "") { setOpen(false); return; }
    void api.createTask({
      title: title.trim(), column_id: columnId,
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
    })
      .then(() => { setTitle(""); setOpen(false); onAdded(); })
      .catch(onRefused);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs text-fg-muted hover:text-fg"
      >
        <IconPlus width={12} height={12} />
        {t("addCard")}
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-accent bg-surface p-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
          if (e.key === "Escape") { setTitle(""); setOpen(false); }
        }}
        placeholder={t("cardTitlePlaceholder")}
        className="h-8 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={() => { setTitle(""); setOpen(false); }}
          className="tap h-7 rounded-lg px-2 text-[11px] text-fg-muted hover:text-fg">
          {t("cancel")}
        </button>
        <button type="button" onClick={add} disabled={title.trim() === ""}
          className="tap h-7 rounded-lg bg-accent px-2.5 text-[11px] font-semibold text-on-accent disabled:opacity-50">
          {t("add")}
        </button>
      </div>
    </div>
  );
}

export { IconDots };
