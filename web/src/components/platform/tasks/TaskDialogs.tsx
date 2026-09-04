"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type {
  OrgPersonRecord, TaskColumnRecord, TaskLabelColor, TaskLabelRecord,
  TaskPriority, TaskTopicRecord,
} from "@/api/types";
import { Overlay } from "../Overlay";
import { Avatar } from "@/components/Avatar";
import { Select } from "@/components/Select";
import { ConfirmDialog } from "@/components/rowActions";
import { JalaliPicker } from "./JalaliPicker";
import { IconCheck, IconClose, IconPencil, IconPlus, IconTrash, IconUser } from "@/components/icons";
import { digits, formatDate, personName } from "@/lib/format";

/**
 * The board's dialogs, built from the reference's own (walked field by field
 * on 2026-09-01) — the new-task form and the pickers it opens.
 */

export const LABEL_COLORS: TaskLabelColor[] = [
  "grey", "blue", "green", "amber", "red", "purple", "teal", "pink",
];

/** one tone → its chip classes. A closed map, so a colour cannot arrive
    from the wire that the theme has no answer for. */
export const TONE_CHIP: Record<string, string> = {
  grey: "bg-surface-2 text-fg-muted",
  blue: "bg-info/10 text-info",
  green: "bg-success/10 text-success",
  amber: "bg-warning/10 text-warning",
  red: "bg-danger/10 text-danger",
  purple: "bg-accent-soft text-accent",
  teal: "bg-success/10 text-success",
  pink: "bg-danger/10 text-danger",
};
export const TONE_DOT: Record<string, string> = {
  grey: "bg-fg-subtle",
  blue: "bg-info",
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-danger",
  purple: "bg-accent",
  teal: "bg-success",
  pink: "bg-danger",
};

export const PRIORITY_ORDER: TaskPriority[] = ["critical", "high", "medium", "low"];
export const PRIORITY_DOT: Record<TaskPriority, string> = {
  critical: "bg-danger",
  high: "bg-warning",
  medium: "bg-warning/70",
  low: "bg-fg-subtle",
};
export const PRIORITY_CHIP: Record<TaskPriority, string> = {
  critical: "bg-danger/10 text-danger",
  high: "bg-warning/10 text-warning",
  medium: "bg-warning/10 text-warning",
  low: "bg-surface-2 text-fg-muted",
};

/* ── the label row: chips that toggle, each with a pencil ─────────────── */
export function LabelRow({ labels, selected, onToggle, onChanged }: {
  labels: TaskLabelRecord[];
  selected: string[];
  onToggle: (id: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("tasks");
  const [editing, setEditing] = useState<TaskLabelRecord | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => {
        const on = selected.includes(label.id);
        return (
          <span key={label.id} className="flex items-center">
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(label.id)}
              /* 2026-09-03: `.btn btn-sm` with the fused edge flattened. The
                 pair was 32px beside a `.btn btn-sm` new-label button at 34,
                 and the guard could not see either half — its corner pattern
                 reads `rounded-lg`, not the logical `rounded-s-lg` these were
                 written with. The one-sided corner is the only geometry left
                 stated here, because a chip welded to a pencil is one
                 silhouette and the theme has no name for half of it. */
              className={`btn btn-sm rounded-e-none ${
                on ? TONE_CHIP[label.color] ?? TONE_CHIP.grey! : "bg-surface-2/60 text-fg-muted hover:text-fg"
              }`}
            >
              <span className={`h-2 w-2 rounded-sm ${TONE_DOT[label.color] ?? TONE_DOT.grey!}`} aria-hidden />
              {label.name}
              {on ? <IconCheck width={12} height={12} /> : null}
            </button>
            <button
              type="button"
              aria-label={t("editLabel")}
              onClick={() => setEditing(label)}
              className="btn btn-sm w-7 rounded-s-none px-0 bg-surface-2/60 text-fg-subtle hover:text-fg"
            >
              <IconPencil width={12} height={12} />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="btn btn-sm border border-dashed border-border text-fg-muted hover:text-fg"
      >
        <IconPlus width={12} height={12} />
        {t("newLabel")}
      </button>

      {creating || editing !== null ? (
        <LabelEditor
          label={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); onChanged(); }}
        />
      ) : null}
    </div>
  );
}

function LabelEditor({ label, onClose, onSaved }: {
  label: TaskLabelRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("tasks");
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState<TaskLabelColor>(label?.color ?? "grey");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [condemned, setCondemned] = useState(false);

  const save = () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    setFailed(false);
    const done = () => onSaved();
    const fail = () => { setBusy(false); setFailed(true); };
    if (label === null) void api.createTaskLabel(name.trim(), color).then(done).catch(fail);
    else void api.updateTaskLabel(label.id, { name: name.trim(), color }).then(done).catch(fail);
  };

  return (
    <Overlay onClose={onClose} label={label === null ? t("newLabel") : t("editLabel")}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-fg">{label === null ? t("newLabel") : t("editLabel")}</h2>
        {/* 2026-09-03: the theme's icon button. This one had no box at all
            while the new-task dialog's close next door had a 36px one — the
            same affordance in the same file in two shapes, and a bare icon
            also carries no `.tap`, so its hit area was the glyph. */}
        <button type="button" aria-label={t("close")} onClick={onClose}
          className="btn btn-icon text-fg-subtle hover:bg-surface-2 hover:text-fg">
          <IconClose width={14} height={14} />
        </button>
      </div>
      {failed ? <p role="alert" className="mb-2 text-xs text-danger">{t("writeFailed")}</p> : null}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-muted">{t("labelName")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
        />
      </label>
      <div className="mt-3">
        <span className="mb-1.5 block text-xs font-medium text-fg-muted">{t("labelColor")}</span>
        <div className="flex flex-wrap gap-1.5">
          {LABEL_COLORS.map((tone) => (
            <button
              key={tone}
              type="button"
              aria-label={tone}
              aria-pressed={color === tone}
              onClick={() => setColor(tone)}
              /* 2026-09-03: `.btn btn-icon`. This was carried as a keep whose
                 stated reason was `.btn`'s label padding and control height —
                 true of `.btn`, and not of `.btn-icon`, which is px-0 and 28px
                 square because "an icon-only control" is the case it was
                 measured for. What settles it is the twin: THE SAME EIGHT
                 COLOURS, the same 16px swatch inside, render in the column's
                 tone menu (TaskBoard) as `btn btn-icon` — so one palette in one
                 feature was drawn 32px/12px here and 28px/8px there, which is
                 the user's sentence about ten developers, in one product's one
                 palette. `.tap` goes because `.btn` composes it; `border` is
                 written out because `.btn` draws none, and `border-accent` on a
                 borderless button paints NOTHING (this repo shipped that once).
                 The swatch inside is untouched — the picture never changed. */
              className={`btn btn-icon border ${
                color === tone ? "border-accent" : "border-transparent"
              }`}
            >
              <span className={`h-4 w-4 rounded-md ${TONE_DOT[tone] ?? TONE_DOT.grey!}`} />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        {label !== null ? (
          <button
            type="button"
            onClick={() => setCondemned(true)}
            className="btn font-medium text-danger hover:bg-danger/10"
          >
            <IconTrash width={12} height={12} />
            {t("deleteLabel")}
          </button>
        ) : <span />}
        {/* 2026-09-03: the footer pair takes `.btn`. They were 40px/14px
            beside the delete button on the same row, which is `.btn` at
            38px/11px — three controls in one footer, two shapes. `.btn`
            owns the disabled face, so `disabled:opacity-50` leaves with the
            geometry; the border is written out because `.btn` draws none. */}
        <span className="flex gap-2">
          <button type="button" onClick={onClose}
            className="btn border border-border bg-surface text-fg hover:bg-border">
            {t("cancel")}
          </button>
          <button type="button" onClick={save} disabled={name.trim() === "" || busy}
            className="btn bg-accent text-on-accent">
            {t("save")}
          </button>
        </span>
      </div>

      {condemned && label !== null ? (
        <ConfirmDialog
          title={t("deleteLabelTitle", { name: label.name })}
          body={t("deleteLabelBody")}
          confirmLabel={t("deleteLabel")}
          cancelLabel={t("cancel")}
          onCancel={() => setCondemned(false)}
          onConfirm={() => {
            setCondemned(false);
            setBusy(true);
            void api.deleteTaskLabel(label.id).then(onSaved)
              .catch(() => { setBusy(false); setFailed(true); });
          }}
        />
      ) : null}
    </Overlay>
  );
}

/* ── the assignee picker: the org's people, searched by name ──────────── */
export function AssigneePicker({ selected, onToggle, people }: {
  selected: string[];
  onToggle: (userId: string) => void;
  /*
   * THE ROSTER, HANDED DOWN — not fetched here.
   *
   * User report, 2026-09-04: "the task is already assigned to Sina but it does
   * not show it; when I press the plus button it loads that Sina is assigned."
   * Both halves were one fact. The chips are `people.filter(…)`, and `people`
   * was fetched when the POPOVER OPENED, so a task with assignees rendered
   * exactly like a task with none until somebody clicked `+` — at which point
   * the people it had all along appeared. The names were downstream of a fetch
   * that only a click could start, and the screen said "nobody" while the
   * record said Sina.
   *
   * Loading it sooner was the small fix. This is the real one: the board
   * ALREADY reads the roster on mount and already hands it to TaskDetail, so
   * this component was keeping a second copy of a fact it had been given — and
   * the copy that was empty is the one the person was looking at. Both call
   * sites live under the board, so the roster is simply a prop now, and the
   * fetch, its loading state and its failure state are gone rather than fixed.
   */
  people: OrgPersonRecord[];
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const chosen = people.filter((p) => selected.includes(p.id));
  /* assigned, and not in the roster — a colleague who has left, or a roster
     read that came back empty. The COUNT stays true even when the name cannot:
     "nobody is assigned" and "we cannot name who" are different statements and
     must not be the same picture. */
  const unnamed = selected.filter((id) => !people.some((p) => p.id === id));
  const shown = people.filter((p) => query.trim() === ""
    || personName(p, locale).toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={box} className="relative flex flex-wrap items-center gap-1.5">
      {chosen.map((person) => (
        <button
          key={person.id}
          type="button"
          onClick={() => onToggle(person.id)}
          title={t("removeAssignee", { name: personName(person, locale) })}
          className="btn btn-sm bg-accent-soft font-medium text-accent"
        >
          {/* NAME ONLY (user directive, 2026-09-04: "do not include the
              avatar, the name is enough in the tasks assignments"). A mark
              that carries the same person's first letter directly beside
              their written name tells the reader nothing the name has not
              already told them, and in a chip it costs a fifth of the width
              that the name itself needs. */}
          {personName(person, locale)}
          <IconClose width={12} height={12} />
        </button>
      ))}
      {unnamed.map((id) => (
        <span key={id} className="btn btn-sm bg-surface-2 text-fg-subtle">
          {t("assigneeUnnamed")}
        </span>
      ))}
      <button
        type="button"
        aria-label={t("addAssignee")}
        onClick={() => setOpen((v) => !v)}
        /* 2026-09-03: the theme's compact control, square by width, so it is
           exactly the height of the assignee chips it stands in a row with
           (those are `.btn btn-sm`). The dashed edge stays — that is what
           says "add another"; only the invented 32px circle went. */
        className="btn btn-sm w-[34px] px-0 border border-dashed border-border text-fg-muted hover:text-fg"
      >
        <IconPlus width={12} height={12} />
      </button>

      {open ? (
        <div className="absolute top-10 z-50 w-64 rounded-2xl border border-border bg-surface p-2 shadow-island">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPerson")}
            /* 2026-09-03: the theme's compact field. It was the twin of the
               checklist adder's hand-drawn box in TaskDetail — the same nine
               classes, written twice — and `w-full` goes because `.input` owns
               it. The margin stays: that is this popover's, not the field's. */
            className="input-sm mb-1"
          />
          {shown.length === 0 ? <p className="p-2 text-xs text-fg-muted">{t("noPeopleFound")}</p>
            : (
                  <ul className="max-h-56 overflow-y-auto">
                    {shown.map((person) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          onClick={() => onToggle(person.id)}
                          className="tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-surface-2"
                        >
                          {/* 2026-09-03: the platform's avatar — a menu row's
                              28px, the same mark the task screen's comments and
                              history now show for the same colleague. */}
                          <Avatar name={personName(person, locale)} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-fg">
                              {personName(person, locale)}
                            </span>
                            <span className="block text-[10px] text-fg-subtle">{t(`role_${person.role}`)}</span>
                          </span>
                          {selected.includes(person.id)
                            ? <IconCheck width={12} height={12} className="text-accent" /> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
        </div>
      ) : null}
    </div>
  );
}

/* ── the deadline field: a button that opens the picker ───────────────── */
export function DueField({ value, onPick }: {
  value: string | null;
  onPick: (iso: string | null) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn w-full justify-between border border-border bg-surface text-fg hover:border-border-strong"
      >
        <span className={value === null ? "text-fg-subtle" : ""}>
          {value === null ? t("pickDue") : formatDate(value, locale)}
        </span>
        <IconCheck width={12} height={12} className={value === null ? "opacity-0" : "text-accent"} />
      </button>
      {open ? (
        <div className="absolute top-11 z-50">
          <JalaliPicker value={value} onPick={onPick} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/* ── THE NEW-TASK DIALOG, field for field ────────────────────────────── */
export function NewTaskDialog({ columns, topics, labels, people, defaultColumnId, defaultTopicId, allowSchedule = false, onClose, onCreated, onLabelsChanged }: {
  columns: TaskColumnRecord[];
  topics: TaskTopicRecord[];
  labels: TaskLabelRecord[];
  people: OrgPersonRecord[];
  defaultColumnId: string | null;
  defaultTopicId: string | null;
  /**
   * Offer the REPEATING ORDER fields (0186).
   *
   * On by default nowhere: a schedule is the project surface's idea — work
   * handed to somebody that has to come back — and putting it on the board's
   * own quick-add would add a section to the one dialog people use twenty
   * times a day for a thing they want twice a month.
   *
   * ONE dialog either way. A separate "order" dialog would be a second copy
   * of eight fields, and the day one of them gained a rule is the day the two
   * stopped matching.
   */
  allowSchedule?: boolean;
  onClose: () => void;
  onCreated: () => void;
  onLabelsChanged: () => void;
}) {
  const t = useTranslations("tasks");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [topicId, setTopicId] = useState(defaultTopicId ?? "");
  const [columnId, setColumnId] = useState(defaultColumnId ?? columns[0]?.id ?? "");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [due, setDue] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
  /* the schedule, held as three plain values rather than an object: an
     absent schedule is `repeats === false`, which is one boolean instead of
     a null that every field then has to guard against */
  const [repeats, setRepeats] = useState(false);
  const [gapDays, setGapDays] = useState("0");
  const [until, setUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = () => {
    if (title.trim() === "" || busy) return;
    setBusy(true);
    setFailed(false);
    /*
     * ONE WRITE (0186). This used to create the card and then fire the
     * labels and the people at it, each with its own `.catch(() =>
     * undefined)`, on the reasoning that a failed label must not lose the
     * card. That is right about a label and wrong about a PERSON: a card
     * that exists and belongs to nobody is indistinguishable from one
     * nobody has got to yet, and on a board whose whole purpose is handing
     * work out, that is the failure that matters. The server takes all of
     * it in one transaction now; a refusal leaves the dialog open with
     * every field still filled in.
     */
    void api.createTask({
      title: title.trim(),
      column_id: columnId,
      ...(topicId !== "" ? { topic_id: topicId } : {}),
      ...(description.trim() !== "" ? { description } : {}),
      priority,
      ...(due !== null ? { due_at: due } : {}),
      ...(assignees.length > 0 ? { assignees } : {}),
      ...(labelIds.length > 0 ? { label_ids: labelIds } : {}),
      ...(repeats ? { schedule: { gap_days: Number(gapDays) || 0, until_date: until } } : {}),
    })
      .then(() => onCreated())
      .catch(() => { setBusy(false); setFailed(true); });
  };

  return (
    <Overlay onClose={onClose} label={t("newTask")} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{t("newTask")}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">{t("newTaskSubtitle")}</p>
        </div>
        {/* 2026-09-03: `.btn btn-icon`, the one icon-only shape in the theme
            — the same control the task screen's close and every kebab in the
            product already render. */}
        <button type="button" aria-label={t("close")} onClick={onClose}
          className="btn btn-icon shrink-0 border border-border text-fg-subtle hover:text-fg">
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className="scroll-quiet min-h-0 flex-1 space-y-3 overflow-y-auto pe-1 pt-2">
        {failed ? <p role="alert" className="text-xs text-danger">{t("writeFailed")}</p> : null}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldTitleRequired")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
            className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent" />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldDescription")}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            placeholder={t("descriptionPlaceholder")}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent" />
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldLabels")}</span>
          <LabelRow
            labels={labels}
            selected={labelIds}
            onToggle={(id) => setLabelIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
            onChanged={onLabelsChanged}
          />
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldTopicFolder")}</span>
          {/* the platform's own dropdown, not the browser's: a native
              option list paints on Chrome's sheet with its own blue
              selection and nothing in this stylesheet reaches it */}
          <Select
            value={topicId}
            onChange={setTopicId}
            ariaLabel={t("fieldTopicFolder")}
            options={[
              { value: "", label: t("noTopic") },
              ...topics.map((topic) => ({ value: topic.id, label: topic.name })),
            ]}
          />
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldColumn")}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("fieldColumn")}>
            {columns.map((column) => (
              <button
                key={column.id}
                type="button"
                role="radio"
                aria-checked={columnId === column.id}
                onClick={() => setColumnId(column.id)}
                /* 2026-09-03: `.btn btn-sm` + an explicit border. The guard
                   never saw this row (a height and a corner, no centring
                   word) while it saw the priority row directly below, which
                   is the same control — converting one and not the other
                   would have put two shapes in one form. */
                className={`btn btn-sm border ${
                  columnId === column.id
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border bg-surface text-fg-muted hover:text-fg"
                }`}
              >
                {column.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldPriority")}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("fieldPriority")}>
            {PRIORITY_ORDER.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={priority === level}
                onClick={() => setPriority(level)}
                /* 2026-09-03: the same `.btn btn-sm` the task screen's rail
                   now uses for this very choice — one product, one priority
                   button. The border is written out because `.btn` draws
                   none, and `border-warning` on a borderless button would
                   paint nothing. */
                className={`btn btn-sm border ${
                  priority === level
                    ? "border-warning bg-warning/10 text-warning"
                    : "border-border bg-surface text-fg-muted hover:text-fg"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[level]}`} aria-hidden />
                {t(`priority_${level}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldDue")}</span>
            <DueField value={due} onPick={setDue} />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldAssignees")}</span>
            <AssigneePicker
              people={people}
              selected={assignees}
              onToggle={(id) => setAssignees((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
            />
          </div>
        </div>

        {allowSchedule ? (
          <ScheduleFields
            repeats={repeats}
            gapDays={gapDays}
            until={until}
            onRepeats={setRepeats}
            onGapDays={setGapDays}
            onUntil={setUntil}
          />
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between">
        {/* 2026-09-03: `.btn` — it stood at 40px/14px beside the create
            button on the same row, which was already `.btn` at 38px/11px.
            Two buttons in one footer, two shapes, was the directive in
            miniature. */}
        <button type="button" onClick={onClose}
          className="btn border border-border bg-surface text-fg hover:bg-border">
          {t("cancel")}
        </button>
        <button type="button" onClick={submit} disabled={title.trim() === "" || busy || columnId === ""}
          className="btn bg-accent font-semibold text-on-accent shadow-accent disabled:opacity-50">
          <IconPlus width={14} height={14} />
          {t("createTask")}
        </button>
      </div>
    </Overlay>
  );
}

/**
 * THE REPEATING ORDER's three fields (0186), one component so the create
 * dialog and the task detail cannot drift into two spellings of the same
 * schedule.
 *
 * The switch first, then the two numbers it governs, and the numbers are
 * HIDDEN rather than disabled when it is off — a disabled date picker beside
 * an off switch is two controls saying the same thing.
 */
/**
 * An instant as the READER'S calendar day, `YYYY-MM-DD`.
 *
 * NOT `toISOString().slice(0, 10)`, which is the same line one timezone to
 * the left: a date picked at 9pm in Tehran is already tomorrow in UTC, so the
 * schedule would end a day later than the person chose — and only for people
 * east of the meridian, in the evening, which is a bug that gets reported as
 * "sometimes".
 */
function calendarDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ScheduleFields({ repeats, gapDays, until, onRepeats, onGapDays, onUntil }: {
  repeats: boolean;
  gapDays: string;
  until: string | null;
  onRepeats: (on: boolean) => void;
  onGapDays: (value: string) => void;
  onUntil: (value: string | null) => void;
}) {
  const t = useTranslations("tasks");
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={repeats}
          onChange={(e) => onRepeats(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        <span className="text-xs font-medium text-fg">{t("scheduleRepeats")}</span>
      </label>
      <p className="mt-1 text-[11px] leading-5 text-fg-muted">{t("scheduleExplain")}</p>

      {repeats ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-muted">{t("scheduleGap")}</span>
            <input
              type="number"
              min={0}
              max={365}
              value={gapDays}
              onChange={(e) => onGapDays(e.target.value)}
              /* dir="ltr" and NOT a logical form: a number input's spinner and
                 its digits are physical, and the field sits inside an RTL
                 form where `end` would put the caret on the wrong side of the
                 value somebody is typing */
              dir="ltr"
              className="input w-full"
            />
            <span className="mt-1 block text-[11px] text-fg-subtle">{t("scheduleGapHint")}</span>
          </label>
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">{t("scheduleUntil")}</span>
            {/* the BOARD'S OWN date control, not a second one: it carries
                the Jalali grid, the presets and «بدون مهلت» — which is
                exactly "unlimited in time" and already spelled once. */}
            <DueField
              value={until}
              onPick={(iso) => onUntil(iso === null ? null : calendarDay(iso))}
            />
            <span className="mt-1 block text-[11px] text-fg-subtle">
              {until === null ? t("scheduleForever") : t("scheduleUntilHint")}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** «۴۱ دقیقه پیش» — the history's own clock */
export function relativeTime(iso: string, locale: string, t: (k: string, v?: Record<string, string>) => string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return t("justNow");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("minutesAgo", { n: digits(minutes, locale) });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("hoursAgo", { n: digits(hours, locale) });
  const days = Math.round(hours / 24);
  if (days < 30) return t("daysAgo", { n: digits(days, locale) });
  return formatDate(iso, locale);
}

export { IconUser };
