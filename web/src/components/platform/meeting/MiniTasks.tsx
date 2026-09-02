"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import type { TaskCardRecord, TaskColumnRecord } from "@/api/types";
import { IconCheck, IconPlus } from "@/components/icons";
import { digits } from "@/lib/format";

/**
 * تسک‌ها — the meeting's own slice of the shared board, drawn as the
 * reference draws it: the real columns as a MINI KANBAN, holding only the
 * cards linked to this meeting's record, with quick-add into the first
 * column and the door to the full board.
 */
export function MeetingTasksBoard({ callId, callTitle }: {
  callId: string; callTitle: string;
}) {
  const t = useTranslations("meetings");
  const tTasks = useTranslations("tasks");
  const locale = useLocale();
  const [board, setBoard] = useState<{ columns: TaskColumnRecord[]; tasks: TaskCardRecord[] } | null | "failed">(null);
  const [draft, setDraft] = useState("");
  const [writeError, setWriteError] = useState(false);

  const load = useCallback(() => {
    void api.taskBoard()
      .then((b) => setBoard({ columns: b.columns, tasks: b.tasks }))
      .catch(() => setBoard("failed"));
  }, []);
  useEffect(load, [load]);

  if (board === null) return <p className="p-4 text-sm text-fg-muted">…</p>;
  if (board === "failed") return <p className="p-4 text-sm text-fg-muted">{t("readFailed")}</p>;

  const mine = board.tasks.filter((task) => task.call_id === callId);
  const columns = [...board.columns].sort((a, b) => b.position - a.position);
  const firstColumn = board.columns[0];

  const add = () => {
    const title = draft.trim();
    if (title === "" || firstColumn === undefined) return;
    setWriteError(false);
    void api.createTask({ title, column_id: firstColumn.id, call_id: callId })
      .then(() => { setDraft(""); load(); })
      .catch(() => setWriteError(true));
  };

  const toggleDone = (task: TaskCardRecord, done: boolean) => {
    void api.updateTask(task.id, { done }).then(load).catch(() => setWriteError(true));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{t("meetingTasksTitle")}</h3>
          <p className="text-[11px] text-fg-muted">{t("meetingTasksSubtitle", { title: callTitle })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tasks"
            className="btn btn-sm border border-border bg-surface font-medium text-fg hover:bg-border">
            {t("meetingTasksFullBoard")}
          </Link>
        </div>
      </div>

      {writeError ? (
        <p role="alert" className="text-xs text-danger">{t("writeFailed")}</p>
      ) : null}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={t("newMeetingTaskPlaceholder")}
          className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <button type="button" onClick={add} disabled={draft.trim() === "" || firstColumn === undefined}
          className="btn bg-accent font-semibold text-on-accent disabled:opacity-50">
          <IconPlus width={12} height={12} />
          {tTasks("newTask")}
        </button>
      </div>

      <div className="scroll-quiet flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const cards = mine
            .filter((task) => task.column_id === col.id && !task.archived)
            .sort((a, b) => a.position - b.position);
          return (
            <section key={col.id} aria-label={col.name}
              className="flex w-[260px] shrink-0 flex-col rounded-2xl border border-border bg-surface p-2.5 shadow-card">
              <header className="flex items-center justify-between px-1 py-1">
                <span className="text-sm font-semibold text-fg">{col.name}</span>
                <span className="badge-num rounded-md bg-surface-2 px-1.5 text-[11px] text-fg-subtle">
                  {digits(cards.length, locale)}
                </span>
              </header>
              <div className="scroll-quiet min-h-0 flex-1 space-y-2 overflow-y-auto pt-1">
                {cards.map((task) => (
                  <Link key={task.id} href={`/tasks?task=${task.id}`}
                    className="block rounded-xl border border-border bg-surface p-3 shadow-card transition-colors hover:border-border-strong">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        aria-label={tTasks("markDone")}
                        onClick={(e) => { e.preventDefault(); toggleDone(task, !task.done); }}
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
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-fg-subtle">{tTasks(`priority_${task.priority}`)}</span>
                      {task.checklist_total > 0 ? (
                        <span className="ltr text-fg-subtle">{task.checklist_done}/{task.checklist_total}</span>
                      ) : null}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
