"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type {
  OrgPersonRecord, TaskColumnRecord, TaskLabelColor, TaskLabelRecord,
  TaskPriority, TaskTopicRecord,
} from "@/api/types";
import { Overlay } from "../Overlay";
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
              className={`tap flex h-8 items-center gap-1.5 rounded-s-lg px-2.5 text-xs font-medium transition-colors ${
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
              className="tap grid h-8 w-7 place-items-center rounded-e-lg bg-surface-2/60 text-fg-subtle hover:text-fg"
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
        <button type="button" aria-label={t("close")} onClick={onClose} className="text-fg-subtle hover:text-fg">
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
              className={`tap grid h-8 w-8 place-items-center rounded-lg border ${
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
        <span className="flex gap-2">
          <button type="button" onClick={onClose}
            className="tap h-10 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-border">
            {t("cancel")}
          </button>
          <button type="button" onClick={save} disabled={name.trim() === "" || busy}
            className="tap h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-50">
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
export function AssigneePicker({ selected, onToggle }: {
  selected: string[];
  onToggle: (userId: string) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<OrgPersonRecord[] | null | "failed">(null);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || people !== null) return;
    void api.orgPeople().then(setPeople).catch(() => setPeople("failed"));
  }, [open, people]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const chosen = Array.isArray(people) ? people.filter((p) => selected.includes(p.id)) : [];
  const shown = Array.isArray(people)
    ? people.filter((p) => query.trim() === ""
      || personName(p, locale).toLowerCase().includes(query.trim().toLowerCase()))
    : [];

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
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-on-accent" aria-hidden>
            {personName(person, locale).slice(0, 1)}
          </span>
          {personName(person, locale)}
          <IconClose width={12} height={12} />
        </button>
      ))}
      <button
        type="button"
        aria-label={t("addAssignee")}
        onClick={() => setOpen((v) => !v)}
        className="tap grid h-8 w-8 place-items-center rounded-full border border-dashed border-border text-fg-muted hover:text-fg"
      >
        <IconPlus width={12} height={12} />
      </button>

      {open ? (
        <div className="absolute top-10 z-50 w-64 rounded-2xl border border-border bg-surface p-2 shadow-island">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPerson")}
            className="mb-1 h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
          />
          {people === null ? <p className="p-2 text-xs text-fg-muted">…</p>
            : people === "failed" ? <p className="p-2 text-xs text-fg-muted">{t("readFailed")}</p>
              : shown.length === 0 ? <p className="p-2 text-xs text-fg-muted">{t("noPeopleFound")}</p>
                : (
                  <ul className="max-h-56 overflow-y-auto">
                    {shown.map((person) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          onClick={() => onToggle(person.id)}
                          className="tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-surface-2"
                        >
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-on-accent" aria-hidden>
                            {personName(person, locale).slice(0, 1)}
                          </span>
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
export function NewTaskDialog({ columns, topics, labels, defaultColumnId, defaultTopicId, onClose, onCreated, onLabelsChanged }: {
  columns: TaskColumnRecord[];
  topics: TaskTopicRecord[];
  labels: TaskLabelRecord[];
  defaultColumnId: string | null;
  defaultTopicId: string | null;
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
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = () => {
    if (title.trim() === "" || busy) return;
    setBusy(true);
    setFailed(false);
    void api.createTask({
      title: title.trim(),
      column_id: columnId,
      ...(topicId !== "" ? { topic_id: topicId } : {}),
      ...(description.trim() !== "" ? { description } : {}),
      priority,
      ...(due !== null ? { due_at: due } : {}),
    })
      .then(async (task) => {
        /* the card exists; its labels and people are separate writes, and a
           failure in one of them must not lose the card */
        await Promise.all([
          ...labelIds.map((id) => api.setTaskLabel(task.id, id, true).catch(() => undefined)),
          ...assignees.map((id) => api.setTaskAssignee(task.id, id, true).catch(() => undefined)),
        ]);
        onCreated();
      })
      .catch(() => { setBusy(false); setFailed(true); });
  };

  return (
    <Overlay onClose={onClose} label={t("newTask")} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{t("newTask")}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">{t("newTaskSubtitle")}</p>
        </div>
        <button type="button" aria-label={t("close")} onClick={onClose}
          className="tap grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border text-fg-subtle hover:text-fg">
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
                className={`tap h-9 rounded-xl border px-3 text-xs font-medium transition-colors ${
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
                className={`tap flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
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
              selected={assignees}
              onToggle={(id) => setAssignees((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onClose}
          className="tap h-10 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-border">
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
