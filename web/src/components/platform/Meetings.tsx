"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { MeetingAgendaItem, MeetingMode, MeetingRecord } from "@/api/types";
import { Overlay } from "./Overlay";
import {
  IconArchive, IconCalendar, IconChevronRight, IconClose, IconDots, IconFolder,
  IconMic, IconPlus, IconTrash, IconUpload, IconVideo,
} from "@/components/icons";
import { ConfirmDialog } from "@/components/rowActions";
import { asciiDigits, dayKeyOf, digits, formatDate, formatTime, monthGridAt } from "@/lib/format";

/**
 * MEETINGS (0145, the reference adoption) — "add a part name meeting and
 * add the online section that we dont have".
 *
 * A meeting is a scheduled fact that later gains a record, and its screen
 * follows that life:
 *
 *   · the LIST: upcoming first (nearest at the top), then the past. Each
 *     row carries its holding mode as a badge, because the mode is the one
 *     fact that changes what "start" means.
 *   · the STAGE is DERIVED, never stored: no record and still ahead = pre;
 *     no record and due = ready to hold; a linked record = held. A stored
 *     stage would be a second spelling of facts the row already carries.
 *   · شروع جلسه hands the meeting to the RECORDER (/echo?meeting=id) —
 *     online mode arrives there as the system-audio source, in-person as
 *     the microphone, upload as the upload lane. The recorder patches
 *     call_id back, which is what moves the meeting to its post stage.
 */

export const MODE_ICON: Record<MeetingMode, ReturnType<typeof IconMic>> = {
  upload: <IconUpload width={14} height={14} />,
  in_person: <IconMic width={14} height={14} />,
  online: <IconVideo width={14} height={14} />,
};

export function Meetings() {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<MeetingRecord[] | null | "failed">(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* the reference's own two axes: a view and a stage filter, plus topics */
  const [view, setView] = useState<"list" | "calendar">("list");
  const [filter, setFilter] = useState<"all" | "ahead" | "held" | "archived">("all");
  const [topic, setTopic] = useState<string>("all");
  const [menu, setMenu] = useState<string | null>(null);
  const [condemned, setCondemned] = useState<MeetingRecord | null>(null);

  const load = useCallback(() => {
    void api.meetings({ archived: filter === "archived" })
      .then(setRows)
      .catch(() => setRows("failed"));
  }, [filter]);
  useEffect(load, [load]);

  /* ?new=1 — the dashboard's «شروع ضبط جلسه» and the rail's CTA land here
     with the dialog already open, its time defaulted to the click moment.
     useSearchParams (the house pattern) rather than a mount-only read:
     the rail's link must work while ALREADY standing on /meetings. */
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const refusal = () => setError(t("writeFailed"));

  const topics = Array.isArray(rows)
    ? [...new Set(rows.map((m) => m.topic).filter((x): x is string => x !== null))]
    : [];

  const shown = useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const now = Date.now();
    return rows.filter((m) => {
      const ahead = new Date(m.scheduled_at).getTime() >= now && m.call_id === null;
      if (filter === "ahead" && !ahead) return false;
      if (filter === "held" && m.call_id === null) return false;
      if (topic !== "all" && (topic === "none" ? m.topic !== null : m.topic !== topic)) return false;
      return true;
    }).sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  }, [rows, filter, topic]);

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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── the toolbar, in the reference's order ─────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {chip(view === "list", t("viewMeetingList"), () => setView("list"))}
          {chip(view === "calendar", t("viewMeetingCalendar"), () => setView("calendar"))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {chip(filter === "all", t("filterAll"), () => setFilter("all"))}
          {chip(filter === "ahead", t("filterAhead"), () => setFilter("ahead"))}
          {chip(filter === "held", t("filterHeld"), () => setFilter("held"))}
          {chip(filter === "archived", t("filterArchived"), () => setFilter("archived"))}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="tap flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent shadow-accent transition-opacity hover:opacity-90"
        >
          <IconPlus width={14} height={14} />
          {t("newMeeting")}
        </button>
      </div>

      {/* ── the topic row ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={topic === "all"}
          onClick={() => setTopic("all")}
          className={`tap flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
            topic === "all" ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          <IconFolder width={12} height={12} />
          {t("allMeetings")}
          <span className="badge-num rounded-md bg-surface-2 px-1 text-[10px]">
            {digits(Array.isArray(rows) ? rows.length : 0, locale)}
          </span>
        </button>
        {topics.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={topic === name}
            onClick={() => setTopic((cur) => (cur === name ? "all" : name))}
            className={`tap flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
              topic === name ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-fg-muted hover:text-fg"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            {name}
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
        </button>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-fg-subtle">…</p>
      ) : rows === "failed" ? (
        <p className="text-sm text-fg-subtle">{t("readFailed")}</p>
      ) : shown.length === 0 ? (
        <div className="tile grid place-items-center p-10 text-center">
          <IconCalendar width={24} height={24} />
          <p className="mt-2 text-sm text-fg-muted">
            {filter === "archived" ? t("archiveEmpty") : rows.length === 0 ? t("empty") : t("noneInFilter")}
          </p>
        </div>
      ) : view === "calendar" ? (
        <MeetingCalendar meetings={shown} locale={locale}
          onOpen={(id) => router.push(`/meetings/${id}`)} />
      ) : (
        <ul className="space-y-2">
          {shown.map((m) => (
            <li key={m.id} className="relative">
              <div
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/meetings/${m.id}`)}
                onKeyDown={(e) => { if (e.key === "Enter") router.push(`/meetings/${m.id}`); }}
                className="tile flex cursor-pointer items-center gap-3 p-3.5 transition-colors hover:border-border-strong"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted" aria-hidden>
                  <IconCalendar width={16} height={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{m.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-subtle">
                    <span>
                      {formatDate(m.scheduled_at, locale)}
                      {t("dateAtTime", { time: formatTime(m.scheduled_at, locale) })}
                    </span>
                    <span>·</span>
                    <span>{t(`mode_${m.mode}`)}</span>
                    <span>·</span>
                    <span>{t("agendaCount", { n: digits(m.agenda.length, locale) })}</span>
                  </span>
                </span>
                <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium ${
                  m.minutes_closed_at !== null ? "bg-success/10 text-success"
                    : m.call_id !== null ? "bg-accent-soft text-accent"
                      : "bg-surface-2 text-fg-muted"
                }`}>
                  {m.minutes_closed_at !== null ? t("stageClosed")
                    : m.call_id !== null ? t("tabReview") : t("stage_pre")}
                </span>
                <button
                  type="button"
                  aria-label={t("rowOptions")}
                  onClick={(e) => { e.stopPropagation(); setMenu((cur) => (cur === m.id ? null : m.id)); }}
                  className="tap grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-subtle hover:text-fg"
                >
                  <IconDots width={14} height={14} />
                </button>
              </div>

              {menu === m.id ? (
                <div className="absolute end-2 top-14 z-40 flex w-48 flex-col rounded-xl border border-border bg-surface p-1 shadow-island">
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      void api.updateMeeting(m.id, { archived: !m.archived })
                        .then(load).catch(refusal);
                    }}
                    className="tap flex h-9 items-center gap-2 rounded-lg px-2.5 text-start text-xs text-fg hover:bg-surface-2"
                  >
                    <IconArchive width={12} height={12} />
                    {m.archived ? t("unarchive") : t("archiveMeeting")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMenu(null); setCondemned(m); }}
                    className="tap flex h-9 items-center gap-2 rounded-lg px-2.5 text-start text-xs text-danger hover:bg-danger/10"
                  >
                    <IconTrash width={12} height={12} />
                    {t("deleteMeeting")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <NewMeetingDialog
          topics={topics}
          onClose={() => setCreating(false)}
          onCreated={(m) => { setCreating(false); router.push(`/meetings/${m.id}`); }}
          onRefused={refusal}
        />
      ) : null}

      {condemned !== null ? (
        <ConfirmDialog
          title={t("deleteMeetingTitle", { title: condemned.title })}
          body={t("deleteMeetingBody")}
          confirmLabel={t("deleteMeeting")}
          cancelLabel={t("cancel")}
          onCancel={() => setCondemned(null)}
          onConfirm={() => {
            const target = condemned;
            setCondemned(null);
            /* 0148 argued this onto the closed DELETE list: a meeting is a
               PLAN, and the record it produced is a different row this
               cannot reach — the schema asserts that, not this file */
            void api.deleteMeeting(target.id).then(load).catch(refusal);
          }}
        />
      ) : null}
    </div>
  );
}

/** the meetings calendar: their month grid, meetings on their days */
function MeetingCalendar({ meetings, locale, onOpen }: {
  meetings: MeetingRecord[];
  locale: string;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("meetings");
  const [offset, setOffset] = useState(0);
  const grid = useMemo(() => monthGridAt(new Date(), locale, offset), [locale, offset]);
  const byDay = new Map<number, MeetingRecord[]>();
  for (const m of meetings) {
    const key = dayKeyOf(m.scheduled_at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(m);
    else byDay.set(key, [m]);
  }
  return (
    <div className="tile flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setOffset(0)}
            className="tap h-8 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-fg hover:border-border-strong">
            {t("today")}
          </button>
          <button type="button" aria-label={t("prev")} onClick={() => setOffset((v) => v - 1)}
            className="tap grid h-8 w-8 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rotate-180 rtl:rotate-0" />
          </button>
          <span className="px-1 text-sm font-semibold text-fg">{grid.title}</span>
          <button type="button" aria-label={t("next")} onClick={() => setOffset((v) => v + 1)}
            className="tap grid h-8 w-8 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg">
            <IconChevronRight width={12} height={12} className="rtl:rotate-180" />
          </button>
        </div>
      </div>
      <ul className="grid grid-cols-7 gap-1.5 pb-1">
        {grid.weekdays.map((day, i) => (
          <li key={i} className="text-center text-[10px] text-fg-subtle">{day}</li>
        ))}
      </ul>
      <ul className="scroll-quiet grid min-h-0 flex-1 grid-cols-7 gap-1.5 overflow-y-auto">
        {grid.cells.map((cell) => (
          <li key={cell.key}
            className={`flex min-h-24 flex-col rounded-xl border p-1.5 ${
              cell.today ? "border-accent/40 bg-accent-soft"
                : cell.weekend ? "border-transparent bg-danger/5"
                  : cell.inMonth ? "border-border bg-surface"
                    : "border-transparent bg-surface-2/40"
            }`}>
            <span className={`mb-1 text-xs tabular-nums ${
              cell.today ? "grid h-5 w-5 place-items-center rounded-full bg-accent font-bold text-on-accent"
                : cell.weekend ? "text-danger" : cell.inMonth ? "text-fg" : "text-fg-subtle"
            }`}>
              {cell.label}
            </span>
            <div className="min-h-0 flex-1 space-y-1">
              {(byDay.get(cell.key) ?? []).map((m) => (
                <button key={m.id} type="button" onClick={() => onOpen(m.id)} title={m.title}
                  className="block w-full truncate rounded-md bg-accent-soft px-1.5 py-0.5 text-start text-[10px] leading-4 text-accent">
                  {formatTime(m.scheduled_at, locale)} {m.title}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** the three holding modes, as the reference's picker tiles */
function ModePicker({ value, onChange }: { value: MeetingMode; onChange: (m: MeetingMode) => void }) {
  const t = useTranslations("meetings");
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("fieldMode")}>
      {(["upload", "in_person", "online"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={`tap flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors ${
            value === mode
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-surface text-fg-muted hover:border-border-strong"
          }`}
        >
          {MODE_ICON[mode]}
          {t(`mode_${mode}`)}
        </button>
      ))}
    </div>
  );
}

/** invitee chips: names or addresses as typed, Enter adds, × removes */
export function InviteeInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations("meetings");
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.trim();
    if (name === "" || value.includes(name)) { setDraft(""); return; }
    onChange([...value, name]);
    setDraft("");
  };
  return (
    <div className="rounded-xl border border-border bg-surface p-2 transition-colors focus-within:border-accent">
      {value.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((name) => (
            <span key={name} className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-xs text-fg">
              {name}
              <button
                type="button"
                aria-label={t("removeInvitee", { name })}
                onClick={() => onChange(value.filter((v) => v !== name))}
                className="text-fg-subtle hover:text-danger"
              >
                <IconClose width={12} height={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={t("inviteePlaceholder")}
        className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
    </div>
  );
}

/** agenda rows: title + planned minutes, add and remove */
export function AgendaEditor({ value, onChange }: {
  value: MeetingAgendaItem[]; onChange: (v: MeetingAgendaItem[]) => void;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("");
  const add = () => {
    const clean = title.trim();
    if (clean === "") return;
    const m = minutes.trim() === "" ? null : Number(minutes);
    onChange([...value, { title: clean, minutes: Number.isInteger(m) && m! > 0 ? m : null }]);
    setTitle("");
    setMinutes("");
  };
  return (
    <div className="space-y-1.5">
      {value.map((item, i) => (
        <div key={`${item.title}-${i}`} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{item.title}</span>
          {item.minutes !== null ? (
            <span className="badge-num shrink-0 text-xs text-fg-muted">{t("agendaMinutes", { n: digits(item.minutes, locale) })}</span>
          ) : null}
          <button
            type="button"
            aria-label={t("removeAgendaItem", { title: item.title })}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="shrink-0 text-fg-subtle hover:text-danger"
          >
            <IconTrash width={12} height={12} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={t("agendaTitlePlaceholder")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <input
          value={minutes}
          onChange={(e) => setMinutes(asciiDigits(e.target.value).replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder={t("agendaMinutesPlaceholder")}
          className="h-9 w-20 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <button
          type="button"
          onClick={add}
          className="tap h-9 rounded-lg bg-surface-2 px-3 text-xs font-medium text-fg hover:bg-border"
        >
          {t("add")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

const INPUT = "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent";

/**
 * The reference's create dialog, exactly: title, an optional description,
 * date and time DEFAULTING TO THE CLICK MOMENT (user directive: "the date
 * and time ... should be the date and time of the clicked button"), a topic
 * folder, and the three mode tiles. The agenda and the invitees are NOT
 * here — the subtitle says so, and the meeting's own page owns them.
 */
function NewMeetingDialog({ topics, onClose, onCreated, onRefused }: {
  topics: string[];
  onClose: () => void;
  onCreated: (m: MeetingRecord) => void;
  onRefused: () => void;
}) {
  const t = useTranslations("meetings");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  /* the click moment, captured once at open */
  const [date, setDate] = useState(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  });
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<MeetingMode>("online");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (title.trim() === "" || date === "" || time === "" || busy) return;
    setBusy(true);
    void api.createMeeting({
      title: title.trim(),
      scheduled_at: new Date(`${date}T${time}`).toISOString(),
      mode,
      topic: topic.trim() === "" ? undefined : topic.trim(),
      description: description.trim() === "" ? undefined : description,
    })
      .then(onCreated)
      .catch(() => { setBusy(false); onRefused(); });
  };

  return (
    <Overlay onClose={onClose} label={t("newMeeting")} wide>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{t("newMeeting")}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">{t("newMeetingSubtitle")}</p>
        </div>
        <button type="button" aria-label={t("close")} onClick={onClose}
          className="tap grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border text-fg-subtle hover:text-fg">
          <IconClose width={14} height={14} />
        </button>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 space-y-3 overflow-y-auto pe-1 pt-2">
        <Field label={t("fieldTitleRequired")}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT}
            placeholder={t("titlePlaceholder")} />
        </Field>
        <Field label={t("fieldDescriptionOptional")}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={3} placeholder={t("descriptionPlaceholder")}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("fieldDateRequired")}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("fieldTimeRequired")}>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={INPUT} />
          </Field>
        </div>
        <Field label={t("fieldTopicFolder")}>
          <select
            value={topic}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                const name = window.prompt(t("newTopicPrompt"));
                setTopic(name === null ? "" : name.trim().slice(0, 120));
                return;
              }
              setTopic(e.target.value);
            }}
            className={INPUT}
          >
            <option value="">{t("noTopic")}</option>
            {topics.map((name) => <option key={name} value={name}>{name}</option>)}
            {topic !== "" && !topics.includes(topic) ? <option value={topic}>{topic}</option> : null}
            <option value="__new__">{t("newTopicOption")}</option>
          </select>
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("fieldMode")}</span>
          <ModePicker value={mode} onChange={setMode} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onClose}
          className="tap h-10 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-border">
          {t("cancel")}
        </button>
        <button type="button" onClick={submit} disabled={title.trim() === "" || date === "" || time === "" || busy}
          className="tap flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent shadow-accent disabled:opacity-50">
          <IconPlus width={14} height={14} />
          {t("createMeeting")}
        </button>
      </div>
    </Overlay>
  );
}
