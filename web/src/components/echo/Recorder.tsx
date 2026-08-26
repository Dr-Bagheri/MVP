"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import {
  addChapterMark,
  discardRecording,
  finish,
  pause,
  BOOST_GAIN,
  recorderSnapshot,
  resetRecorder,
  resume,
  retryUploads,
  startRecording,
  subscribeRecorder,
  type RecorderErrorCode,
} from "@/lib/recordingEngine";
import { notify } from "@/lib/notify";
import { Card, Chip } from "@/components/ui";
import { Link } from "@/i18n/routing";
import { digits, formatClock, modelLabel } from "@/lib/format";
import { resumePoint } from "./uploadRules";
import { AgendaPanel, RecorderNotes } from "./RecorderNotes";
import { SelectMenu } from "@/components/rowActions";
import {
  IconCheck, IconChip, IconClock, IconFileText, IconGlobe, IconMic,
  IconPause, IconPlay, IconPulse, IconSpeaker, IconTrash,
} from "@/components/icons";
import { playTestChime } from "@/lib/deviceTest";
import { useAudioLevel } from "@/lib/useAudioLevel";
import { extractKeywords } from "@/lib/keywords";
import { customTemplates, type CustomTemplate } from "@/lib/summaryTemplates";
import { SUMMARY_TEMPLATES, type SummaryTemplate } from "@echo/core/vocabulary";

/** the record's tabs (user directive, 2026-08-26) — summary is
    deliberately absent: it is written when the take is processed, and a
    live tab for it would be an empty promise */
const TABS = ["transcript", "notes", "keywords"] as const;
const TAB_KEY = {
  transcript: "tabTranscript",
  notes: "tabNotes",
  keywords: "tabKeywords",
} as const;

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
  /** 0099: the model for this meeting's summaries. "" = the worker's own
      ladder — a real value, not a missing choice, so the dropdown says so
      in words rather than pre-selecting a model on the person's behalf. */
  const [summaryModel, setSummaryModel] = useState<string>("");
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    void api.models()
      .then((res) => setModelOptions(
        res.models.map((m) => ({ value: m.id, label: modelLabel(m.id) }))))
      .catch(() => setModelOptions([]));
  }, []);
  /** the red stop-and-delete asks AGAIN before acting (user directive) */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** loudness enhance: a gain stage between the mic and the recorder */
  const [boost, setBoost] = useState(false);
  /** the CHECK's own monitoring gain — how loud the meter reads, so a
      far mic can be judged before the take (it does not change the take) */
  const [monitorGain, setMonitorGain] = useState(1);
  const [tab, setTab] = useState<(typeof TABS)[number]>("transcript");
  /** speak «این جلسه ضبط می‌شود» into the room — and into the record */
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
      ...(summaryModel ? { summaryModel } : {}),
      boost,
    }).then(() => {
      void refreshDevices(); // labels exist once permission does
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
  /**
   * ONE continuous picker row (user directive, 2026-08-26: "together
   * without separation") — the fieldset boxes and legends are gone. The
   * two data-tour anchors survive as invisible groups with the SAME gap
   * inside and between them, so the guided tour can still ring each half
   * while the eye sees a single row of tiles. While a take is live the
   * row stays visible but LOCKED — these are the take's settings, and a
   * picker that still worked mid-take would claim a change it cannot make.
   */
  const pickers = (locked: boolean) => (
    <div className="flex flex-wrap items-start gap-4">
      <div data-tour="rec-devices" className="flex flex-wrap items-start gap-4">
        <SelectMenu
          variant="tile"
          ariaLabel={t("micField")}
          panelHeading={t("micField")}
          icon={<IconMic />}
          value={micId}
          onChange={setMicId}
          disabled={locked}
          options={
            mics.length === 0
              ? [{ value: "", label: t("micDefault") }]
              : mics.map((d) => ({ value: d.id, label: d.label }))
          }
          panelFooter={
            <MicLevelFooter
              micId={micId}
              label={t("menuLevel")}
              gain={monitorGain}
              gainLabel={t("micGain")}
              onGainChange={setMonitorGain}
              boost={boost}
              boostLabel={t("boostOption")}
              boostHint={t("boostHint")}
              onBoostChange={setBoost}
            />
          }
        />
        <SelectMenu
          variant="tile"
          ariaLabel={t("speakerField")}
          panelHeading={t("speakerField")}
          icon={<IconSpeaker />}
          value={speakerId}
          onChange={setSpeakerId}
          disabled={locked}
          options={
            speakers.length === 0
              ? [{ value: "", label: t("speakerDefault") }]
              : speakers.map((d) => ({ value: d.id, label: d.label }))
          }
          panelFooter={
            <button
              type="button"
              className="tap w-full rounded-md px-1 py-1 text-start text-xs text-accent hover:bg-surface-2"
              onClick={() => void playTestChime(speakerId)}
            >
              {t("menuPlayTest")}
            </button>
          }
        />
        <SelectMenu
          variant="tile"
          ariaLabel={t("sourceField")}
          panelHeading={t("sourceField")}
          icon={<IconPulse />}
          value={source}
          onChange={(v) => setSource(v as "mic" | "system")}
          disabled={locked}
          options={[
            { value: "mic", label: t("sourceMic") },
            { value: "system", label: t("sourceSystem") },
          ]}
        />
      </div>
      <div data-tour="rec-meeting" className="flex flex-wrap items-start gap-4">
        {/* the transcriber's hint — set at creation */}
        <SelectMenu
          variant="tile"
          ariaLabel={t("languageField")}
          panelHeading={t("languageField")}
          icon={<IconGlobe />}
          value={language}
          onChange={(v) => setLanguage(v as "fa" | "en" | "mixed")}
          disabled={locked || resuming}
          options={[
            { value: "mixed", label: t("languageMixed") },
            { value: "fa", label: t("languageFa") },
            { value: "en", label: t("languageEn") },
          ]}
        />
        {/* 0094: the summary's SHAPE chosen before the meeting — the
            ruled five plus this person's own templates */}
        <SelectMenu
          variant="tile"
          ariaLabel={t("templateField")}
          panelHeading={t("templateField")}
          icon={<IconFileText />}
          value={template}
          onChange={setTemplate}
          disabled={locked || resuming}
          options={[
            { value: "", label: t("templateNone") },
            ...SUMMARY_TEMPLATES.map((k) => ({ value: k, label: t(TEMPLATE_KEY[k]) })),
            ...customs.map((c) => ({ value: `custom:${c.name}`, label: c.name })),
          ]}
        />
        {/* 0099: the model for this meeting's summaries. The empty
            choice is NAMED — the default is the worker's own ladder,
            and pre-selecting a model here would destroy the "has
            not chosen" state M5 protects. */}
        <SelectMenu
          variant="tile"
          ariaLabel={t("modelField")}
          panelHeading={t("modelField")}
          icon={<IconChip />}
          value={summaryModel}
          onChange={setSummaryModel}
          disabled={locked || resuming}
          options={[
            { value: "", label: t("modelDefault") },
            ...modelOptions,
          ]}
        />
      </div>
    </div>
  );

  /**
   * THE ROLLING WAVE (user directive, 2026-08-26, from the reference
   * recorder): a fixed window over the take's NEWEST samples — new bars
   * enter at the end, old ones fall off the start, so the band moves with
   * the recording instead of compressing forever. Idle it is a quiet
   * baseline; paused it holds still (nothing is being written, so nothing
   * moves). Chapter marks ride the window at their moment while visible;
   * their placement uses the window's average sample duration, which the
   * engine's occasional 2:1 wave compaction makes approximate — fine for
   * a band whose whole content is transient.
   */
  const waveBand = () => {
    /* the numbers follow the open-source consensus (react-voice-visualizer,
       react-audio-visualize, wavesurfer's record plugin — researched
       2026-08-26): thin pills at a ~2:1 bar:gap ratio, mirrored around the
       vertical centre, a 2px hairline floor when silent (never zero, never
       boxes), history slightly dimmer than the newest bars, and the band
       sitting directly on the page — no frame around a waveform */
    const SLOTS = 160;
    const shown = s.wave.slice(-SLOTS);
    const pad = SLOTS - shown.length;
    const span = s.recordedMs - s.waveStartMs;
    const msPerSample = s.wave.length > 0 && span > 0 ? span / s.wave.length : 0;
    const visibleStartMs = s.recordedMs - shown.length * msPerSample;
    const windowSpan = s.recordedMs - visibleStartMs;
    return (
      <div className="mt-3" dir="ltr" aria-hidden>
        <div className="relative flex h-28 items-center gap-px">
          {Array.from({ length: SLOTS }, (_, i) => {
            const v = i < pad ? 0 : shown[i - pad]!;
            const active = v > 0.02;
            return (
              <span
                key={i}
                className={`min-w-px flex-1 rounded-full ${
                  active
                    ? i >= SLOTS - 12 ? "bg-accent" : "bg-accent/65"
                    : "bg-fg-subtle/30"
                }`}
                style={{ height: active ? `${Math.min(100, 6 + v * 110)}%` : "2px" }}
              />
            );
          })}
          {msPerSample > 0
            ? s.chapterMarks.map((ms, i) => {
                const denom = s.recordedMs - visibleStartMs;
                if (denom <= 0) return null;
                const frac = (ms - visibleStartMs) / denom;
                if (frac < 0 || frac > 1) return null;
                return (
                  <span
                    key={`c-${i}`}
                    className="absolute bottom-1 top-1 w-0.5 rounded bg-warning"
                    style={{ left: `${frac * 100}%` }}
                  />
                );
              })
            : null}
          {/* NOW — the newest bar's edge (the reference's playhead) */}
          {s.wave.length > 0 ? (
            <span className="absolute bottom-0 right-0 top-0 w-0.5 rounded bg-accent">
              <span className="absolute -top-1 right-1/2 h-2.5 w-2.5 translate-x-1/2 rounded-full bg-accent" />
            </span>
          ) : null}
        </div>
        {/* the ruler: the rolling window's own clock, start → now — held
            back until the window spans 5s (below that every label reads
            the same second, a ruler that measures nothing) */}
        {windowSpan >= 5_000 ? (
          <div className="mt-1.5 flex select-none justify-between text-[10px] leading-none tabular-nums text-fg-subtle">
            {Array.from({ length: 5 }, (_, i) => {
              const ms = visibleStartMs + (windowSpan * i) / 4;
              return <span key={i}>{formatClock(Math.floor(ms / 1000), locale)}</span>;
            })}
          </div>
        ) : null}
      </div>
    );
  };

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
      {phase !== "done" ? (
        /* ONE surface for every state (user directive, 2026-08-26: "remove
           this page, just keep the second one") — idle, starting, live and
           finishing all wear the same anatomy; only the transport's centre
           and the tabs' moods change. The pad rides BESIDE the take on
           wide screens, under it on small. */
        <div className="gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {resuming && (phase === "idle" || phase === "starting") ? (
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
          {pickers(live || phase === "finishing")}
          <div className="mt-4 flex items-center gap-3">
            {/* the REC treatment measured off Riverside: while recording
                the state wears a danger-tint pill; other states stay quiet */}
            <span
              className={`flex items-center gap-2 ${
                phase === "recording"
                  ? "rounded-lg bg-danger/10 px-2.5 py-1 text-danger"
                  : "text-fg"
              }`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  phase === "recording" ? "animate-pulse bg-danger" : "bg-fg-subtle"
                }`}
                aria-hidden
              />
              <span className="text-sm font-medium">
                {phase === "paused"
                  ? t("pausedState")
                  : phase === "finishing"
                    ? t("finishing")
                    : phase === "recording"
                      ? t("recordingState")
                      : t("readyState")}
              </span>
            </span>
            <span className="ltr text-sm font-semibold tabular-nums text-fg">
              {formatClock(
                live || phase === "finishing"
                  ? recordedSec
                  : resuming ? Math.floor(resumeTarget.offsetMs / 1000) : 0,
                locale,
              )}
            </span>
          </div>

          {waveBand()}

          {/* the reference transport, with OUR real actions in its order:
              mark, discard, the big pause/resume, finish — skip and speed
              belong to playback, and a control that does nothing on a live
              take would be a lie */}
          {live ? (
            <div className="mt-4 flex items-center justify-center gap-3" dir="ltr">
              <button
                type="button"
                title={t("markButton")}
                aria-label={t("markButton")}
                className="tap grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                onClick={() => { addChapterMark(s.recordedMs); notify(t("marked")); }}
              >
                <IconClock width={16} height={16} />
              </button>
              {confirmDiscard ? (
                /* stop WITHOUT saving asks again — the first press only arms */
                <span className="flex items-center gap-2">
                  <button
                    className="btn-danger h-9 px-3 text-xs"
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
                  <button className="btn-ghost h-9 px-2 text-xs" onClick={() => setConfirmDiscard(false)}>
                    {t("discardKeep")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  title={t("discard")}
                  aria-label={t("discard")}
                  className="tap grid h-10 w-10 place-items-center rounded-full border border-danger/40 bg-surface text-danger transition-colors hover:bg-danger/10"
                  onClick={() => setConfirmDiscard(true)}
                >
                  <IconTrash width={16} height={16} />
                </button>
              )}
              <button
                type="button"
                title={phase === "recording" ? t("pause") : t("resume")}
                aria-label={phase === "recording" ? t("pause") : t("resume")}
                className="tap grid h-16 w-16 place-items-center rounded-full bg-fg text-surface shadow-lg transition-transform hover:scale-105 active:scale-95"
                onClick={phase === "recording" ? pause : resume}
              >
                {phase === "recording"
                  ? <IconPause width={24} height={24} />
                  : <IconPlay width={24} height={24} />}
              </button>
              <button
                type="button"
                title={t("finish")}
                aria-label={t("finish")}
                className="tap grid h-10 w-10 place-items-center rounded-full bg-accent text-on-accent shadow transition-transform hover:scale-105"
                onClick={() => void finish()}
              >
                <IconCheck width={16} height={16} />
              </button>
            </div>
          ) : phase === "idle" || phase === "starting" ? (
            /* the transport's centre before the take exists: ONE big red
               record circle (the reference's), label under it */
            <div className="mt-4 flex flex-col items-center gap-2" dir="ltr">
              <button
                data-tour="rec-start"
                aria-label={resuming ? t("resumeStart") : t("start")}
                className="tap grid h-16 w-16 place-items-center rounded-full bg-danger text-white shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
                disabled={phase === "starting"}
                onClick={() => start()}
              >
                <span aria-hidden className="block h-5 w-5 rounded-full border-2 border-white" />
              </button>
              <span className="text-sm font-medium text-fg-muted">
                {phase === "starting" ? t("starting") : resuming ? t("resumeStart") : t("start")}
              </span>
            </div>
          ) : null}

          {/* the record's own tabs: transcript, notes, keywords — all of it
              coming OUT of the take (user directive, 2026-08-26) */}
          <div role="tablist" className="mt-5 flex gap-6 border-b border-border">
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`tap -mb-px border-b-[3px] px-0.5 py-2 text-sm transition-colors ${
                  tab === k
                    ? "border-accent font-semibold text-fg"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
                onClick={() => setTab(k)}
              >
                {t(TAB_KEY[k])}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {tab === "transcript" ? (
              /* M38 live captions as stamped ROWS. Interim renders muted at
                 the tail; absence still says so. */
              s.captions !== null ? (
                s.captionRows.length === 0 && s.captions.interim === "" ? (
                  <p className="text-sm text-fg-muted">{t("liveWaiting")}</p>
                ) : (
                  <div className="max-h-80 space-y-3 overflow-y-auto pe-1">
                    {s.captionRows.map((row, i) => (
                      <div key={i} className="flex gap-3 text-sm leading-7">
                        <span className="ltr w-10 shrink-0 pt-0.5 text-end text-xs tabular-nums text-fg-subtle">
                          {formatClock(Math.floor(row.atMs / 1000), locale)}
                        </span>
                        <p dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap text-fg">
                          {row.text}
                        </p>
                      </div>
                    ))}
                    {s.captions.interim !== "" ? (
                      <p dir="auto" className="ps-[3.25rem] text-sm leading-7 text-fg-muted">
                        {s.captions.interim}
                      </p>
                    ) : null}
                  </div>
                )
              ) : s.captionsDown ? (
                <p className="text-xs text-fg-muted">{t("liveUnavailable")}</p>
              ) : (
                /* no lane and no failure = the take has not started */
                <p className="text-sm text-fg-muted">
                  {t(live || phase === "finishing" ? "liveWaiting" : "transcriptIdle")}
                </p>
              )
            ) : tab === "notes" ? (
              s.callId ? (
                <RecorderNotes callId={s.callId} atMs={s.recordedMs} onChapter={addChapterMark} />
              ) : (
                <p className="text-sm text-fg-muted">{t("notesIdle")}</p>
              )
            ) : (
              (() => {
                /* derived LIVE from the transcript so far — counted, never
                   guessed (lib/keywords) */
                const words = extractKeywords(s.captions?.finals ?? "");
                return words.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t("keywordsEmpty")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {words.map(({ word, count }) => (
                      <span key={word} dir="auto" className="rounded-full bg-surface-2 px-3 py-1 text-sm text-fg">
                        {word}
                        <span className="ms-1.5 text-xs text-fg-subtle">{digits(count, locale)}</span>
                      </span>
                    ))}
                  </div>
                );
              })()
            )}
          </div>

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

        </div>

        <div className="mt-4 lg:mt-0">
          {/* items can be planned BEFORE the take (client state); ticking
              one persists a stamped chapter, so it waits for the call */}
          <AgendaPanel
            callId={s.callId}
            atMs={s.recordedMs}
            onChapter={addChapterMark}
          />
        </div>
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

/**
 * The mic menu's live meter (the Meet reference): mounts when the panel
 * opens, opens its OWN short stream on the selected device, and releases
 * it the moment the menu closes — the meter must never hold the mic after
 * the panel is gone. A moving bar is the only honest answer to "is this
 * the right microphone": a device name proves nothing.
 */
function MicLevelFooter({
  micId,
  label,
  gain,
  gainLabel,
  onGainChange,
  boost,
  boostLabel,
  boostHint,
  onBoostChange,
}: {
  micId: string;
  label: string;
  /** the meter's own multiplier (0.5–3) — display only, never the take */
  gain: number;
  gainLabel: string;
  onGainChange: (next: number) => void;
  /** loudness enhance — the one control here that changes the RECORDING
      itself; the meter previews it with the engine's own multiplier */
  boost: boolean;
  boostLabel: string;
  boostHint: string;
  onBoostChange: (next: boolean) => void;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let opened: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({
        audio: {
          ...(micId ? { deviceId: { exact: micId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      .then((s2) => {
        if (!live) {
          s2.getTracks().forEach((track) => track.stop());
          return;
        }
        opened = s2;
        setStream(s2);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => {
      live = false;
      opened?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [micId]);
  /* the same multipliers the engine applies — the bar is a preview of
     the take, not a decoration */
  const level = Math.min(1, useAudioLevel(stream) * gain * (boost ? BOOST_GAIN : 1));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] text-fg-subtle">{label}</span>
        <span className="flex h-2 flex-1 items-center gap-[2px]" aria-hidden>
          {Array.from({ length: 16 }, (_, i) => (
            <span
              key={i}
              className={`h-full flex-1 rounded-[1px] transition-colors ${
                !failed && level * 16 > i
                  ? i > 12 ? "bg-warning" : "bg-success"
                  : "bg-surface-2"
              }`}
            />
          ))}
        </span>
      </div>
      {/* the sensitivity slider, moved here from the retired mic-test card
          (user directive, 2026-08-26): tune the meter where the meter is */}
      <label className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] text-fg-subtle">{gainLabel}</span>
        <input
          type="range"
          dir="ltr"
          className="h-1 flex-1 accent-accent"
          min={0.5}
          max={3}
          step={0.1}
          value={gain}
          onChange={(e) => onGainChange(Number(e.target.value))}
        />
      </label>
      {/* the loudness enhance moved in from the retired device-check card
          (user directive, 2026-08-26) — everything about the mic in the
          mic's own menu */}
      <label className="flex cursor-pointer items-start gap-1.5 text-[10px] leading-4 text-fg">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={boost}
          onChange={(e) => onBoostChange(e.target.checked)}
        />
        <span>
          {boostLabel}
          <span className="block text-fg-subtle">{boostHint}</span>
        </span>
      </label>
    </div>
  );
}
