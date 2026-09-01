"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { MeetingAgendaItem, MeetingMode, MeetingRecord } from "@/api/types";
import { Overlay } from "./Overlay";
import {
  IconCalendar, IconClose, IconMic, IconPlus, IconTrash, IconUpload, IconVideo,
} from "@/components/icons";
import { asciiDigits, digits, formatDate, formatTime } from "@/lib/format";

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
  const [rows, setRows] = useState<MeetingRecord[] | null | "failed">(null);
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.meetings().then(setRows).catch(() => setRows("failed"));
  }, []);
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

  const { upcoming, past } = useMemo(() => {
    if (!Array.isArray(rows)) return { upcoming: [], past: [] };
    const now = Date.now();
    const ahead: MeetingRecord[] = [];
    const gone: MeetingRecord[] = [];
    for (const m of rows) {
      (new Date(m.scheduled_at).getTime() >= now && m.call_id === null ? ahead : gone).push(m);
    }
    // the list arrives ascending; the past reads newest-first
    gone.reverse();
    return { upcoming: ahead, past: gone };
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-fg">{t("title")}</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="tap flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent shadow-accent transition-opacity hover:opacity-90"
        >
          <IconPlus width={16} height={16} />
          {t("newMeeting")}
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
      ) : rows.length === 0 ? (
        <div className="tile grid place-items-center p-10 text-center">
          <IconCalendar width={24} height={24} />
          <p className="mt-2 text-sm text-fg-muted">{t("empty")}</p>
        </div>
      ) : (
        <>
          <MeetingGroup label={t("groupUpcoming")} rows={upcoming} emptyLabel={t("noUpcoming")}
            locale={locale} onOpen={(m) => router.push(`/meetings/${m.id}`)} />
          <MeetingGroup label={t("groupPast")} rows={past} emptyLabel={null}
            locale={locale} onOpen={(m) => router.push(`/meetings/${m.id}`)} />
        </>
      )}

      {creating ? (
        <NewMeetingDialog
          topics={Array.isArray(rows)
            ? [...new Set(rows.map((m) => m.topic).filter((x): x is string => x !== null))]
            : []}
          onClose={() => setCreating(false)}
          onCreated={(m) => { setCreating(false); router.push(`/meetings/${m.id}`); }}
          onRefused={refusal}
        />
      ) : null}
    </div>
  );
}

function MeetingGroup({ label, rows, emptyLabel, locale, onOpen }: {
  label: string; rows: MeetingRecord[]; emptyLabel: string | null;
  locale: string; onOpen: (m: MeetingRecord) => void;
}) {
  const t = useTranslations("meetings");
  if (rows.length === 0 && emptyLabel === null) return null;
  return (
    <section aria-label={label}>
      <h2 className="mb-2 text-sm font-semibold text-fg-muted">{label}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-subtle">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onOpen(m)}
                className="tile flex w-full items-center gap-3 p-3.5 text-start transition-colors hover:border-border-strong"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden>
                  {MODE_ICON[m.mode]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{m.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                    <span>{formatDate(m.scheduled_at, locale)}</span>
                    <span className="badge-num">{formatTime(m.scheduled_at, locale)}</span>
                    {m.duration_minutes !== null ? (
                      <span>{t("durationShort", { n: digits(m.duration_minutes, locale) })}</span>
                    ) : null}
                    {m.topic !== null ? (
                      <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{m.topic}</span>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 rounded-lg bg-surface-2 px-2 py-1 text-[11px] font-medium text-fg-muted">
                  {t(`mode_${m.mode}`)}
                </span>
                {m.call_id !== null ? (
                  <span className="shrink-0 rounded-lg bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent">
                    {t("hasRecord")}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
