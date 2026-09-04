"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Select } from "@/components/Select";
import { Avatar } from "@/components/Avatar";
import { api } from "@/api/client";
import type {
  OrgPersonRecord, TaskColumnRecord, TaskDetailRecord, TaskLabelRecord,
  TaskPriority, TaskTopicRecord,
} from "@/api/types";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import {
  AssigneePicker, DueField, LabelRow, PRIORITY_DOT, PRIORITY_ORDER, ScheduleFields,
  TONE_CHIP, TONE_DOT, relativeTime,
} from "./TaskDialogs";
import { Overlay } from "../Overlay";
import {
  IconArchive, IconCheck, IconClose, IconPencil, IconPlus, IconRetry, IconTrash, IconVideo,
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
  const [confirmArchive, setConfirmArchive] = useState(false);
  /** the 0162 delete awaiting the platform's are-you-sure — final, unlike archiving */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** the checklist line awaiting the platform's are-you-sure (dialog at the foot) */
  const [condemnedLine, setCondemnedLine] = useState<{ id: string; label: string } | null>(null);
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
            {/* 2026-09-03: the theme's icon button, not a twelfth invented
                size. It is the same control as the kebab standing beside it
                — rowActions renders `.btn btn-icon` — so a 36px square with
                a 14px corner next to a 28px one with an 8px corner was the
                user's "one is small, one is big" in two adjacent elements. */}
            <button type="button" aria-label={t("close")} onClick={onClose}
              className="btn btn-icon text-fg-subtle hover:bg-surface-2 hover:text-fg">
              <IconClose width={14} height={14} />
            </button>
            {/* THE THEME'S KEBAB, not a hand-rolled popover (audit finding,
                2026-09-02) — and the red item is now a real DELETE (0162, the
                user's ask: "the red button should truly delete"). Archiving
                stays as the reversible, ordinary item; both go through the
                platform's one dialog. */}
            <KebabMenu
              label={t("more")}
              items={[
                {
                  key: "archive",
                  label: task.archived ? t("unarchive") : t("archiveTask"),
                  icon: <IconArchive width={14} height={14} />,
                  onSelect: () => setConfirmArchive(true),
                },
                {
                  key: "delete",
                  label: t("deleteTask"),
                  icon: <IconTrash width={14} height={14} />,
                  danger: true,
                  onSelect: () => setConfirmDelete(true),
                },
              ]}
            />
            <button type="button" onClick={() => setEditing((v) => !v)}
              className="btn btn-sm border border-border font-medium text-fg hover:bg-border">
              <IconPencil width={12} height={12} />
              {editing ? t("done") : t("edit")}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {task.call_id !== null ? (
              <Link href={`/meetings?call=${task.call_id}`}
                className="btn btn-sm bg-accent-soft font-medium text-accent">
                <IconVideo width={12} height={12} />
                <span className="max-w-[280px] truncate">{task.call_title ?? t("recordGone")}</span>
              </Link>
            ) : null}
            {/* 2026-09-03: `.btn btn-sm`, the theme's compact control — the
                same shape as the meeting chip it stands next to. `border` is
                written out because `.btn` draws none, and `border-accent` on
                a borderless button paints NOTHING (this repo shipped that
                once, the markup reading as fixed while the pixels got
                worse); the colours stay the element's own. */}
            <button type="button" onClick={() => patch({ done: !task.done })}
              className={`btn btn-sm border ${
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
              /* KEPT hand-drawn (2026-09-03): this is the page's TITLE wearing a
                 field, standing in for the `h2 text-lg font-bold` two lines
                 down — it is taller and larger than `.input` on purpose, where
                 `.input-sm` is the answer for a field that wanted to be
                 SHORTER. Adopting it would shrink the modal's subject below the
                 heading it replaces. */
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
                      {/* KEPT, and this file's one worklist entry in
                          control.guard.test.ts (2026-09-03): a CHECKBOX, not a
                          button. 16px is the box a tick lives in, and the
                          platform draws the identical one in five places (the
                          board card, the list row, the meeting's items panel
                          and mini-tasks). `.btn-icon` is 28px, which beside a
                          14px line stops reading as a checkbox — and converting
                          one of five would create the divergence the guard
                          exists to close. */}
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
                        /* the press ASKS; the write lives in the dialog at the
                           foot (the platform's destructive-action rule). This
                           was wired straight to the delete and the confirm
                           guard only saw it once its pattern learned the
                           block-bodied shape (2026-09-02). */
                        onClick={() => setCondemnedLine({ id: line.id, label: line.label })}
                        className="shrink-0 text-fg-subtle opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      >
                        <IconTrash width={12} height={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* `items-center`: the field and the button are two different
                  heights (see the note on each), and with neither one stretching
                  the row would hang them both from its top edge. */}
              <div className="mt-2 flex items-center gap-2">
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
                  /* 2026-09-03: the theme's compact field. This was h-9 /
                     rounded-lg / px-2.5 with its own border, ground, placeholder
                     colour and focus edge — a field re-answering `.input`
                     question by question, which is why the platform had five
                     field heights. Only the layout is left, because a flex
                     child's width belongs to the row it sits in. */
                  className="input-sm min-w-0 flex-1"
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
                  /* 2026-09-03: the theme's height and corner, square by
                     width — the sanctioned spelling for an icon button that
                     has to be wider than `.btn-icon`'s 28px, since this one
                     stands at the end of a field row. `.btn` owns the
                     disabled face, so the old `disabled:opacity-50` goes
                     with the geometry. */
                  className="btn w-[38px] px-0 bg-accent text-on-accent"
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
                  /* 2026-09-03: `.btn btn-sm` is the measured segmented tab
                     (globals names it as that case by name) — this pair had
                     invented a 32px/10px one instead. The guard could not
                     see it: no `items-center` in the string, so it read as
                     spacing. Converted with its neighbours because leaving
                     it would put two compact shapes on one screen. */
                  className={`btn btn-sm flex-1 ${
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
                        {/* 2026-09-03: the platform's avatar, not a fifth
                            hand-drawn one. It was a FILLED accent circle with a
                            `.slice(0, 1)` initial — the same person rendered one
                            way here and another in the roster, and the slice
                            splits a surrogate pair. The component owns the
                            ground, the ring, the uppercasing and that decision;
                            `nameOf` stays the caller's, because which of a
                            person's two names to show is a locale decision. */}
                        <Avatar name={nameOf(entry.created_by)} size="sm" />
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
                      /* 2026-09-03: the theme's compact control. Another one
                         the guard is blind to (a height and a corner, no
                         centring word) — converted anyway, because a shape
                         is not less invented for being unmeasurable. */
                      className="btn btn-sm bg-accent text-on-accent"
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
                    {/* 2026-09-03: the platform's avatar. This tab drew its own
                        twin of the comment list's mark, three lines apart in one
                        file — which is the divergence at its smallest. */}
                    <Avatar name={nameOf(entry.actor_id)} size="sm" />
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
              <Select
                value={task.topic_id ?? ""}
                onChange={(v) => patch({ topic_id: v === "" ? null : v })}
                ariaLabel={t("fieldTopic")}
                options={[
                  { value: "", label: t("noTopic") },
                  ...topics.map((topic) => ({ value: topic.id, label: topic.name })),
                ]}
              />
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-fg-muted">{t("fieldColumn")}</span>
              <Select
                value={task.column_id}
                onChange={(v) => patch({ column_id: v })}
                ariaLabel={t("fieldColumn")}
                options={columns.map((column) => ({ value: column.id, label: column.name }))}
              />
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-fg-muted">{t("fieldAssignees")}</span>
              {task.assignee_ids.length === 0 ? (
                <p className="mb-1 text-xs text-fg-subtle">{t("noAssignee")}</p>
              ) : null}
              <AssigneePicker
                people={people}
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
                    /* 2026-09-03: `.btn btn-sm` — the same control the new-task
                       dialog offers for the same choice, which is the point:
                       one product, one priority button. It keeps its
                       borderless rail face; only the geometry left. */
                    className={`btn btn-sm ${
                      task.priority === level
                        ? "bg-warning/10 text-warning"
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

            {/* THE REPEATING ORDER (0186). It renders here, in the rail
                where every other property of the card lives, rather than as
                a section of its own — a schedule is a fact about this task
                exactly like its priority and its due date. */}
            <ScheduleRow task={task} onChanged={onChanged} onFailed={() => setFailed(true)} />

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

      {/* 0162: the true delete — the creator's or an admin's; the door
          refuses anyone else and the refusal reads as "not found". The
          board refetches on success, so the card is gone the moment the
          modal is. */}
      {confirmDelete ? (
        <ConfirmDialog
          danger
          title={t("deleteTaskTitle", { title: task.title })}
          body={t("deleteTaskBody")}
          confirmLabel={t("deleteConfirm")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void api.deleteTask(task.id).then(() => { onChanged(); onClose(); }).catch(() => setFailed(true));
          }}
        />
      ) : null}

      {/* THE PLATFORM'S ONE DESTRUCTIVE DIALOG for a checklist line (the
          widened confirm guard's first catch, 2026-09-02). A line somebody
          typed has no undo; the dialog names it so the person sees what they
          are about to lose. */}
      {condemnedLine !== null ? (
        <ConfirmDialog
          title={t("removeItem", { label: condemnedLine.label })}
          body={t("removeItemBody")}
          confirmLabel={t("removeItemConfirm")}
          cancelLabel={t("cancel")}
          onCancel={() => setCondemnedLine(null)}
          onConfirm={() => {
            const line = condemnedLine;
            setCondemnedLine(null);
            void api.deleteTaskChecklistItem(line.id).then(onChanged).catch(() => setFailed(true));
          }}
        />
      ) : null}
    </div>
  );
}

export { TONE_CHIP, TONE_DOT };

/**
 * A task's schedule, read and edited in place (0186).
 *
 * Three states and each says something different:
 *   · no schedule      — the switch, off. This is every ordinary task.
 *   · a live schedule  — the sentence, and how many times it has come back.
 *   · a SPENT schedule — the same sentence with the end date past, said as
 *     spent rather than left looking armed. A schedule that can no longer
 *     produce anything and still reads "repeats" is the card making a promise
 *     the server has already stopped keeping.
 */
function ScheduleRow({ task, onChanged, onFailed }: {
  task: TaskDetailRecord;
  onChanged: () => void;
  onFailed: () => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [gapDays, setGapDays] = useState(String(task.recurrence?.gap_days ?? 0));
  const [until, setUntil] = useState<string | null>(task.recurrence?.until_date ?? null);
  const [busy, setBusy] = useState(false);

  const write = (schedule: { gap_days: number; until_date: string | null } | null) => {
    setBusy(true);
    void api.setTaskSchedule(task.id, schedule)
      .then(() => { setBusy(false); setOpen(false); onChanged(); })
      .catch(() => { setBusy(false); onFailed(); });
  };

  const schedule = task.recurrence;
  return (
    <div>
      <span className="mb-1 block text-[11px] text-fg-muted">{t("scheduleField")}</span>
      {schedule === null ? (
        <button type="button" onClick={() => setOpen(true)}
          className="btn btn-sm w-full justify-start border border-border text-fg-muted hover:text-fg">
          <IconRetry width={12} height={12} />
          {t("scheduleAdd")}
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-surface-2 p-2.5">
          <p className={`text-[11px] leading-5 ${schedule.active ? "text-fg" : "text-warning"}`}>
            {schedule.active
              ? (schedule.until_date === null
                  ? t("scheduleSaysForever", { n: digits(schedule.gap_days, locale) })
                  : t("scheduleSaysUntil", {
                      n: digits(schedule.gap_days, locale),
                      date: formatDate(schedule.until_date, locale),
                    }))
              : t("scheduleSpent")}
          </p>
          {schedule.renewed > 0 ? (
            <p className="mt-0.5 text-[10px] text-fg-subtle">
              {t("scheduleRenewedTimes", { n: digits(schedule.renewed, locale) })}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-1.5">
            <button type="button" onClick={() => setOpen(true)} disabled={busy}
              className="btn btn-sm border border-border text-fg-muted hover:text-fg">
              {t("edit")}
            </button>
            <button type="button" onClick={() => write(null)} disabled={busy}
              className="btn btn-sm text-fg-subtle hover:text-danger">
              {t("scheduleStop")}
            </button>
          </div>
        </div>
      )}

      {open ? (
        <Overlay onClose={() => setOpen(false)} label={t("scheduleField")} size="sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">{t("scheduleField")}</h2>
            <button type="button" onClick={() => setOpen(false)}
              className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
              <IconClose width={14} height={14} />
            </button>
          </div>
          {/* the SAME fields the create dialog offers, forced on — the switch
              would be a second way to say what «توقف تکرار» already says */}
          <ScheduleFields
            repeats
            gapDays={gapDays}
            until={until}
            onRepeats={() => undefined}
            onGapDays={setGapDays}
            onUntil={setUntil}
          />
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
            <button type="button" onClick={() => setOpen(false)}
              className="btn text-fg-muted hover:text-fg">{t("cancel")}</button>
            <button type="button" disabled={busy}
              onClick={() => write({ gap_days: Number(gapDays) || 0, until_date: until })}
              className="btn bg-accent text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50">
              {t("save")}
            </button>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
