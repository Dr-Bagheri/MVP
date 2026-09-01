"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type {
  Call, CallNote, MeetingAgendaItem, MeetingRecord, SummaryVersion,
  TaskCardRecord, TaskColumnRecord,
} from "@/api/types";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { ConfirmDialog } from "@/components/rowActions";
import { SummaryBody } from "@/components/echo/SummaryBody";
import { Recorder } from "@/components/echo/Recorder";
import { AgendaEditor, InviteeInput, MODE_ICON } from "./Meetings";
import {
  IconCheck, IconMic, IconPlus, IconTrash,
} from "@/components/icons";
import { digits, formatDate, formatDuration, formatTime } from "@/lib/format";

/**
 * THE MEETING'S OWN PAGE (2026-09-01 round — "i want all the option, page
 * by page step by step"): the reference's meeting flow, whole.
 *
 * The top stepper is NAVIGATION over the meeting's three stages — پیش از
 * جلسه (the plan) / برگزاری (the recorder, live on this page) / پس از
 * جلسه — and the post stage carries the reference's own tab set: بازبینی
 * (the staged processing view while the pipeline runs), تسک‌ها (this
 * record's cards on the board), فایل‌ها (the recording's parts), دستیار,
 * یادداشت‌های من (call notes), صورت‌جلسه (the summary).
 *
 * The completion marks are DERIVED from two facts the row carries — is the
 * scheduled time past, and is a record linked — never stored. And the
 * processing steps are the CALL STATUS LADDER wearing the reference's
 * labels: recording→processing→linking→summarizing→ready maps one-to-one
 * onto upload/transcribe/diarize/extract, so the screen cannot disagree
 * with the pipeline about where the work stands.
 */

type Stage = "pre" | "hold" | "post";
type PostTab = "review" | "tasks" | "files" | "assistant" | "notes" | "minutes";

/** the pipeline ladder, in the order the worker walks it */
const LADDER = ["recording", "processing", "linking", "summarizing", "ready"] as const;
const STEP_KEYS = ["upload", "transcribe", "diarize", "extract"] as const;

function ladderIndex(status: string): number {
  const at = (LADDER as readonly string[]).indexOf(status);
  /* an unknown status is a NEWER pipeline, not a broken one (the wire
     deliberately types status as string) — treat it as mid-processing and
     let the raw word show beside the steps */
  return at === -1 ? 1 : at;
}

export function MeetingPage({ id }: { id: string }) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const router = useRouter();

  const [meeting, setMeeting] = useState<MeetingRecord | null | "failed" | "missing">(null);
  /* null = still asking; "gone" = the server answered and the record is not
     readable (deleted, or purged past the SET NULL window) — two different
     nothings, and the first must never wear the second's face */
  const [call, setCall] = useState<Call | null | "gone">(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useCrumbTitle(typeof meeting === "object" && meeting !== null ? meeting.title : undefined);

  const loadMeeting = useCallback(() => {
    void api.meetingDetail(id)
      .then((m) => {
        setMeeting(m);
        setStage((cur) => cur ?? (
          m.call_id !== null ? "post"
            : new Date(m.scheduled_at).getTime() > Date.now() ? "pre" : "hold"));
      })
      .catch((e: unknown) => {
        const status = (e as { status?: number }).status;
        setMeeting(status === 404 ? "missing" : "failed");
      });
  }, [id]);
  useEffect(loadMeeting, [loadMeeting]);

  /* the linked record, POLLED while the pipeline is still walking its
     ladder — the review tab is a live view of the work, per the reference */
  const callId = typeof meeting === "object" && meeting !== null ? meeting.call_id : null;
  useEffect(() => {
    if (callId === null) { setCall(null); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      void api.getCall(callId).then((c) => {
        if (!alive) return;
        setCall(c ?? "gone");
        if (c !== null && c.status !== "ready" && c.status !== "failed") {
          timer = setTimeout(read, 5000);
        }
      }).catch(() => {
        /* a transient failure must not end the watch — one dropped request
           would freeze the processing screen mid-ladder until a reload */
        if (alive) timer = setTimeout(read, 5000);
      });
    };
    read();
    return () => { alive = false; if (timer !== null) clearTimeout(timer); };
  }, [callId]);

  if (meeting === null) return <p className="p-6 text-sm text-fg-muted">…</p>;
  if (meeting === "missing") return <p className="p-6 text-sm text-fg-muted">{t("notFound")}</p>;
  if (meeting === "failed") return <p className="p-6 text-sm text-fg-muted">{t("readFailed")}</p>;

  const active: Stage = stage ?? "pre";
  const held = meeting.call_id !== null;
  const timePast = new Date(meeting.scheduled_at).getTime() <= Date.now();

  const patch = (body: Record<string, unknown>) => {
    void api.updateMeeting(meeting.id, body)
      .then((m) => setMeeting(m))
      .catch(() => setError(t("writeFailed")));
  };

  const stepTab = (s: Stage, label: string, done: boolean, badge?: number) => (
    <button
      key={s}
      type="button"
      aria-current={active === s ? "step" : undefined}
      onClick={() => setStage(s)}
      className={`tap flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-colors ${
        active === s ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"
      }`}
    >
      {done ? (
        <span className={`grid h-4 w-4 place-items-center rounded-full ${active === s ? "bg-bg/20 text-bg" : "bg-accent-soft text-accent"}`} aria-hidden>
          <IconCheck width={12} height={12} />
        </span>
      ) : null}
      {label}
      {badge !== undefined && badge > 0 ? (
        <span className={`badge-num rounded-full px-1.5 text-[10px] ${active === s ? "bg-bg/20" : "bg-accent-soft text-accent"}`}>
          {digits(badge, locale)}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ── head: identity + the stage stepper ───────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-fg">{meeting.title}</h1>
          <p className="mt-0.5 text-xs text-fg-muted">
            {formatDate(meeting.scheduled_at, locale)}
            {" · "}
            <span className="badge-num">{formatTime(meeting.scheduled_at, locale)}</span>
            {meeting.duration_minutes !== null
              ? ` · ${t("durationShort", { n: digits(meeting.duration_minutes, locale) })}` : ""}
            {" · "}
            {t(`mode_${meeting.mode}`)}
            {meeting.topic !== null ? ` · ${meeting.topic}` : ""}
          </p>
        </div>
        <nav aria-label={t("stages")} className="flex items-center gap-0.5 rounded-2xl border border-border bg-surface p-1">
          {stepTab("pre", t("stage_pre"), timePast || held)}
          {stepTab("hold", t("stage_hold"), held)}
          {stepTab("post", t("stage_post"), held && typeof call === "object" && call?.status === "ready")}
        </nav>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {active === "pre" ? <PreStage meeting={meeting} onPatch={patch} locale={locale} /> : null}
      {active === "hold" ? (
        <HoldStage meeting={meeting} onFinished={() => { loadMeeting(); setStage("post"); }} />
      ) : null}
      {active === "post" ? (
        <PostStage
          meeting={meeting}
          call={call}
          locale={locale}
          onGoHold={() => setStage("hold")}
          onOpenRecord={() => router.push(`/calls/${meeting.call_id}`)}
        />
      ) : null}
    </div>
  );
}

/* ── پیش از جلسه: the plan, editable where the plan lives ─────────────── */
function PreStage({ meeting, onPatch, locale }: {
  meeting: MeetingRecord;
  onPatch: (body: Record<string, unknown>) => void;
  locale: string;
}) {
  const t = useTranslations("meetings");
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <section className="tile p-4" aria-label={t("fieldAgenda")}>
          <h2 className="mb-2 text-sm font-semibold text-fg">{t("fieldAgenda")}</h2>
          <AgendaEditor
            value={meeting.agenda}
            onChange={(agenda: MeetingAgendaItem[]) => onPatch({ agenda })}
          />
        </section>
        {meeting.description.trim() !== "" ? (
          <section className="tile p-4" aria-label={t("fieldDescription")}>
            <h2 className="mb-2 text-sm font-semibold text-fg">{t("fieldDescription")}</h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-fg">{meeting.description}</p>
          </section>
        ) : null}
      </div>
      <div className="space-y-4">
        <section className="tile p-4" aria-label={t("detailsTitle")}>
          <h2 className="mb-2 text-sm font-semibold text-fg">{t("detailsTitle")}</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">{t("fieldDate")}</dt>
              <dd className="text-fg">{formatDate(meeting.scheduled_at, locale)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">{t("fieldTime")}</dt>
              <dd className="badge-num text-fg">{formatTime(meeting.scheduled_at, locale)}</dd>
            </div>
            {meeting.duration_minutes !== null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-fg-muted">{t("fieldDuration")}</dt>
                <dd className="text-fg">{t("durationShort", { n: digits(meeting.duration_minutes, locale) })}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">{t("fieldMode")}</dt>
              <dd className="text-fg">{t(`mode_${meeting.mode}`)}</dd>
            </div>
            {meeting.location !== null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-fg-muted">{t("fieldLocation")}</dt>
                <dd className="text-fg">{meeting.location}</dd>
              </div>
            ) : null}
          </dl>
        </section>
        <section className="tile p-4" aria-label={t("fieldInvitees")}>
          <h2 className="mb-2 text-sm font-semibold text-fg">{t("fieldInvitees")}</h2>
          <InviteeInput
            value={meeting.invitees}
            onChange={(invitees: string[]) => onPatch({ invitees })}
          />
        </section>
      </div>
    </div>
  );
}

/* ── برگزاری: the recorder itself, adopted to this meeting ────────────── */
function HoldStage({ meeting, onFinished }: {
  meeting: MeetingRecord;
  onFinished: () => void;
}) {
  const t = useTranslations("meetings");
  return (
    <div className="space-y-3">
      {meeting.mode === "upload" ? (
        <p className="rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-xs text-fg-muted">
          {t("uploadHint")}
        </p>
      ) : null}
      <Recorder
        meeting={{ id: meeting.id, mode: meeting.mode, title: meeting.title }}
        onFinished={onFinished}
      />
    </div>
  );
}

/* ── پس از جلسه: the reference's tab set ──────────────────────────────── */
function PostStage({ meeting, call, locale, onGoHold, onOpenRecord }: {
  meeting: MeetingRecord;
  call: Call | null | "gone";
  locale: string;
  onGoHold: () => void;
  onOpenRecord: () => void;
}) {
  const t = useTranslations("meetings");
  const [tab, setTab] = useState<PostTab>("review");

  if (meeting.call_id === null) {
    return (
      <div className="tile grid place-items-center p-10 text-center">
        <IconMic width={24} height={24} />
        <p className="mt-2 text-sm text-fg-muted">{t("noRecordYet")}</p>
        <button
          type="button"
          onClick={onGoHold}
          className="tap mt-3 flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent"
        >
          {MODE_ICON[meeting.mode]}
          {meeting.mode === "upload" ? t("startUpload") : t("startMeeting")}
        </button>
      </div>
    );
  }

  const tabs: Array<{ key: PostTab; label: string }> = [
    { key: "review", label: t("tabReview") },
    { key: "tasks", label: t("tabTasks") },
    { key: "files", label: t("tabFiles") },
    { key: "assistant", label: t("tabAssistant") },
    { key: "notes", label: t("tabNotes") },
    { key: "minutes", label: t("tabMinutes") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="tablist" aria-label={t("stage_post")} className="flex flex-wrap items-center gap-1 border-b border-border">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={`tap -mb-px h-10 border-b-2 px-3.5 text-xs font-medium transition-colors ${
              tab === entry.key
                ? "border-accent text-accent"
                : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "review" ? (
        <ReviewTab call={call} title={meeting.title} locale={locale} onOpenRecord={onOpenRecord} />
      ) : null}
      {tab === "tasks" ? <TasksTab callId={meeting.call_id} callTitle={typeof call === "object" && call !== null ? call.title : meeting.title} /> : null}
      {tab === "files" ? <FilesTab call={call} locale={locale} /> : null}
      {tab === "assistant" ? <AssistantTab /> : null}
      {tab === "notes" ? <NotesTab callId={meeting.call_id} locale={locale} /> : null}
      {tab === "minutes" ? <MinutesTab callId={meeting.call_id} locale={locale} /> : null}
    </div>
  );
}

/* ── بازبینی: the staged processing view — the pipeline's ladder wearing
      the reference's labels — then the finished record ─────────────────── */
function ReviewTab({ call, title, locale, onOpenRecord }: {
  call: Call | null | "gone";
  title: string;
  locale: string;
  onOpenRecord: () => void;
}) {
  const t = useTranslations("meetings");
  if (call === null) return <p className="p-4 text-sm text-fg-muted">…</p>;
  if (call === "gone") return <p className="p-4 text-sm text-fg-muted">{t("recordGone")}</p>;

  if (call.status === "failed") {
    return (
      <div className="tile grid place-items-center p-10 text-center">
        <p className="text-sm text-danger">{t("processingFailed")}</p>
        <button type="button" onClick={onOpenRecord}
          className="tap mt-3 h-9 rounded-lg bg-surface-2 px-4 text-xs font-medium text-fg hover:bg-border">
          {t("openRecord")}
        </button>
      </div>
    );
  }

  if (call.status === "ready") {
    return (
      <div className="tile mx-auto w-full max-w-xl p-6 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <IconCheck width={24} height={24} />
        </span>
        <h2 className="mt-3 text-base font-bold text-fg">{t("processingDoneTitle")}</h2>
        <p className="mt-1 text-xs text-fg-muted">{t("processingDoneBody")}</p>
        <button
          type="button"
          onClick={onOpenRecord}
          className="tap mx-auto mt-4 flex h-10 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-on-accent shadow-accent hover:opacity-90"
        >
          {t("openRecord")}
        </button>
      </div>
    );
  }

  /* mid-pipeline: the reference's processing card */
  const at = ladderIndex(call.status);
  const known = (LADDER as readonly string[]).includes(call.status);
  return (
    <div className="tile mx-auto w-full max-w-xl p-6">
      <div className="text-center">
        <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-accent/30" aria-hidden>
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />
          <IconMic width={24} height={24} className="text-accent" />
        </span>
        <h2 className="mt-3 text-base font-bold text-fg">{t("processingTitle")}</h2>
        <p className="mt-1 text-xs text-fg-muted">
          {title} — {t("processingSubtitle")}
          {!known ? ` (${call.status})` : ""}
        </p>
      </div>

      <ol className="mt-5 space-y-2">
        {STEP_KEYS.map((key, i) => {
          const state: "done" | "active" | "pending" = at > i ? "done" : at === i ? "active" : "pending";
          return (
            <li
              key={key}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                state === "active" ? "bg-accent-soft" : ""
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${
                  state === "done"
                    ? "bg-accent text-on-accent"
                    : state === "active"
                      ? "border-2 border-accent text-accent"
                      : "border border-border text-fg-subtle"
                }`}
                aria-hidden
              >
                {state === "done" ? <IconCheck width={12} height={12} /> : digits(i + 1, locale)}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${state === "pending" ? "text-fg-subtle" : "text-fg"}`}>
                  {t(`step_${key}`)}
                </span>
                <span className="block text-[11px] text-fg-muted">{t(`step_${key}_sub`)}</span>
              </span>
              {state === "done" ? (
                <span className="shrink-0 text-[11px] text-accent">{t("stepDone")}</span>
              ) : state === "active" ? (
                <span className="shrink-0 text-[11px] text-accent">{t("stepActive")}</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div
          className="h-full rounded-full bg-accent transition-all duration-700"
          style={{ width: `${Math.round(((at + 0.5) / STEP_KEYS.length) * 100)}%` }}
        />
      </div>
      <p className="mt-3 text-center text-[11px] leading-5 text-fg-subtle">{t("processingNote")}</p>
    </div>
  );
}

/* ── تسک‌ها: this record's cards on the shared board ──────────────────── */
function TasksTab({ callId, callTitle }: { callId: string; callTitle: string }) {
  const t = useTranslations("meetings");
  const tTasks = useTranslations("tasks");
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

  const rows = board.tasks.filter((task) => task.call_id === callId);
  const firstColumn = board.columns[0];

  const add = () => {
    const title = draft.trim();
    if (title === "" || firstColumn === undefined) return;
    setWriteError(false);
    void api.createTask({ title, column_id: firstColumn.id, call_id: callId })
      .then(() => { setDraft(""); load(); })
      .catch(() => setWriteError(true));
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      {rows.length === 0 ? (
        <p className="p-2 text-sm text-fg-muted">{t("noMeetingTasks", { title: callTitle })}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((task) => (
            <li key={task.id}>
              <Link
                href={`/tasks?task=${task.id}`}
                className="tile flex items-center gap-3 p-3 transition-colors hover:border-border-strong"
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                    task.done ? "border-accent bg-accent text-on-accent" : "border-border"
                  }`}
                  aria-hidden
                >
                  {task.done ? <IconCheck width={12} height={12} /> : null}
                </span>
                <span className={`min-w-0 flex-1 truncate text-sm ${task.done ? "text-fg-subtle line-through" : "text-fg"}`}>
                  {task.title}
                </span>
                <span className="shrink-0 text-[11px] text-fg-subtle">{tTasks(`priority_${task.priority}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
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
        <button
          type="button"
          onClick={add}
          disabled={draft.trim() === "" || firstColumn === undefined}
          className="tap flex h-10 items-center gap-1.5 rounded-xl bg-surface-2 px-3.5 text-xs font-medium text-fg hover:bg-border disabled:opacity-50"
        >
          <IconPlus width={12} height={12} />
          {tTasks("add")}
        </button>
      </div>
    </div>
  );
}

/* ── فایل‌ها: the recording's parts — the meeting's real files ────────── */
function FilesTab({ call, locale }: { call: Call | null | "gone"; locale: string }) {
  const t = useTranslations("meetings");
  if (call === null) return <p className="p-4 text-sm text-fg-muted">…</p>;
  if (call === "gone") return <p className="p-4 text-sm text-fg-muted">{t("recordGone")}</p>;
  const parts = call.parts ?? [];
  if (parts.length === 0) return <p className="p-4 text-sm text-fg-muted">{t("noFiles")}</p>;
  return (
    <ul className="mx-auto w-full max-w-2xl space-y-2">
      {[...parts].sort((a, b) => a.idx - b.idx).map((part) => (
        <li key={part.id} className="tile flex items-center gap-3 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
            <IconMic width={14} height={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-fg">{t("filePart", { n: digits(part.idx + 1, locale) })}</span>
            <span className="block text-[11px] text-fg-muted">
              {part.missing
                ? t("fileMissing")
                : part.duration_ms !== null
                  ? formatDuration(Math.round(part.duration_ms / 1000), locale)
                  : t("fileDurationUnknown")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── دستیار: the door to the assistant, with this meeting in hand ─────── */
function AssistantTab() {
  const t = useTranslations("meetings");
  return (
    <div className="tile mx-auto w-full max-w-xl p-6 text-center">
      <p className="text-sm leading-6 text-fg-muted">{t("assistantHint")}</p>
      <Link
        href="/assistant"
        className="tap mx-auto mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-on-accent shadow-accent hover:opacity-90"
      >
        {t("openAssistant")}
      </Link>
    </div>
  );
}

/* ── یادداشت‌های من: call notes — annotations, never the record ───────── */
function NotesTab({ callId, locale }: { callId: string; locale: string }) {
  const t = useTranslations("meetings");
  const [notes, setNotes] = useState<CallNote[] | null | "failed">(null);
  const [draft, setDraft] = useState("");
  const [writeError, setWriteError] = useState(false);
  const [condemned, setCondemned] = useState<CallNote | null>(null);

  const load = useCallback(() => {
    void api.callNotes(callId).then(setNotes).catch(() => setNotes("failed"));
  }, [callId]);
  useEffect(load, [load]);

  const add = () => {
    const body = draft.trim();
    if (body === "") return;
    setWriteError(false);
    /* the draft clears on SUCCESS — a refused write must hand the typed
       text back, not destroy it in silence */
    void api.addCallNote(callId, { kind: "note", body })
      .then(() => { setDraft(""); load(); })
      .catch(() => setWriteError(true));
  };

  if (notes === null) return <p className="p-4 text-sm text-fg-muted">…</p>;
  if (notes === "failed") return <p className="p-4 text-sm text-fg-muted">{t("readFailed")}</p>;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      {notes.length === 0 ? (
        <p className="p-2 text-sm text-fg-muted">{t("noNotes")}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="tile flex items-start gap-3 p-3">
              <span className="min-w-0 flex-1">
                <span className="block whitespace-pre-wrap text-sm leading-6 text-fg">{note.body}</span>
                <span className="mt-1 block text-[11px] text-fg-subtle">
                  {formatDate(note.created_at, locale)}
                  {note.at_ms !== null ? ` · ${formatDuration(Math.round(note.at_ms / 1000), locale)}` : ""}
                </span>
              </span>
              <button
                type="button"
                aria-label={t("deleteNote")}
                onClick={() => setCondemned(note)}
                className="shrink-0 text-fg-subtle hover:text-danger"
              >
                <IconTrash width={12} height={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {writeError ? (
        <p role="alert" className="text-xs text-danger">{t("writeFailed")}</p>
      ) : null}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={t("notePlaceholder")}
          className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <button
          type="button"
          onClick={add}
          disabled={draft.trim() === ""}
          className="tap h-10 rounded-xl bg-surface-2 px-3.5 text-xs font-medium text-fg hover:bg-border disabled:opacity-50"
        >
          {t("addNote")}
        </button>
      </div>
      {condemned !== null ? (
        <ConfirmDialog
          title={t("deleteNoteTitle")}
          body={t("deleteNoteBody")}
          confirmLabel={t("deleteNote")}
          cancelLabel={t("cancel")}
          onCancel={() => setCondemned(null)}
          onConfirm={() => {
            const target = condemned;
            setCondemned(null);
            void api.deleteCallNote(target.id).then(load).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── صورت‌جلسه: the summary, current version rendered whole ───────────── */
function MinutesTab({ callId, locale }: { callId: string; locale: string }) {
  const t = useTranslations("meetings");
  const [versions, setVersions] = useState<SummaryVersion[] | null | "failed">(null);

  useEffect(() => {
    let alive = true;
    void api.getSummaries(callId)
      .then((v) => { if (alive) setVersions(v); })
      .catch(() => { if (alive) setVersions("failed"); });
    return () => { alive = false; };
  }, [callId]);

  if (versions === null) return <p className="p-4 text-sm text-fg-muted">…</p>;
  if (versions === "failed") return <p className="p-4 text-sm text-fg-muted">{t("readFailed")}</p>;
  const current = versions[0];
  if (current === undefined) return <p className="p-4 text-sm text-fg-muted">{t("noMinutesYet")}</p>;

  return (
    <article className="tile mx-auto w-full max-w-2xl p-5">
      <header className="mb-3 flex items-baseline justify-between gap-2 border-b border-border pb-2">
        <span className="text-xs text-fg-muted">
          {t("minutesVersion", { n: digits(current.version, locale) })}
        </span>
        <span className="text-[11px] text-fg-subtle">{formatDate(current.created_at, locale)}</span>
      </header>
      <div className="text-sm leading-7 text-fg">
        <SummaryBody text={current.body} />
      </div>
    </article>
  );
}
