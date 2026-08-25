"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import {
  addChapterMark,
  discardRecording,
  finish,
  pause,
  recorderSnapshot,
  resetRecorder,
  resume,
  retryUploads,
  startRecording,
  subscribeRecorder,
  type RecorderErrorCode,
} from "@/lib/recordingEngine";
import { notify } from "@/lib/notify";
import { speakQueued } from "@/lib/voice";
import { Card, Chip, Field } from "@/components/ui";
import { Link } from "@/i18n/routing";
import { digits, formatClock } from "@/lib/format";
import { resumePoint } from "./uploadRules";
import { RecorderNotes } from "./RecorderNotes";
import { SelectMenu } from "@/components/rowActions";
import { DeviceCheck } from "./DeviceCheck";
import { customTemplates, type CustomTemplate } from "@/lib/summaryTemplates";
import { SUMMARY_TEMPLATES, type SummaryTemplate } from "@echo/core/vocabulary";

/** ruled key → its label's message key (typed against the producer's union) */
const TEMPLATE_KEY: Record<SummaryTemplate, "tplBoard" | "tplGroup" | "tplTeam" | "tplItTeam" | "tplInterview"> = {
  board: "tplBoard",
  group: "tplGroup",
  team: "tplTeam",
  it_team: "tplItTeam",
  interview: "tplInterview",
};

/**
 * The browser recorder — a VIEW over the module-level recording engine
 * (lib/recordingEngine.ts). Everything that must survive navigation — the
 * stream, the recorders, the uploader, the crash buffer, the clock — lives
 * in the engine; this component renders its snapshot and owns only the
 * START FORM (device pickers, title, language, source, resume adoption).
 * Navigating away leaves the take rolling; the floating pill
 * (FloatingRecorder) keeps it visible and controllable everywhere.
 *
 * The recording behaviour itself is documented on the engine: one
 * continuous take (30-minute rule retired 2026-08-22), silent byte-ceiling
 * rolls, crash-proof IndexedDB buffer, tab/system audio mixing, waveform +
 * quality watch, M38 captions, M33 agent controls.
 */

interface DeviceOption {
  id: string;
  label: string;
}

export function Recorder({ onFinished }: { onFinished?: () => void }) {
  const t = useTranslations("capture");
  const locale = useLocale();

  const s = useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot);
  const phase = s.phase;

  const [title, setTitle] = useState("");
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [speakers, setSpeakers] = useState<DeviceOption[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [speakerId, setSpeakerId] = useState<string>("");
  /** Language hint for the transcriber. 'mixed' preserves the historical
   *  both-languages hint; narrowing is an explicit act. */
  const [language, setLanguage] = useState<"fa" | "en" | "mixed">("mixed");
  const [source, setSource] = useState<"mic" | "system">("mic");
  /** 0094: the summary's template, chosen before the take — "" = none,
      a ruled key, or "custom:<name>" from the local template store */
  const [template, setTemplate] = useState<string>("");
  const [customs, setCustoms] = useState<CustomTemplate[]>([]);
  useEffect(() => { setCustoms(customTemplates()); }, []);
  /** the red stop-and-delete asks AGAIN before acting (user directive) */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** loudness enhance: a gain stage between the mic and the recorder */
  const [boost, setBoost] = useState(false);
  /** the CHECK's own monitoring gain — how loud the meter reads, so a
      far mic can be judged before the take (it does not change the take) */
  const [monitorGain, setMonitorGain] = useState(1);
  /** speak «این جلسه ضبط می‌شود» into the room — and into the record */
  const [announceOn, setAnnounceOn] = useState(false);
  /**
   * RESUME mode: `?resume=<id>` — the call continues on the same id, next
   * part index, offset where the audio ends. `null` = fresh; "loading"
   * while fetched; "gone" when it can no longer be resumed.
   */
  const [resumeTarget, setResumeTarget] = useState<
    | null
    | "loading"
    | "gone"
    | { callId: string; title: string | null; nextIdx: number; offsetMs: number }
  >(null);

  const previewEl = useRef<HTMLAudioElement>(null);

  /** Errors come from the engine as CODES; the view speaks the language. */
  const errorText = (code: RecorderErrorCode | null): string | null =>
    code === null ? null : t(code);

  // onFinished fires on the transition into done — refresh the caller's list
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (phase === "done" && prevPhase.current !== "done") onFinished?.();
    prevPhase.current = phase;
  }, [phase, onFinished]);

  /** Refresh the device lists. Before a grant, labels are blank by the
   *  browser's privacy rule — the picker names them generically then. */
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const name = (d: MediaDeviceInfo, i: number, fallback: string) =>
      d.label || `${fallback} ${i + 1}`;
    setMics(
      all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({ id: d.deviceId, label: name(d, i, t("micFallback")) })),
    );
    setSpeakers(
      all
        .filter((d) => d.kind === "audiooutput")
        .map((d, i) => ({ id: d.deviceId, label: name(d, i, t("speakerFallback")) })),
    );
  }, [t]);

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  function start(titleOverride?: string): void {
    const resume = typeof resumeTarget === "object" && resumeTarget !== null
      ? resumeTarget
      : null;
    /* the template choice resolves here: ruled key rides as-is; a custom
       choice sends its NAME + prompt (createCall's 0094 contract) */
    const custom = template.startsWith("custom:")
      ? customs.find((c) => `custom:${c.name}` === template)
      : undefined;
    void startRecording({
      micId,
      language,
      source,
      title: titleOverride ?? title,
      locale,
      resume,
      ...(custom
        ? { summaryTemplate: custom.name, summaryInstruction: custom.prompt }
        : template
          ? { summaryTemplate: template }
          : {}),
      boost,
    }).then(() => {
      void refreshDevices(); // labels exist once permission does
      /* consent announcement (user Persian-moat item, 2026-08-23): spoken
         AFTER the take starts, so the announcement itself lands IN the
         recording — an announcement outside the record proves nothing */
      if (announceOn && recorderSnapshot().phase === "recording") {
        speakQueued(t("announceLine"));
      }
    });
  }

  /**
   * M33: `?agentStart=<title>` — the agent's start_recording lands here and
   * the recorder starts through the SAME path the button uses. Once only:
   * StrictMode double-fires effects in dev.
   */
  const agentStarted = useRef(false);
  useEffect(() => {
    if (agentStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    const agentTitle = params.get("agentStart");
    if (agentTitle === null || params.get("resume")) return;
    agentStarted.current = true;
    setTitle(agentTitle);
    // the title rides as an argument — this render's `title` is still empty
    start(agentTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot adoption
  }, []);

  /**
   * Adopt the resume target from the URL. `location.search` in an effect,
   * deliberately NOT `useSearchParams()` — that hook forced a prerender
   * bailout that broke the production build once already. Only a call still
   * in `recording` status is resumable.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("resume");
    if (!id) return;
    setResumeTarget("loading");
    void api
      .getCall(id)
      .then((call) => {
        // null and non-recording are one answer here: nothing to resume
        if (!call || call.status !== "recording") {
          setResumeTarget("gone");
          return;
        }
        const { nextIdx, offsetMs } = resumePoint(call.parts ?? []);
        setResumeTarget({ callId: call.id, title: call.title, nextIdx, offsetMs });
        setTitle(call.title ?? "");
      })
      .catch(() => setResumeTarget("gone"));
  }, []);

  // the preview element follows the chosen output device (setSinkId is the
  // one place a speaker choice has meaning in a recorder)
  useEffect(() => {
    const el = previewEl.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && speakerId) void el.setSinkId(speakerId).catch(() => undefined);
  }, [speakerId, s.previews]);

  const live = phase === "recording" || phase === "paused";
  const recordedSec = Math.floor(s.recordedMs / 1000);
  const resuming = typeof resumeTarget === "object" && resumeTarget !== null;

  if (resumeTarget === "loading") {
    return (
      <Card>
        <p className="text-sm text-fg-muted">{t("resumeLoading")}</p>
      </Card>
    );
  }
  if (resumeTarget === "gone") {
    return (
      <Card>
        <p className="text-sm text-fg-muted">{t("resumeGone")}</p>
        <Link href="/echo/records" className="btn-secondary mt-4 inline-flex px-4">
          {t("resumeBackToCalls")}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      {phase === "idle" || phase === "starting" ? (
        <>
          {resuming ? (
            /* the resume banner: WHICH take, and how much of it exists —
               the person is re-checking devices, not starting a new call */
            <p
              role="status"
              className="mb-4 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2 text-sm leading-6 text-fg"
            >
              {t("resumeBanner", {
                title: resumeTarget.title ?? t("untitledCall"),
                clock: formatClock(Math.floor(resumeTarget.offsetMs / 1000), locale),
              })}
            </p>
          ) : null}
          {/* the TITLE field left the form (user directive, 2026-08-25): the
              engine names an untitled take («جلسه ۳» — nextMeetingTitle), and
              renaming is one pencil away on the record. `title` state stays:
              the agent's start_recording can still carry a name, and a
              resumed take keeps the one it already has. */}
          {/* the settings no longer HIDE (user directive, 2026-08-25): the
              disclosure saved four rows and cost people the one check that
              prevents a silent recording — everything is visible now */}
          <p className="mb-2 mt-1 text-xs font-medium text-fg-subtle">{t("recordSettings")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* the platform dropdown (2026-08-25): every select is the
                kebab-styled SelectMenu now — no native option lists */}
            <Field label={t("micField")}>
              <SelectMenu
                ariaLabel={t("micField")}
                value={micId}
                onChange={setMicId}
                options={
                  mics.length === 0
                    ? [{ value: "", label: t("micDefault") }]
                    : mics.map((d) => ({ value: d.id, label: d.label }))
                }
              />
            </Field>
            <Field label={t("speakerField")}>
              <SelectMenu
                ariaLabel={t("speakerField")}
                value={speakerId}
                onChange={setSpeakerId}
                options={
                  speakers.length === 0
                    ? [{ value: "", label: t("speakerDefault") }]
                    : speakers.map((d) => ({ value: d.id, label: d.label }))
                }
              />
            </Field>
            <Field label={t("languageField")}>
              {/* the transcriber's hint — set at creation */}
              <SelectMenu
                ariaLabel={t("languageField")}
                value={language}
                onChange={(v) => setLanguage(v as "fa" | "en" | "mixed")}
                disabled={resuming}
                options={[
                  { value: "mixed", label: t("languageMixed") },
                  { value: "fa", label: t("languageFa") },
                  { value: "en", label: t("languageEn") },
                ]}
              />
            </Field>
            <Field label={t("sourceField")}>
              <SelectMenu
                ariaLabel={t("sourceField")}
                value={source}
                onChange={(v) => setSource(v as "mic" | "system")}
                options={[
                  { value: "mic", label: t("sourceMic") },
                  { value: "system", label: t("sourceSystem") },
                ]}
              />
            </Field>
            <Field label={t("templateField")}>
              {/* 0094: the summary's SHAPE chosen before the meeting — the
                  ruled five plus this person's own templates */}
              <SelectMenu
                ariaLabel={t("templateField")}
                value={template}
                onChange={setTemplate}
                disabled={resuming}
                options={[
                  { value: "", label: t("templateNone") },
                  ...SUMMARY_TEMPLATES.map((k) => ({ value: k, label: t(TEMPLATE_KEY[k]) })),
                  ...customs.map((c) => ({ value: `custom:${c.name}`, label: c.name })),
                ]}
              />
            </Field>
          </div>
          {/* hear yourself BEFORE the meeting, not after it (2026-08-25) */}
          <div className="mt-3">
            <DeviceCheck
              micId={micId}
              speakerId={speakerId}
              boost={boost}
              onBoostChange={setBoost}
              gain={monitorGain}
              onGainChange={setMonitorGain}
            />
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={announceOn}
              onChange={(e) => setAnnounceOn(e.target.checked)}
            />
            {t("announceOption")}
          </label>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              className="btn-primary h-12 px-6"
              disabled={phase === "starting"}
              onClick={() => start()}
            >
              {phase === "starting" ? t("starting") : resuming ? t("resumeStart") : t("start")}
            </button>
            {/* instant voice memo (user directive, 2026-08-23): one tap, no
                form — records through the same pipeline with a self-naming
                title, for the thought that won't wait for a form */}
            {!resuming ? (
              <button
                className="btn-secondary h-12 px-6"
                disabled={phase === "starting"}
                onClick={() => {
                  const at = new Intl.DateTimeFormat(
                    locale === "fa" ? "fa-IR" : "en-GB",
                    { hour: "2-digit", minute: "2-digit" },
                  ).format(new Date());
                  void startRecording({
                    micId,
                    language: "mixed",
                    source: "mic",
                    title: `${t("memoTitle")} ${at}`,
                    locale,
                    resume: null,
                  });
                }}
              >
                {t("quickMemo")}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {live || phase === "finishing" ? (
        /* the pad rides BESIDE the take on wide screens, under it on small —
           a thought lands in the pad instead of interrupting the meeting */
        <div className="gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <div className="flex items-center gap-4">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                phase === "recording" ? "animate-pulse bg-danger" : "bg-fg-subtle"
              }`}
              aria-hidden
            />
            <span className="text-sm font-medium text-fg">
              {phase === "paused"
                ? t("pausedState")
                : phase === "finishing"
                  ? t("finishing")
                  : t("recordingState")}
            </span>
            <span className="ltr ms-auto text-sm text-fg-muted">
              {formatClock(recordedSec, locale)}
            </span>
          </div>

          {/* live input-level meter — an LED-segment strip (user directive,
              2026-08-23: "technical and stronger but more compact"): fixed
              thin segments that LIGHT left-to-right with the signal, the
              last stretch in the warning tone — the professional-console
              anatomy, half the old height */}
          <div
            className="mt-4 flex h-5 items-center gap-[3px] rounded-md border border-border bg-surface px-2"
            dir="ltr"
            aria-hidden
          >
            {Array.from({ length: 36 }).map((_, i) => {
              const lit = phase === "recording" && s.level > i / 36;
              const hot = i >= 30;
              return (
                <span
                  key={i}
                  className={`h-2.5 flex-1 rounded-[1px] transition-colors duration-75 ${
                    lit ? (hot ? "bg-warning" : "bg-accent") : "bg-surface-2"
                  }`}
                />
              );
            })}
          </div>

          {/* M38: live captions — the relay's rolling transcript. Interim
              words render muted; finals accumulate. Absence says so. */}
          {s.captions !== null ? (
            <div className="mt-4 rounded-md border border-border bg-surface p-3">
              <p className="text-xs font-semibold text-fg-subtle">{t("liveTitle")}</p>
              <p dir="auto" className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-fg">
                {s.captions.finals === "" && s.captions.interim === "" ? (
                  <span className="text-fg-muted">{t("liveWaiting")}</span>
                ) : (
                  <>
                    {s.captions.finals}
                    <span className="text-fg-muted">{s.captions.interim}</span>
                  </>
                )}
              </p>
            </div>
          ) : s.captionsDown ? (
            <p className="mt-4 text-xs text-fg-muted">{t("liveUnavailable")}</p>
          ) : null}

          {/* the take's waveform timeline — one bar per RMS sample, chapter
              marks as vertical lines at their moment */}
          {s.wave.length > 1 ? (
            <div className="mt-4 rounded-md bg-surface-2 p-3" dir="ltr" aria-hidden>
              <div className="relative flex h-10 items-center gap-px">
                {s.wave.map((v, i) => (
                  <span
                    key={i}
                    className="min-w-px flex-1 rounded-full bg-accent/80"
                    style={{ height: `${Math.max(4, v * 100)}%` }}
                  />
                ))}
                {s.chapterMarks.map((ms, i) => {
                  const span = s.recordedMs - s.waveStartMs;
                  if (span <= 0) return null;
                  const frac = (ms - s.waveStartMs) / span;
                  if (frac < 0 || frac > 1) return null;
                  return (
                    <span
                      key={`c-${i}`}
                      className="absolute bottom-0 top-0 w-0.5 rounded bg-warning"
                      style={{ left: `${frac * 100}%` }}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* input-quality watch: fixable NOW, so it surfaces now. A lost
              mic shows while PAUSED too — the auto-pause is the state the
              warning explains */}
          {s.quality !== null
            && (phase === "recording" || (phase === "paused" && s.quality === "micLost")) ? (
            <p role="status" className="mt-3 text-xs leading-6 text-warning">
              {s.quality === "quiet"
                ? t("quietWarn")
                : s.quality === "clipping"
                  ? t("clipWarn")
                  : s.quality === "micLost"
                    ? t("micLostWarn")
                    : t("shareEndedWarn")}
            </p>
          ) : null}

          {s.progress.done + s.progress.pending + s.progress.failed > 0 ? (
            <p className="mt-3 text-xs text-fg-muted">
              {t("uploadProgress", {
                done: digits(s.progress.done, locale),
                pending: digits(s.progress.pending, locale),
              })}
            </p>
          ) : null}

          {live ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {phase === "recording" ? (
                <button className="btn-secondary h-12 px-6" onClick={pause}>
                  {t("pause")}
                </button>
              ) : (
                <button className="btn-secondary h-12 px-6" onClick={resume}>
                  {t("resume")}
                </button>
              )}
              <button className="btn-primary h-12 px-6" onClick={() => void finish()}>
                {t("finish")}
              </button>
              {/* stop WITHOUT saving (user directive, 2026-08-23): red solid
                  fill, and it asks again — the first press only arms it */}
              {confirmDiscard ? (
                <span className="flex items-center gap-2">
                  <button
                    className="btn-danger h-12 px-6"
                    onClick={() => {
                      setConfirmDiscard(false);
                      void discardRecording().then(({ deleted }) => {
                        notify(
                          deleted ? t("discarded") : t("discardDeleteFailed"),
                          deleted ? undefined : "warn",
                        );
                      });
                    }}
                  >
                    {t("discardConfirm")}
                  </button>
                  <button
                    className="btn-ghost h-12 px-4"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    {t("discardKeep")}
                  </button>
                </span>
              ) : (
                <button
                  className="btn-danger h-12 px-6"
                  onClick={() => setConfirmDiscard(true)}
                >
                  {t("discard")}
                </button>
              )}
            </div>
          ) : null}
        </div>

        {live && s.callId ? (
          <div className="mt-4 lg:mt-0">
            <RecorderNotes
              callId={s.callId}
              atMs={s.recordedMs}
              onChapter={addChapterMark}
            />
          </div>
        ) : null}
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-success">
            <Chip tone="success">{t("finishedChip")}</Chip>
            {t("finishedBody")}
          </p>
          {s.previews[0] ? (
            <div>
              <p className="mb-1 text-xs text-fg-muted">{t("previewLabel")}</p>
              {/* one element, sink follows the speaker picker */}
              <audio ref={previewEl} controls src={s.previews[0].url} className="w-full" />
            </div>
          ) : null}
          <Link href="/echo/records" className="btn-secondary inline-flex">
            {t("goToCalls")}
          </Link>
          <button
            className="btn-primary ms-3 inline-flex"
            onClick={() => {
              resetRecorder();
              setTitle("");
            }}
          >
            {t("recordAnother")}
          </button>
        </div>
      ) : null}

      {phase === "failed" ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-danger">
            {errorText(s.error) ??
              t("uploadFailedBody", { failed: digits(s.progress.failed, locale) })}
          </p>
          <button className="btn-primary" onClick={() => void retryUploads()}>
            {t("retryUploads")}
          </button>
        </div>
      ) : null}

      {phase === "idle" && s.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorText(s.error)}
        </p>
      ) : null}
    </Card>
  );
}
