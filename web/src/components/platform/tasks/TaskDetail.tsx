"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import type {
  OrgPersonRecord, TaskColumnRecord, TaskDetailRecord, TaskLabelRecord,
  TaskPriority, TaskTopicRecord,
} from "@/api/types";
import { ConfirmDialog } from "@/components/rowActions";
import {
  AssigneePicker, DueField, LabelRow, PRIORITY_DOT, PRIORITY_ORDER, TONE_CHIP, TONE_DOT,
  relativeTime,
} from "./TaskDialogs";
import {
  IconCheck, IconClose, IconDots, IconPencil, IconPlus, IconTrash, IconVideo,
} from "@/components/icons";
import { digits, formatDate, personName } from "@/lib/format";

/**
 * THE TASK'S OWN SCREEN — the reference's detail modal, walked on
 * 2026-09-01 and rebuilt part for part:
 *
 *   top bar   [×] [⋮] [ویرایش]              [علامت به‌عنوان انجام‌شده] [meeting chip]
 *   main      title · توضیحات · چک‌لیست (n/m) · tabs [نظرها n | تاریخچه n]
 *   rail      موضوع · وضعیت · مسئول‌ها · اولویت · مهلت · برچسب‌ها
 *
 * The rail's fields are LIVE controls, not a read-out: this is where a card
 * is actually edited, which is why the reference puts them there.
 */
export function TaskDetail({ task, columns, topics, labels, people, onClose, onChanged, onLabelsChanged }: {
  task: TaskDetailRecord;
  columns: TaskColumnRecord[];
  topics: TaskTopicRecord[];
  labels: TaskLabelRecord[];
  people: OrgPersonRecord[];
  onClose: () => void;
  onChanged: () => void;
  onLabelsChanged: () => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [tab, setTab] = useState<"comments" | "history">("comments");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [comment, setComment] = useState("");
  const [item, setItem] = useState("");
  const [menu, setMenu] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
  }, [task.id, task.title, task.description]);

  const patch = (body: Record<string, unknown>) => {
    setFailed(false);
    void api.updateTask(task.id, body).then(onChanged).catch(() => setFailed(true));
  };
  const nameOf = (id: string): string => {
    const person = people.find((p) => p.id === id);
    return person === undefined ? t("someone") : personName(person, locale);
  };

  const done = task.checklist.filter((line) => line.done).length;
  const sentence = (kind: string, detail: Record<string, string>): string => {
    const key = `event_${kind}`;
    return t(key as "event_done", {
      from: detail.from ?? "", to: detail.to ?? "",
      label: detail.label ?? "", person: detail.person ?? "",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg/60 p-4"
      onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        onClick={(e) => e.stopPropagation()}
        className="my-6 flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-island"
      >
        {/* ── top bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label={t("close")} onClick={onClose}
              className="tap grid h-9 w-9 place-items-center rounded-xl text-fg-subtle hover:bg-surface-2 hover:text-fg">
              <IconClose width={14} height={14} />
            </button>
            <span className="relative">
              <button type="button" aria-label={t("more")} onClick={() => setMenu((v) => !v)}
                className="tap grid h-9 w-9 place-items-center rounded-xl text-fg-subtle hover:bg-surface-2 hover:text-fg">
                <IconDots width={14} height={14} />
              </button>
              {menu ? (
                <span className="absolute top-10 z-50 flex w-48 flex-col rounded-xl border border-border bg-surface p-1 shadow-island">
                  <button type="button"
                    onClick={() => { setMenu(false); setConfirmArchive(true); }}
                    className="tap flex h-9 items-center gap-2 rounded-lg px-2.5 text-start text-xs text-danger hover:bg-danger/10">
                    <IconTrash width={12} height={12} />
                    {task.archived ? t("unarchive") : t("archiveTask")}
                  </button>
                </span>
              ) : null}
            </span>
            <button type="button" onClick={() => setEditing((v) => !v)}
              className="tap flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium text-fg hover:bg-border">
              <IconPencil width={12} height={12} />
              {editing ? t("done") : t("edit")}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {task.call_id !== null ? (
              <Link href={`/meetings?call=${task.call_id}`}
                className="tap flex h-9 items-center gap-1.5 rounded-xl bg-accent-soft px-3 text-xs font-medium text-accent">
                <IconVideo width={12} height={12} />
                <span className="max-w-[280px] truncate">{task.call_title ?? t("recordGone")}</span>
              </Link>
            ) : null}
            <button type="button" onClick={() => patch({ done: !task.done })}
              className={`tap flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
                task.done
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-surface text-fg-muted hover:text-fg"
              }`}>
              <IconCheck width={12} height={12} />
              {task.done ? t("doneState") : t("markDone")}
            </button>
          </div>
        </div>

        {failed ? (
          <p role="alert" className="border-b border-border bg-danger/10 px-4 py-2 text-xs text-danger">
            {t("writeFailed")}
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[1fr_260px]">
          {/* ── main ───────────────────────────────────────────────── */}
          <div className="min-h-0 space-y-4 p-5">
            {editing ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => { if (title.trim() !== "" && title !== task.title) patch({ title }); }}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-lg font-bold text-fg outline-none focus:border-accent"
              />
            ) : (
              <h2 className={`text-lg font-bold ${task.done ? "text-fg-subtle line-through" : "text-fg"}`}>
                {task.title}
              </h2>
            )}

            <section aria-label={t("fieldDescription")}>
              <h3 className="mb-1 text-xs text-fg-muted">{t("fieldDescription")}</h3>
              {editing ? (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => { if (description !== task.description) patch({ description }); }}
                  rows={3}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
              ) : task.description.trim() === "" ? (
                <p className="text-sm text-fg-subtle">{t("noDescription")}</p>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-7 text-fg">{task.description}</p>
              )}
            </section>

            <section aria-label={t("checklist")}>
              <h3 className="mb-1.5 text-xs text-fg-muted">
                {t("checklist")} ({digits(done, locale)}/{digits(task.checklist.length, locale)})
              </h3>
              {task.checklist.length === 0 ? (
                <p className="text-sm text-fg-subtle">{t("checklistEmpty")}</p>
              ) : (
                <ul className="space-y-1">
                  {task.checklist.map((line) => (
                    <li key={line.id} className="group flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={line.label}
                        onClick={() => {
                          void api.updateTaskChecklistItem(line.id, { done: !line.done })
                            .then(onChanged).catch(() => setFailed(true));
                        }}
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                          line.done ? "border-accent bg-accent text-on-accent" : "border-border"
                        }`}
                      >
                        {line.done ? <IconCheck width={12} height={12} /> : null}
                      </button>
                      <span className={`min-w-0 flex-1 text-sm ${line.done ? "text-fg-subtle line-through" : "text-fg"}`}>
                        {line.label}
                      </span>
                      <button
                        type="button"
                        aria-label={t("removeItem", { label: line.label })}
                        onClick={() => {
                          void api.deleteTaskChecklistItem(line.id).then(onChanged).catch(() => setFailed(true));
                        }}
                        className="shrink-0 text-fg-subtle opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      >
                        <IconTrash width={12} height={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex gap-2">
                <input
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || item.trim() === "") return;
                    void api.addTaskChecklistItem(task.id, item.trim())
                      .then(() => { setItem(""); onChanged(); })
                      .catch(() => setFailed(true));
                  }}
                  placeholder={t("newItemPlaceholder")}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
                />
                <button
                  type="button"
                  aria-label={t("add")}
                  disabled={item.trim() === ""}
                  onClick={() => {
                    void api.addTaskChecklistItem(task.id, item.trim())
                      .then(() => { setItem(""); onChanged(); })
                      .catch(() => setFailed(true));
                  }}
                  className="tap grid h-9 w-9 place-items-center rounded-lg bg-accent text-on-accent disabled:opacity-50"
                >
                  <IconPlus width={12} height={12} />
                </button>
              </div>
            </section>

            {/* ── the two tabs ─────────────────────────────────────── */}
            <div role="tablist" className="flex rounded-xl border border-border bg-surface-2/60 p-1">
              {([["comments", `${t("comments")} ${digits(task.comments.length, locale)}`],
                 ["history", `${t("history")} ${digits(task.events.length, locale)}`]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`tap h-8 flex-1 rounded-lg text-xs font-medium transition-colors ${
                    tab === key ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "comments" ? (
              <div className="space-y-3">
                {task.comments.length === 0 ? (
                  <p className="text-sm text-fg-subtle">{t("noComments")}</p>
                ) : (
                  <ul className="space-y-2">
                    {task.comments.map((entry) => (
                      <li key={entry.id} className="flex items-start gap-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-on-accent" aria-hidden>
                          {nameOf(entry.created_by).slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold text-fg">{nameOf(entry.created_by)}</span>
                            <span className="text-[11px] text-fg-subtle">
                              {relativeTime(entry.created_at, locale, t as never)}
                            </span>
                          </span>
                          <span className="mt-0.5 block whitespace-pre-wrap text-sm leading-6 text-fg">{entry.body}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="rounded-xl border border-border bg-surface-2/40 p-2">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (comment.trim() === "") return;
                        void api.addTaskComment(task.id, comment.trim())
                          .then(() => { setComment(""); onChanged(); })
                          .catch(() => setFailed(true));
                      }
                    }}
                    rows={2}
                    placeholder={t("commentPlaceholder")}
                    className="w-full resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-fg-subtle">{t("commentHint")}</span>
                    <button
                      type="button"
                      disabled={comment.trim() === ""}
                      onClick={() => {
                        void api.addTaskComment(task.id, comment.trim())
                          .then(() => { setComment(""); onChanged(); })
                          .catch(() => setFailed(true));
                      }}
                      className="tap h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent disabled:opacity-50"
                    >
                      {t("postComment")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {task.events.length === 0 ? (
                  <li className="text-sm text-fg-subtle">{t("noHistory")}</li>
                ) : task.events.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-on-accent" aria-hidden>
                      {nameOf(entry.actor_id).slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-fg">
                      <span className="font-semibold">{nameOf(entry.actor_id)}</span>
                      {" "}
                      {sentence(entry.kind, entry.detail)}
                      <span className="text-fg-subtle"> · {relativeTime(entry.created_at, locale, t as never)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── the rail ───────────────────────────────────────────── */}
          <aside className="space-y-3 border-t border-border bg-surface-2/30 p-4 md:border-s md:border-t-0">
            <div>
              <span className="mb-1 block text-[11px] text-fg-muted">{t("fieldTopic")}</span>
              <select
                value={task.topic_id ?? ""}
                onChange={(e) => patch({ topic_id: e.target.value === "" ? null : e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-fg outline-none focus:border-accent"
              >
                <option value="">{t("noTopic")}</option>
                {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
              </select>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-fg-muted">{t("fieldColumn")}</span>
              <select
                value={task.column_id}
                onChange={(e) => patch({ column_id: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-fg outline-none focus:border-accent"
              >
                {columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
              </select>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-fg-muted">{t("fieldAssignees")}</span>
              {task.assignee_ids.length === 0 ? (
                <p className="mb-1 text-xs text-fg-subtle">{t("noAssignee")}</p>
              ) : null}
              <AssigneePicker
                selected={task.assignee_ids}
                onToggle={(userId) => {
                  const on = !task.assignee_ids.includes(userId);
                  void api.setTaskAssignee(task.id, userId, on).then(onChanged).catch(() => setFailed(true));
                }}
              />
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-fg-muted">{t("fieldPriority")}</span>
              <div className="flex flex-wrap gap-1">
                {PRIORITY_ORDER.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={task.priority === level}
                    onClick={() => patch({ priority: level })}
                    className={`tap flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] transition-colors ${
                      task.priority === level
                        ? "bg-warning/10 font-semibold text-warning"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[level as TaskPriority]}`} aria-hidden />
                    {t(`priority_${level}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-fg-muted">{t("fieldDue")}</span>
              <DueField value={task.due_at} onPick={(iso) => patch({ due_at: iso })} />
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-fg-muted">{t("fieldLabels")}</span>
              {task.label_ids.length === 0 ? (
                <p className="mb-1 text-xs text-fg-subtle">{t("noLabels")}</p>
              ) : null}
              <LabelRow
                labels={labels}
                selected={task.label_ids}
                onToggle={(id) => {
                  const on = !task.label_ids.includes(id);
                  void api.setTaskLabel(task.id, id, on).then(onChanged).catch(() => setFailed(true));
                }}
                onChanged={onLabelsChanged}
              />
            </div>

            {task.created_at !== "" ? (
              <p className="pt-1 text-[10px] text-fg-subtle">
                {t("createdAt", { at: formatDate(task.created_at, locale) })}
              </p>
            ) : null}
          </aside>
        </div>
      </div>

      {confirmArchive ? (
        <ConfirmDialog
          title={task.archived ? t("unarchiveTitle") : t("archiveTaskTitle")}
          body={task.archived ? t("unarchiveBody") : t("archiveTaskBody")}
          confirmLabel={task.archived ? t("unarchive") : t("archiveConfirm")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmArchive(false)}
          onConfirm={() => {
            setConfirmArchive(false);
            patch({ archived: !task.archived });
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}

export { TONE_CHIP, TONE_DOT };
