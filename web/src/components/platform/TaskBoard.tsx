"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { api, BffError } from "@/api/client";
import { Link, useRouter } from "@/i18n/routing";
import { ConfirmDialog } from "@/components/rowActions";
import {
  IconCheck, IconClose, IconPencil, IconPlus, IconTrash,
} from "@/components/icons";
import { formatRelativeDate } from "@/lib/format";
import type {
  Me, TaskCardRecord, TaskColumnRecord, TaskDetailRecord, TaskPriority, TaskTopicRecord,
} from "@/api/types";

/**
 * 0144 — THE TASK BOARD, in the reference's anatomy (user directive,
 * 2026-08-31: "i need their tasks section completely so take that").
 *
 * Three views over one read: the KANBAN (columns, drag between them), the
 * LIST (grouped by deadline presence), and the ARCHIVE. The filters —
 * priority, just-mine, due-today — and the topic chips narrow all three,
 * client-side deliberately: the board arrives whole in one read (it is the
 * org's work plan, not a paged feed), so filtering here costs nothing and
 * keeps every count consistent with what is on screen.
 *
 * Moves are optimistic and then CONFIRMED: the card moves in state, the
 * PATCH goes out, and a refusal puts it back with the refusal on screen —
 * a board that waits a round-trip per drag reads as broken.
 *
 * Deep link: `?task=<id>` opens the detail dialog, exactly as the
 * reference does — a task someone pastes into chat must open on arrival.
 */

const PRIORITY_ORDER: readonly TaskPriority[] = ["critical", "high", "medium", "low"];

const PRIORITY_TONE: Record<TaskPriority, string> = {
  critical: "bg-danger/12 text-danger",
  high: "bg-warning/12 text-warning",
  medium: "bg-accent-soft text-accent",
  low: "bg-surface-2 text-fg-muted",
};

const COLUMN_DOT: Record<string, string> = {
  grey: "bg-fg-subtle",
  blue: "bg-info",
  amber: "bg-warning",
  green: "bg-success",
};

type View = "kanban" | "list" | "archive";
type PriorityFilter = TaskPriority | "all";

interface Board {
  columns: TaskColumnRecord[];
  topics: TaskTopicRecord[];
  tasks: TaskCardRecord[];
}

function PriorityChip({ p }: { p: TaskPriority }) {
  const t = useTranslations("tasks");
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_TONE[p]}`}>
      {t(`priority_${p}`)}
    </span>
  );
}

/** the reference's card: title, the from-record chip, priority, progress */
function Card({ task, onOpen, onToggleDone }: {
  task: TaskCardRecord;
  onOpen: () => void;
  onToggleDone: (done: boolean) => void;
}) {
  const t = useTranslations("tasks");
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/task-id", task.id)}
      className="cursor-pointer rounded-xl border border-border bg-surface p-2.5 shadow-card transition-colors hover:border-border-strong"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={task.done}
          aria-label={t("markDone")}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleDone(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
        />
        <span className={`min-w-0 flex-1 text-sm leading-5 ${task.done ? "text-fg-subtle line-through" : "text-fg"}`}>
          {task.title}
        </span>
      </div>
      {task.call_id !== null ? (
        <span className="mt-2 block truncate rounded-md bg-surface-2 px-1.5 py-1 text-[11px] text-fg-muted">
          {t("fromRecord")}: {task.call_title ?? t("recordGone")}
        </span>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <PriorityChip p={task.priority} />
        <span className="flex items-center gap-2 text-[11px] text-fg-subtle">
          {task.due_at !== null ? <span>{t("due")}</span> : null}
          {task.checklist_total > 0 ? (
            <span className="ltr">{task.checklist_done}/{task.checklist_total}</span>
          ) : null}
          {task.comment_count > 0 ? <span className="ltr">💬 {task.comment_count}</span> : null}
        </span>
      </div>
    </div>
  );
}

export function TaskBoard() {
  const t = useTranslations("tasks");
  const router = useRouter();
  const params = useSearchParams();

  const [board, setBoard] = useState<Board | null>(null);
  const [archive, setArchive] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const [view, setView] = useState<View>("kanban");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [dueToday, setDueToday] = useState(false);
  const [topic, setTopic] = useState<string | "all">("all");
  const [error, setError] = useState<string | null>(null);

  const [openTask, setOpenTask] = useState<TaskDetailRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmArchiveColumn, setConfirmArchiveColumn] = useState<TaskColumnRecord | null>(null);

  const load = useCallback(() => {
    void api.taskBoard().then((b) => { setBoard(b); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { void api.me().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => {
    if (view === "archive") {
      void api.taskBoard({ archived: true }).then(setArchive).catch(() => setArchive(null));
    }
  }, [view]);

  /* the deep link: a pasted ?task= opens on arrival, once per id */
  const linkedTask = params.get("task");
  useEffect(() => {
    if (linkedTask === null || linkedTask === "") return;
    void api.taskDetail(linkedTask).then(setOpenTask).catch(() => undefined);
  }, [linkedTask]);

  const refusal = (e: unknown) =>
    setError(e instanceof BffError && e.detail ? e.detail : t("writeFailed"));

  /** every view reads through ONE filter, so the counts cannot disagree */
  const visible = useMemo(() => {
    if (board === null) return [];
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return board.tasks.filter((task) =>
      (priority === "all" || task.priority === priority)
      && (topic === "all" || task.topic_id === topic)
      && (!mineOnly || me === null || task.assignee_ids.includes(me.id) || task.created_by === me.id)
      && (!dueToday || (task.due_at !== null
          && new Date(task.due_at) >= start && new Date(task.due_at) <= today)),
    );
  }, [board, priority, topic, mineOnly, dueToday, me]);

  async function patchTask(id: string, patch: Parameters<typeof api.updateTask>[1]) {
    try {
      const updated = await api.updateTask(id, patch);
      setBoard((prev) => prev === null ? prev : {
        ...prev,
        tasks: prev.tasks.some((x) => x.id === id)
          ? prev.tasks.map((x) => (x.id === id ? { ...x, ...updated } : x))
          : prev.tasks,
      });
      setOpenTask((prev) => (prev?.id === id ? updated : prev));
      if (patch.archived !== undefined) load();
    } catch (e) {
      refusal(e);
      load(); // the optimistic move comes back honestly
    }
  }

  function drop(columnId: string, e: React.DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/task-id");
    if (id === "") return;
    /* optimistic: the card lands at the top of its new column NOW */
    setBoard((prev) => prev === null ? prev : {
      ...prev,
      tasks: prev.tasks.map((x) => (x.id === id ? { ...x, column_id: columnId, position: -Date.now() } : x)),
    });
    void patchTask(id, { column_id: columnId, position: -Date.now() });
  }

  const viewChip = (v: View, label: string) => (
    <button
      key={v}
      type="button"
      aria-pressed={view === v}
      onClick={() => setView(v)}
      className={`tap h-9 rounded-xl px-3.5 text-xs font-medium transition-colors ${
        view === v ? "bg-fg text-bg" : "bg-surface text-fg-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  const priorityChip = (p: PriorityFilter, label: string) => (
    <button
      key={p}
      type="button"
      aria-pressed={priority === p}
      onClick={() => setPriority(p)}
      className={`tap h-9 rounded-xl px-3 text-xs transition-colors ${
        priority === p ? "bg-primary font-semibold text-on-primary" : "bg-surface text-fg-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  if (failed) {
    return <p className="p-6 text-sm text-fg-muted">{t("readFailed")}</p>;
  }
  if (board === null) {
    return <p className="p-6 text-sm text-fg-muted">…</p>;
  }

  const columnCards = (columnId: string) =>
    visible.filter((task) => task.column_id === columnId)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── the two control rows, the reference's own ─────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="tap flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary shadow-accent hover:opacity-90"
        >
          <IconPlus width={14} height={14} />
          {t("newTask")}
        </button>

        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-surface-2 p-1">
          <button
            type="button"
            aria-pressed={dueToday}
            onClick={() => setDueToday((v) => !v)}
            className={`tap h-9 rounded-xl px-3 text-xs transition-colors ${
              dueToday ? "bg-primary font-semibold text-on-primary" : "bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            {t("dueToday")}
          </button>
          <button
            type="button"
            aria-pressed={mineOnly}
            onClick={() => setMineOnly((v) => !v)}
            className={`tap h-9 rounded-xl px-3 text-xs transition-colors ${
              mineOnly ? "bg-primary font-semibold text-on-primary" : "bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            {t("justMine")}
          </button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {priorityChip("low", t("priority_low"))}
          {priorityChip("medium", t("priority_medium"))}
          {priorityChip("high", t("priority_high"))}
          {priorityChip("critical", t("priority_critical"))}
          {priorityChip("all", t("all"))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {viewChip("archive", t("viewArchive"))}
          {viewChip("list", t("viewList"))}
          {viewChip("kanban", t("viewKanban"))}
        </div>
      </div>

      {/* topic chips */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => {
            const name = window.prompt(t("newTopicPrompt"));
            if (name && name.trim() !== "") {
              void api.createTaskTopic(name.trim()).then(load).catch(refusal);
            }
          }}
          className="tap grid h-8 w-8 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg"
          aria-label={t("newTopic")}
          title={t("newTopic")}
        >
          <IconPlus width={14} height={14} />
        </button>
        {board.topics.map((tp) => (
          <button
            key={tp.id}
            type="button"
            aria-pressed={topic === tp.id}
            onClick={() => setTopic((cur) => (cur === tp.id ? "all" : tp.id))}
            className={`tap flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
              topic === tp.id
                ? "border-accent bg-accent-soft font-semibold text-accent"
                : "border-border text-fg-muted hover:text-fg"
            }`}
          >
            {tp.name}
            <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
              {board.tasks.filter((x) => x.topic_id === tp.id).length}
            </span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={topic === "all"}
          onClick={() => setTopic("all")}
          className={`tap flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
            topic === "all"
              ? "border-accent bg-accent-soft font-semibold text-accent"
              : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          {t("allTasks")}
          <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">{board.tasks.length}</span>
        </button>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/* ── the views ─────────────────────────────────────────────────── */}
      {view === "kanban" ? (
        <div className="scroll-quiet flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {[...board.columns].sort((a, b) => b.position - a.position).map((col) => (
            <section
              key={col.id}
              data-column={col.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(col.id, e)}
              className="flex w-64 shrink-0 flex-col rounded-2xl border border-border bg-surface-2/60 p-2"
              aria-label={col.name}
            >
              <header className="flex items-center justify-between gap-2 px-1 py-1.5">
                <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <span className={`h-2 w-2 rounded-full ${COLUMN_DOT[col.tone] ?? COLUMN_DOT.grey}`} aria-hidden />
                  {col.name}
                </span>
                <span className="flex items-center gap-1">
                  <span className="badge-num rounded-md bg-surface px-1.5 text-[11px] text-fg-subtle">
                    {columnCards(col.id).length}
                  </span>
                  <button
                    type="button"
                    aria-label={t("archiveColumn", { name: col.name })}
                    title={t("archiveColumn", { name: col.name })}
                    onClick={() => setConfirmArchiveColumn(col)}
                    className="tap grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:text-danger"
                  >
                    <IconTrash width={12} height={12} />
                  </button>
                </span>
              </header>
              <div className="scroll-quiet flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-1">
                {columnCards(col.id).map((task) => (
                  <Card
                    key={task.id}
                    task={task}
                    onOpen={() => { void api.taskDetail(task.id).then(setOpenTask).catch(refusal); }}
                    onToggleDone={(done) => void patchTask(task.id, { done })}
                  />
                ))}
              </div>
              <AddCardInline columnId={col.id} onAdded={load} topicId={topic === "all" ? undefined : topic} />
            </section>
          ))}
          <button
            type="button"
            onClick={() => {
              const name = window.prompt(t("newColumnPrompt"));
              if (name && name.trim() !== "") {
                void api.createTaskColumn(name.trim()).then(load).catch(refusal);
              }
            }}
            className="tap flex h-12 w-56 shrink-0 items-center justify-center gap-2 self-start rounded-2xl border border-dashed border-border-strong text-sm text-fg-muted hover:text-fg"
          >
            <IconPlus width={14} height={14} />
            {t("addColumn")}
          </button>
        </div>
      ) : null}

      {view === "list" ? (
        <TaskList
          tasks={visible}
          columns={board.columns}
          onOpen={(id) => { void api.taskDetail(id).then(setOpenTask).catch(refusal); }}
          onToggleDone={(id, done) => void patchTask(id, { done })}
        />
      ) : null}

      {view === "archive" ? (
        archive === null ? <p className="text-sm text-fg-muted">…</p> : (
          <TaskList
            tasks={archive.tasks}
            columns={archive.columns}
            archived
            onOpen={(id) => { void api.taskDetail(id).then(setOpenTask).catch(refusal); }}
            onToggleDone={(id) => {
              void api.updateTask(id, { archived: false }).then(() => {
                load();
                void api.taskBoard({ archived: true }).then(setArchive).catch(() => undefined);
              }).catch(refusal);
            }}
          />
        )
      ) : null}

      {/* ── dialogs ───────────────────────────────────────────────────── */}
      {creating ? (
        <NewTaskDialog
          board={board}
          defaultTopic={topic === "all" ? undefined : topic}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      ) : null}

      {openTask !== null ? (
        <TaskDialog
          task={openTask}
          board={board}
          meId={me?.id ?? null}
          onPatch={(patch) => void patchTask(openTask.id, patch)}
          onRefresh={() => void api.taskDetail(openTask.id).then(setOpenTask).catch(() => undefined)}
          onClose={() => {
            setOpenTask(null);
            if (linkedTask !== null) router.replace("/tasks");
            load();
          }}
        />
      ) : null}

      {confirmArchiveColumn !== null ? (
        <ConfirmDialog
          title={t("archiveColumnTitle", { name: confirmArchiveColumn.name })}
          body={t("archiveColumnBody")}
          confirmLabel={t("archiveConfirm")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmArchiveColumn(null)}
          onConfirm={() => {
            void api.updateTaskColumn(confirmArchiveColumn.id, { archived: true })
              .then(() => { setConfirmArchiveColumn(null); load(); })
              .catch((e) => { setConfirmArchiveColumn(null); refusal(e); });
          }}
        />
      ) : null}
    </div>
  );
}

/** the reference's foot-of-column composer: type, Enter, it lands on top */
function AddCardInline({ columnId, topicId, onAdded }: {
  columnId: string; topicId?: string; onAdded: () => void;
}) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap mt-1 flex h-9 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs text-fg-muted hover:text-fg"
      >
        <IconPlus width={12} height={12} />
        {t("addCard")}
      </button>
    );
  }
  return (
    <form
      className="mt-1 flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const text = title.trim();
        if (text === "") return;
        void api.createTask({ title: text, column_id: columnId, ...(topicId ? { topic_id: topicId } : {}) })
          .then(() => { setTitle(""); setOpen(false); onAdded(); })
          .catch(() => setOpen(false));
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        placeholder={t("cardTitlePlaceholder")}
        aria-label={t("cardTitlePlaceholder")}
        className="input h-9 rounded-xl border border-border bg-surface px-2.5 text-sm text-fg outline-none focus:border-accent"
      />
      <div className="flex gap-1.5">
        <button type="submit" className="tap h-8 flex-1 rounded-lg bg-primary text-xs font-semibold text-on-primary">
          {t("add")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="tap grid h-8 w-8 place-items-center rounded-lg border border-border text-fg-muted"
          aria-label={t("cancel")}
        >
          <IconClose width={12} height={12} />
        </button>
      </div>
    </form>
  );
}

/** the list and the archive share one body — the archive is a list whose
    checkbox means "bring it back" */
function TaskList({ tasks, columns, archived = false, onOpen, onToggleDone }: {
  tasks: TaskCardRecord[];
  columns: TaskColumnRecord[];
  archived?: boolean;
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const columnName = (id: string) => columns.find((c) => c.id === id)?.name ?? "—";
  const dated = tasks.filter((x) => x.due_at !== null)
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  const undated = tasks.filter((x) => x.due_at === null);

  const row = (task: TaskCardRecord) => (
    <li key={task.id}>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-start shadow-card transition-colors hover:border-border-strong"
      >
        <input
          type="checkbox"
          checked={archived ? false : task.done}
          aria-label={archived ? t("unarchive") : t("markDone")}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleDone(task.id, e.target.checked)}
          className="h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
        />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${task.done && !archived ? "text-fg-subtle line-through" : "text-fg"}`}>
            {task.title}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle">
            {task.call_title !== null ? <span className="truncate">{task.call_title}</span> : null}
            {task.checklist_total > 0 ? (
              <span className="ltr shrink-0">{task.checklist_done}/{task.checklist_total}</span>
            ) : null}
            {task.due_at !== null ? (
              <span className="shrink-0">{formatRelativeDate(task.due_at, locale)}</span>
            ) : null}
          </span>
        </span>
        <PriorityChip p={task.priority} />
        <span className="hidden shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted sm:block">
          {columnName(task.column_id)}
        </span>
      </button>
    </li>
  );

  if (tasks.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-fg-muted">
      {archived ? t("archiveEmpty") : t("listEmpty")}
    </p>;
  }
  return (
    <div className="scroll-quiet min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
      {dated.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            {t("withDeadline")} ({dated.length})
          </h3>
          <ul className="space-y-2">{dated.map(row)}</ul>
        </div>
      ) : null}
      {undated.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            {t("noDeadline")} ({undated.length})
          </h3>
          <ul className="space-y-2">{undated.map(row)}</ul>
        </div>
      ) : null}
    </div>
  );
}

/** the new-task dialog: title, description, column, topic, priority, due */
function NewTaskDialog({ board, defaultTopic, onClose, onCreated }: {
  board: Board; defaultTopic?: string; onClose: () => void; onCreated: () => void;
}) {
  const t = useTranslations("tasks");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnId, setColumnId] = useState(board.columns[0]?.id ?? "");
  const [topicId, setTopicId] = useState(defaultTopic ?? "");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Overlay onClose={onClose} label={t("newTask")}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() === "" || busy) return;
          setBusy(true);
          void api.createTask({
            title: title.trim(),
            description,
            column_id: columnId,
            ...(topicId !== "" ? { topic_id: topicId } : {}),
            priority,
            due_at: due === "" ? null : new Date(due).toISOString(),
          }).then(onCreated).catch((err) => {
            setBusy(false);
            setError(err instanceof BffError && err.detail ? err.detail : t("writeFailed"));
          });
        }}
      >
        <h2 className="text-lg font-bold text-fg">{t("newTask")}</h2>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t("fieldTitle")}
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input h-10 rounded-xl border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t("fieldDescription")}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="input rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {t("fieldColumn")}
            <select
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              className="input h-10 rounded-xl border border-border bg-surface px-2 text-sm text-fg"
            >
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {t("fieldTopic")}
            <select
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className="input h-10 rounded-xl border border-border bg-surface px-2 text-sm text-fg"
            >
              <option value="">{t("noTopic")}</option>
              {board.topics.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {t("fieldPriority")}
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="input h-10 rounded-xl border border-border bg-surface px-2 text-sm text-fg"
            >
              {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{t(`priority_${p}`)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {t("fieldDue")}
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="input h-10 rounded-xl border border-border bg-surface px-2 text-sm text-fg"
            />
          </label>
        </div>
        {error !== null ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        <div className="mt-1 flex items-center justify-between">
          <button
            type="submit"
            disabled={title.trim() === "" || busy}
            className="tap h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary shadow-accent disabled:opacity-50"
          >
            {t("createTask")}
          </button>
          <button type="button" onClick={onClose} className="tap h-10 rounded-xl border border-border px-4 text-sm text-fg-muted">
            {t("cancel")}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

/** the task dialog: the reference's split — content on one side, meta rail
    on the other, comments underneath */
function TaskDialog({ task, board, meId, onPatch, onRefresh, onClose }: {
  task: TaskDetailRecord;
  board: Board;
  meId: string | null;
  onPatch: (patch: Parameters<typeof api.updateTask>[1]) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => { setTitle(task.title); setDescription(task.description); }, [task.id, task.title, task.description]);

  const progress = task.checklist_total === 0 ? 0 : task.checklist_done / task.checklist_total;
  const mine = meId !== null && task.assignee_ids.includes(meId);

  return (
    <Overlay onClose={onClose} label={task.title} wide>
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="tap grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:text-fg"
            aria-label={t("close")}
          >
            <IconClose width={14} height={14} />
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="tap flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-fg-muted hover:text-fg"
          >
            <IconPencil width={12} height={12} />
            {t("edit")}
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {task.call_id !== null ? (
            <Link
              href={`/calls/${task.call_id}`}
              className="truncate rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-fg-muted hover:text-accent"
            >
              {t("fromRecord")}: {task.call_title ?? t("recordGone")}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => onPatch({ done: !task.done })}
            className={`tap flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ${
              task.done ? "bg-success/15 text-success" : "border border-border text-fg-muted hover:text-fg"
            }`}
          >
            <IconCheck width={12} height={12} />
            {task.done ? t("doneState") : t("markDone")}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto pt-4 md:grid-cols-[minmax(0,1fr)_200px]">
        {/* ── main ────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input h-10 rounded-xl border border-border bg-surface px-3 text-base font-bold text-fg"
                aria-label={t("fieldTitle")}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="input rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg"
                aria-label={t("fieldDescription")}
              />
              <button
                type="button"
                onClick={() => { onPatch({ title: title.trim(), description }); setEditing(false); }}
                disabled={title.trim() === ""}
                className="tap h-9 self-start rounded-xl bg-primary px-3.5 text-xs font-semibold text-on-primary disabled:opacity-50"
              >
                {t("save")}
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-fg">{task.title}</h2>
              {task.description !== "" ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-muted">{task.description}</p>
              ) : null}
            </>
          )}

          {/* checklist */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">
                {t("checklist")}
                {task.checklist_total > 0 ? (
                  <span className="ltr ms-2 text-xs text-fg-subtle">
                    ({task.checklist_done}/{task.checklist_total})
                  </span>
                ) : null}
              </h3>
            </div>
            {task.checklist_total > 0 ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            ) : null}
            <ul className="mt-2 space-y-1">
              {task.checklist.map((item) => (
                <li key={item.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={item.done}
                    aria-label={item.label}
                    onChange={(e) => {
                      void api.updateTaskChecklistItem(item.id, { done: e.target.checked }).then(onRefresh);
                    }}
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                  />
                  <span className={`min-w-0 flex-1 text-sm ${item.done ? "text-fg-subtle line-through" : "text-fg"}`}>
                    {item.label}
                  </span>
                  <button
                    type="button"
                    aria-label={t("removeItem", { label: item.label })}
                    onClick={() => { void api.deleteTaskChecklistItem(item.id).then(onRefresh); }}
                    className="tap grid h-7 w-7 place-items-center rounded-md text-fg-subtle opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <IconTrash width={12} height={12} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const text = newItem.trim();
                if (text === "") return;
                void api.addTaskChecklistItem(task.id, text).then(() => { setNewItem(""); onRefresh(); });
              }}
            >
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder={t("newItemPlaceholder")}
                aria-label={t("newItemPlaceholder")}
                className="input h-9 flex-1 rounded-xl border border-border bg-surface px-2.5 text-sm text-fg"
              />
              <button type="submit" className="tap h-9 rounded-xl border border-border px-3 text-xs text-fg-muted hover:text-fg">
                {t("add")}
              </button>
            </form>
          </div>

          {/* comments */}
          <div className="mt-6 border-t border-border pt-3">
            <h3 className="text-sm font-semibold text-fg">
              {t("comments")} <span className="ltr text-xs text-fg-subtle">({task.comments.length})</span>
            </h3>
            {task.comments.length === 0 ? (
              <p className="mt-2 text-xs text-fg-subtle">{t("noComments")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {task.comments.map((c) => (
                  <li key={c.id} className="rounded-xl bg-surface-2 px-3 py-2">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-fg">{c.body}</p>
                    <p className="mt-1 text-[11px] text-fg-subtle">
                      {formatRelativeDate(c.created_at, locale)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const text = comment.trim();
                if (text === "") return;
                void api.addTaskComment(task.id, text).then(() => { setComment(""); onRefresh(); });
              }}
            >
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("commentPlaceholder")}
                aria-label={t("commentPlaceholder")}
                className="input h-9 flex-1 rounded-xl border border-border bg-surface px-2.5 text-sm text-fg"
              />
              <button type="submit" className="tap h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-on-primary">
                {t("postComment")}
              </button>
            </form>
          </div>
        </div>

        {/* ── the meta rail ───────────────────────────────────────────── */}
        <aside className="space-y-3 text-sm">
          <MetaRow label={t("fieldColumn")}>
            <select
              value={task.column_id}
              onChange={(e) => onPatch({ column_id: e.target.value })}
              className="input h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-fg"
              aria-label={t("fieldColumn")}
            >
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </MetaRow>
          <MetaRow label={t("fieldTopic")}>
            <select
              value={task.topic_id ?? ""}
              onChange={(e) => onPatch({ topic_id: e.target.value === "" ? null : e.target.value })}
              className="input h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-fg"
              aria-label={t("fieldTopic")}
            >
              <option value="">{t("noTopic")}</option>
              {board.topics.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
            </select>
          </MetaRow>
          <MetaRow label={t("fieldPriority")}>
            <select
              value={task.priority}
              onChange={(e) => onPatch({ priority: e.target.value as TaskPriority })}
              className="input h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-fg"
              aria-label={t("fieldPriority")}
            >
              {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{t(`priority_${p}`)}</option>)}
            </select>
          </MetaRow>
          <MetaRow label={t("fieldDue")}>
            <input
              type="date"
              value={task.due_at === null ? "" : task.due_at.slice(0, 10)}
              onChange={(e) => onPatch({ due_at: e.target.value === "" ? null : new Date(e.target.value).toISOString() })}
              className="input h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-fg"
              aria-label={t("fieldDue")}
            />
          </MetaRow>
          <MetaRow label={t("assignees")}>
            <button
              type="button"
              onClick={() => { void api.assignMeToTask(task.id, !mine).then(onRefresh); }}
              className={`tap h-9 w-full rounded-lg border px-2 text-xs ${
                mine ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              {mine ? t("assignedToMe") : t("assignMe")}
            </button>
          </MetaRow>
          <button
            type="button"
            onClick={() => { onPatch({ archived: !task.archived }); onClose(); }}
            className="tap h-9 w-full rounded-lg border border-border px-2 text-xs text-fg-muted hover:text-danger"
          >
            {task.archived ? t("unarchive") : t("archiveTask")}
          </button>
        </aside>
      </div>
    </Overlay>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-fg-subtle">{label}</p>
      {children}
    </div>
  );
}

function Overlay({ children, onClose, label, wide = false }: {
  children: ReactNode; onClose: () => void; label: string; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-island ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
