"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Select } from "@/components/Select";
import { Avatar } from "@/components/Avatar";
import { api } from "@/api/client";
import type {
  ChatChannelRecord, OrgPersonRecord, TaskColumnRecord, TaskDetailRecord, TaskLabelRecord,
  TaskPriority, TaskTopicRecord,
} from "@/api/types";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import {
  AssigneePicker, DueField, LabelRow, PRIORITY_DOT, PRIORITY_ORDER, ScheduleFields,
  TONE_CHIP, TONE_DOT, relativeTime,
} from "./TaskDialogs";
import { Overlay } from "../Overlay";
import { BODY_HEADING, DIALOG_BODY, RAIL_EMPTY, RAIL_LABEL, RAIL_VALUE, SECTION_EMPTY, TAB_BAR, tabClass } from "./panelStyle";
import { DetailPanel } from "../DetailPanel";
import {
  IconArchive, IconCheck, IconClose, IconPencil, IconPlus, IconRetry, IconTrash, IconVideo,
} from "@/components/icons";
import { digits, formatDate, personName, personPhoto } from "@/lib/format";
import { useSeededName } from "@/lib/seededNames";
import { notifyError } from "@/lib/notify";

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
export function TaskDetail({ task, columns, topics, labels, people, isAdmin = false, onClose, onChanged, onLabelsChanged }: {
  task: TaskDetailRecord;
  columns: TaskColumnRecord[];
  topics: TaskTopicRecord[];
  labels: TaskLabelRecord[];
  people: OrgPersonRecord[];
  /** the room row is an admin's control and everybody else's reading
      (db/0227's trigger) — ABSENT rather than refused for a member */
  isAdmin?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onLabelsChanged: () => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  /* the picker offers the same four names the board draws — see TaskViews */
  const seededName = useSeededName();
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
  /* THE REFUSAL SAYS ITSELF (2026-09-08). This was a boolean feeding a red
     strip under the panel's top bar; it is a toast now, so the twelve
     `.catch()` arms below all say the same sentence in the same place as
     every other refused write on the platform. */
  const fail = () => notifyError(t("writeFailed"));

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
  }, [task.id, task.title, task.description]);

  const patch = (body: Record<string, unknown>) => {
    void api.updateTask(task.id, body).then(onChanged).catch(() => fail());
  };
  const nameOf = (id: string): string => {
    const person = people.find((p) => p.id === id);
    return person === undefined ? t("someone") : personName(person, locale);
  };
  /* the same lookup for the FACE. Separate from `nameOf` because the two
     answer differently when the roster does not hold the id: a name falls back
     to «کسی», and a photo falls back to nothing at all — `<Avatar>` then draws
     that fallback's own initial, which is the honest mark for somebody the
     roster cannot name. */
  const photoOf = (id: string): string | null => personPhoto(people.find((p) => p.id === id));

  const done = task.checklist.filter((line) => line.done).length;
  const sentence = (kind: string, detail: Record<string, string>): string => {
    const key = `event_${kind}`;
    return t(key as "event_done", {
      from: detail.from ?? "", to: detail.to ?? "",
      label: detail.label ?? "", person: detail.person ?? "", room: detail.room ?? "",
    });
  };

  /* R18 (2026-09-05): the frame is DetailPanel's — the same card the
     project detail opens in — and this file keeps only what goes in its
     slots. The clusters are named so the markup below reads as the slots
     it fills. */
  /*
   * THE ACTS SIT WITH THE ACTS (user directive, 2026-09-19: "put the three
   * dot and edit on the other side for tasks and projects").
   *
   * They were in the panel's START slot, which is where the CLOSE button
   * lives — so the top bar read: close, kebab, edit … and then, a whole panel
   * away, the record chip and the done toggle. Chrome and content in one
   * cluster, with the object's own acts split across two.
   *
   * Now the close is alone on its side and everything a person can DO to this
   * task is on the other, overflow menu last, which is the order every row in
   * the product already uses.
   */
  const acts = (
    <>
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
              className="btn-secondary btn-sm">
              <IconPencil width={12} height={12} />
              {editing ? t("done") : t("edit")}
            </button>
    </>
  );
  const end = (
    <>
            {task.call_id !== null ? (
              /* the MEETING's page when the record has one (2026-09-08), else
                 the RECORD's own page (2026-09-06, the check-up: this linked
                 `/meetings?call=`, a page that reads no such parameter, so the
                 chip opened the meetings list and dropped the call on the way) */
              <Link href={task.meeting_id !== null ? `/meetings/${task.meeting_id}` : `/calls/${task.call_id}`}
                className="btn-soft btn-sm">
                <IconVideo width={12} height={12} />
                <span className="max-w-[17.5rem] truncate">{task.meeting_title ?? task.call_title ?? t("recordGone")}</span>
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
            {acts}
    </>
  );
  const rail = (
    <>
            <div>
              <span className={RAIL_LABEL}>{t("fieldTopic")}</span>
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
              <span className={RAIL_LABEL}>{t("fieldColumn")}</span>
              <Select
                value={task.column_id}
                onChange={(v) => patch({ column_id: v })}
                ariaLabel={t("fieldColumn")}
                options={columns.map((column) => ({ value: column.id, label: seededName(column.name) }))}
              />
            </div>

            <div>
              <span className={RAIL_LABEL}>{t("fieldAssignees")}</span>
              {task.assignee_ids.length === 0 ? (
                <p className="mb-1 text-xs text-fg-subtle">{t("noAssignee")}</p>
              ) : null}
              <AssigneePicker
                people={people}
                selected={task.assignee_ids}
                onToggle={(userId) => {
                  const on = !task.assignee_ids.includes(userId);
                  void api.setTaskAssignee(task.id, userId, on).then(onChanged).catch(() => fail());
                }}
              />
            </div>

            {/* THE ROOM (db/0227): the chat room the card's people talk in.
                An admin picks one of the org's rooms or makes one named
                after the card; everybody assigned is seated in it by the
                database, no invitation. A member reads the name as a door
                into the room — the control is ABSENT for them rather than
                offered and refused (the trigger would answer 403). */}
            <div>
              <span className={RAIL_LABEL}>{t("fieldRoom")}</span>
              {isAdmin ? (
                <RoomRow task={task} onChanged={onChanged} onFailed={fail} />
              ) : task.channel_id === null ? (
                <span className={RAIL_EMPTY}>{t("noRoom")}</span>
              ) : (
                <Link
                  href={`/chat?room=${encodeURIComponent(task.channel_id)}`}
                  className={`${RAIL_VALUE} hover:text-accent`}
                >
                  {task.channel_name ?? t("openRoom")}
                </Link>
              )}
            </div>

            <div>
              <span className={RAIL_LABEL}>{t("fieldPriority")}</span>
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
              <span className={RAIL_LABEL}>{t("fieldDue")}</span>
              <DueField value={task.due_at} onPick={(iso) => patch({ due_at: iso })} />
            </div>

            <div>
              <span className={RAIL_LABEL}>{t("fieldLabels")}</span>
              {task.label_ids.length === 0 ? (
                <p className="mb-1 text-xs text-fg-subtle">{t("noLabels")}</p>
              ) : null}
              <LabelRow
                labels={labels}
                selected={task.label_ids}
                onToggle={(id) => {
                  const on = !task.label_ids.includes(id);
                  void api.setTaskLabel(task.id, id, on).then(onChanged).catch(() => fail());
                }}
                onChanged={onLabelsChanged}
              />
            </div>

            {/* THE REPEATING ORDER (0186). It renders here, in the rail
                where every other property of the card lives, rather than as
                a section of its own — a schedule is a fact about this task
                exactly like its priority and its due date. */}
            <ScheduleRow task={task} onChanged={onChanged} onFailed={fail} />

            {task.created_at !== "" ? (
              <p className="pt-1 text-micro text-fg-subtle">
                {t("createdAt", { at: formatDate(task.created_at, locale) })}
              </p>
            ) : null}
    </>
  );

  return (
    <>
      <DetailPanel
        label={task.title}
        closeLabel={t("close")}
        onClose={onClose}
        end={end}
        rail={rail}
      >
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
              <h2 className={`text-[1.0625rem] font-bold ${task.done ? "text-fg-subtle line-through" : "text-fg"}`}>
                {task.title}
              </h2>
            )}

            <section aria-label={t("fieldDescription")}>
              <h3 className={`${BODY_HEADING} mb-2`}>{t("fieldDescription")}</h3>
              {editing ? (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => { if (description !== task.description) patch({ description }); }}
                  rows={3}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
              ) : task.description.trim() === "" ? (
                <p className={`${SECTION_EMPTY} text-sm text-fg-subtle`}>{t("noDescription")}</p>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-7 text-fg">{task.description}</p>
              )}
            </section>

            <section aria-label={t("checklist")}>
              <h3 className="h-label mb-1.5">
                {t("checklist")} ({digits(done, locale)}/{digits(task.checklist.length, locale)})
              </h3>
              {task.checklist.length === 0 ? (
                <p className={`${SECTION_EMPTY} text-sm text-fg-subtle`}>{t("checklistEmpty")}</p>
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
                            .then(onChanged).catch(() => fail());
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
                      .catch(() => fail());
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
                      .catch(() => fail());
                  }}
                  /* 2026-09-03: the theme's height and corner, square by
                     width — the sanctioned spelling for an icon button that
                     has to be wider than `.btn-icon`'s 28px, since this one
                     stands at the end of a field row. `.btn` owns the
                     disabled face, so the old `disabled:opacity-50` goes
                     with the geometry. */
                  className="btn-primary w-control px-0"
                >
                  <IconPlus width={12} height={12} />
                </button>
              </div>
            </section>

            {/* ── the two tabs AND the tab's content, one section ──────
                DetailPanel divides its body's children (2026-09-05); the bar
                and what it switches are one thing, or a hairline would cut
                between them */}
            <section aria-label={t("comments")}>
            <div role="tablist" className={`${TAB_BAR} mb-4`}>
              {([["comments", `${t("comments")} ${digits(task.comments.length, locale)}`],
                 ["history", `${t("history")} ${digits(task.events.length, locale)}`]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  /* the reference's own tab, measured 2026-09-05: 32px on
                     an 8px corner inside a 42px bar, and the active one is
                     lifted by GROUND rather than by a shadow — a shadow
                     inside a recessed strip reads as a second surface. */
                  className={tabClass(tab === key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "comments" ? (
              <div className="space-y-3">
                {task.comments.length === 0 ? (
                  <p className={`${SECTION_EMPTY} text-sm text-fg-subtle`}>{t("noComments")}</p>
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
                        <Avatar name={nameOf(entry.created_by)} src={photoOf(entry.created_by)} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold text-fg">{nameOf(entry.created_by)}</span>
                            <span className="text-caption text-fg-subtle">
                              {relativeTime(entry.created_at, locale, t as never)}
                            </span>
                          </span>
                          <span className="mt-0.5 block whitespace-pre-wrap text-sm leading-6 text-fg">{entry.body}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="well p-2">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (comment.trim() === "") return;
                        void api.addTaskComment(task.id, comment.trim())
                          .then(() => { setComment(""); onChanged(); })
                          .catch(() => fail());
                      }
                    }}
                    rows={2}
                    placeholder={t("commentPlaceholder")}
                    className="w-full resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-micro text-fg-subtle">{t("commentHint")}</span>
                    <button
                      type="button"
                      disabled={comment.trim() === ""}
                      onClick={() => {
                        void api.addTaskComment(task.id, comment.trim())
                          .then(() => { setComment(""); onChanged(); })
                          .catch(() => fail());
                      }}
                      /* 2026-09-03: the theme's compact control. Another one
                         the guard is blind to (a height and a corner, no
                         centring word) — converted anyway, because a shape
                         is not less invented for being unmeasurable. */
                      className="btn-primary btn-sm"
                    >
                      {t("postComment")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {task.events.length === 0 ? (
                  <li className={`${SECTION_EMPTY} text-sm text-fg-subtle`}>{t("noHistory")}</li>
                ) : task.events.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2.5">
                    {/* 2026-09-03: the platform's avatar. This tab drew its own
                        twin of the comment list's mark, three lines apart in one
                        file — which is the divergence at its smallest. */}
                    <Avatar name={nameOf(entry.actor_id)} src={photoOf(entry.actor_id)} size="sm" />
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
            </section>
      </DetailPanel>

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
            void api.deleteTask(task.id).then(() => { onChanged(); onClose(); }).catch(() => fail());
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
            void api.deleteTaskChecklistItem(line.id).then(onChanged).catch(() => fail());
          }}
        />
      ) : null}
    </>
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
/**
 * THE ROOM ROW, for an admin (db/0227). The org's live rooms in the kit's
 * dropdown with «no room» as the first answer, and beside it «new room»,
 * which makes a channel named after the card and points the card at it in
 * one server transaction. Clearing is a PATCH with null. The list is read
 * when the row mounts — an admin opening a card reads the rooms once, and
 * a member never does.
 */
function RoomRow({ task, onChanged, onFailed }: {
  task: TaskDetailRecord;
  onChanged: () => void;
  onFailed: () => void;
}) {
  const t = useTranslations("tasks");
  const [rooms, setRooms] = useState<ChatChannelRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void api.chatChannels()
      .then((list) => { if (live) setRooms(list.filter((r) => r.archived_at === null)); })
      .catch(() => { if (live) setRooms([]); });
    return () => { live = false; };
  }, []);
  /* the card's own room is offered even when the list has not landed, so
     the control never reads «no room» over a card that has one */
  const options = [
    { value: "", label: t("noRoom") },
    ...(rooms ?? []).map((room) => ({ value: room.id, label: room.name })),
    ...(task.channel_id !== null && !(rooms ?? []).some((r) => r.id === task.channel_id)
      ? [{ value: task.channel_id, label: task.channel_name ?? t("openRoom") }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={task.channel_id ?? ""}
        onChange={(v) => {
          if (v === (task.channel_id ?? "")) return;
          void api.updateTask(task.id, { channel_id: v === "" ? null : v }).then(onChanged).catch(onFailed);
        }}
        ariaLabel={t("fieldRoom")}
        options={options}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api.createTaskRoom(task.id).then(onChanged).catch(onFailed).finally(() => setBusy(false));
          }}
        >
          <IconPlus width={14} height={14} />
          {t("roomNew")}
        </button>
        {task.channel_id !== null ? (
          <Link
            href={`/chat?room=${encodeURIComponent(task.channel_id)}`}
            className="btn-ghost btn-sm"
          >
            {t("openRoom")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

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
      <span className={RAIL_LABEL}>{t("scheduleField")}</span>
      {schedule === null ? (
        <button type="button" onClick={() => setOpen(true)}
          className="btn-secondary btn-sm w-full justify-start">
          <IconRetry width={12} height={12} />
          {t("scheduleAdd")}
        </button>
      ) : (
        <div className="well p-2.5">
          <p className={`text-caption leading-5 ${schedule.active ? "text-fg" : "text-warning"}`}>
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
            <p className="mt-0.5 text-micro text-fg-subtle">
              {t("scheduleRenewedTimes", { n: digits(schedule.renewed, locale) })}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-1.5">
            <button type="button" onClick={() => setOpen(true)} disabled={busy}
              className="btn-secondary btn-sm">
              {t("edit")}
            </button>
            <button type="button" onClick={() => write(null)} disabled={busy}
              className="btn-ghost-danger btn-sm">
              {t("scheduleStop")}
            </button>
          </div>
        </div>
      )}

      {open ? (
        <Overlay onClose={() => setOpen(false)} label={t("scheduleField")} size="sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="h-dialog">{t("scheduleField")}</h2>
            <button type="button" onClick={() => setOpen(false)}
              className="btn-ghost btn-icon" aria-label={t("close")}>
              <IconClose width={14} height={14} />
            </button>
          </div>
          <div className={DIALOG_BODY}>
          {/* the SAME fields the create dialog offers, forced on — no
              `onRepeats`, so the fields draw NO switch: a checkbox wired to
              nothing (which is what stood here until 2026-09-06) is a control
              that does not respond, and «توقف تکرار» is the way off */}
          <ScheduleFields
            repeats
            gapDays={gapDays}
            until={until}
            onGapDays={setGapDays}
            onUntil={setUntil}
          />
          </div>
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setOpen(false)}
              className="btn-ghost">{t("cancel")}</button>
            <button type="button" disabled={busy}
              onClick={() => write({ gap_days: Number(gapDays) || 0, until_date: until })}
              className="btn-primary">
              {t("save")}
            </button>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
