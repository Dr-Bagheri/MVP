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
import { ConfirmDialog, KebabMenu, SelectMenu, type KebabItem } from "@/components/rowActions";
import {
  IconCheck, IconChip, IconClock, IconFileText, IconGlobe, IconMic,
  IconPause, IconPeople3, IconPlay, IconPulse, IconSettings, IconSpeaker,
} from "@/components/icons";
import { playTestChime } from "@/lib/deviceTest";
import { useAudioLevel } from "@/lib/useAudioLevel";
import { customTemplates, type CustomTemplate } from "@/lib/summaryTemplates";
import { SUMMARY_TEMPLATES, type SummaryTemplate } from "@echo/core/vocabulary";

/**
 * The live transcript's speaker tones. Four, cycling: the live lane hands
 * us opaque labels ("1", "2", …) and nothing else, so colour is the only
 * way one voice reads as continuous down the column. It is deliberately
 * NOT a name — names are matched to the directory after the take.
 */
const SPEAKER_TONE = [
  "border-accent/50 text-accent",
  "border-success/50 text-success",
  "border-warning/50 text-warning",
  "border-info/50 text-info",
] as const;

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
  /** loudness enhance: a gain stage between the mic and the recorder */
  const [boost, setBoost] = useState(false);
  /** the CHECK's own monitoring gain — how loud the meter reads, so a
      far mic can be judged before the take (it does not change the take) */
  const [monitorGain, setMonitorGain] = useState(1);
  /** the stop button's question: save this take, or delete it? */
  const [stopAsk, setStopAsk] = useState(false);
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
   * THE SETTINGS MENU (user directive, 2026-08-26: "all the icons for
   * speaker, language, summary and model must be in a setting icon,
   * coming up with a kebab menu, with sub kebab menu like the style that
   * we have in the theme").
   *
   * Four rows, each a flyout of its own values — the theme's own nested
   * kebab, so this menu inherits the placement, the RTL flip and the
   * never-scrolls rule for free. The chosen value wears the check in the
   * icon gutter, which is why these rows pass `icon: null` when unchosen:
   * a value row is not an action (the KebabItem escape hatch).
   *
   * The mic and the source do NOT live here — they are the two controls a
   * person reaches for while looking at the meter, so they keep their own
   * round buttons in the transport.
   */
  const MODEL_ROWS = 12;
  const checked = (on: boolean) => (on ? <IconCheck width={14} height={14} /> : null);
  const settingsItems: KebabItem[] = [
    {
      key: "speaker",
      label: t("speakerField"),
      icon: <IconSpeaker width={15} height={15} />,
      sub: [
        ...(speakers.length === 0
          ? [{ value: "", label: t("speakerDefault") }]
          : speakers.map((d) => ({ value: d.id, label: d.label }))
        ).map((o) => ({
          key: `sp-${o.value}`,
          label: o.label,
          icon: checked(o.value === speakerId),
          onSelect: () => setSpeakerId(o.value),
        })),
        {
          key: "sp-test",
          label: t("menuPlayTest"),
          icon: <IconPlay width={14} height={14} />,
          keepOpen: true,
          onSelect: () => void playTestChime(speakerId),
        },
      ],
    },
    {
      key: "language",
      label: t("languageField"),
      icon: <IconGlobe width={15} height={15} />,
      sub: [
        { value: "mixed", label: t("languageMixed") },
        { value: "fa", label: t("languageFa") },
        { value: "en", label: t("languageEn") },
      ].map((o) => ({
        key: `lang-${o.value}`,
        label: o.label,
        icon: checked(o.value === language),
        disabled: resuming,
        onSelect: () => setLanguage(o.value as "fa" | "en" | "mixed"),
      })),
    },
    {
      key: "template",
      label: t("templateField"),
      icon: <IconFileText width={15} height={15} />,
      sub: [
        { value: "", label: t("templateNone") },
        ...SUMMARY_TEMPLATES.map((k) => ({ value: k as string, label: t(TEMPLATE_KEY[k]) })),
        ...customs.map((c) => ({ value: `custom:${c.name}`, label: c.name })),
      ].map((o) => ({
        key: `tpl-${o.value}`,
        label: o.label,
        icon: checked(o.value === template),
        disabled: resuming,
        onSelect: () => setTemplate(o.value),
      })),
    },
    {
      key: "model",
      label: t("modelField"),
      icon: <IconChip width={15} height={15} />,
      sub: [
        {
          key: "model-",
          label: t("modelDefault"),
          icon: checked(summaryModel === ""),
          disabled: resuming,
          onSelect: () => setSummaryModel(""),
        },
        /* the catalogue runs to hundreds and this menu never scrolls, so
           the flyout carries the head of the list and SAYS what it left
           out — a silently truncated list reads as the whole catalogue */
        ...modelOptions.slice(0, MODEL_ROWS).map((o) => ({
          key: `model-${o.value}`,
          label: o.label,
          icon: checked(o.value === summaryModel),
          disabled: resuming,
          onSelect: () => setSummaryModel(o.value),
        })),
        ...(modelOptions.length > MODEL_ROWS
          ? [{
              key: "model-more",
              label: t("modelMore", { n: digits(modelOptions.length - MODEL_ROWS, locale) }),
              icon: null,
              disabled: true,
            }]
          : []),
      ],
    },
  ];

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
    const SLOTS = 96;
    const shown = s.wave.slice(-SLOTS);
    const pad = SLOTS - shown.length;
    const span = s.recordedMs - s.waveStartMs;
    const msPerSample = s.wave.length > 0 && span > 0 ? span / s.wave.length : 0;
    const visibleStartMs = s.recordedMs - shown.length * msPerSample;
    const windowSpan = s.recordedMs - visibleStartMs;
    /* the glow follows the LIVE level, in three steps rather than
       continuously: a filter that changes every frame re-rasterises the
       band, and nobody can see more than three steps of a halo anyway */
    const glow = phase !== "recording" || s.level < 0.08 ? "0" : s.level < 0.35 ? "1" : "2";
    return (
      <div className="mt-3" dir="ltr" aria-hidden>
        <div className="wave-band h-28" data-glow={glow}>
          {s.wave.length === 0 ? <span className="wave-idle" /> : null}
          {Array.from({ length: SLOTS }, (_, i) => (
            <span
              key={i}
              className="wave-bar"
              style={{
                /* the 0.02 floor IS the hairline — see globals.css */
                "--v": Math.max(0.02, i < pad ? 0 : shown[i - pad]!),
                "--age": (i / SLOTS).toFixed(3),
              } as React.CSSProperties}
            />
          ))}
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
      {/* STOP asks (user directive, 2026-08-26): save it, or delete it.
          Both are real answers, so neither rides the cancel slot — cancel
          also fires on Escape and on a backdrop click, and an action
          parked there would run every time somebody dismissed the box. */}
      {stopAsk ? (
        <ConfirmDialog
          title={t("stopTitle")}
          body={t("stopBody")}
          cancelLabel={t("stopKeep")}
          confirmLabel={t("stopSave")}
          danger={false}
          alt={{
            label: t("stopDelete"),
            danger: true,
            onSelect: () => {
              setStopAsk(false);
              void discardRecording().then(({ deleted }) => {
                notify(
                  deleted ? t("discarded") : t("discardDeleteFailed"),
                  deleted ? undefined : "warn",
                );
              });
            },
          }}
          onConfirm={() => { setStopAsk(false); void finish(); }}
          onCancel={() => setStopAsk(false)}
        />
      ) : null}
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
          <div className="flex items-center gap-3">
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
            {/* the voices counted so far (user directive, 2026-08-26). It
                appears only once the lane has actually attached a label:
                a "0" or a "—" here would be a claim about the room, and
                the honest state before the first label is silence. */}
            {s.liveSpeakers.length > 0 ? (
              <span
                className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted"
                title={t("speakersSeen", { count: digits(s.liveSpeakers.length, locale) })}
              >
                <IconPeople3 width={14} height={14} />
                <span className="tabular-nums">{digits(s.liveSpeakers.length, locale)}</span>
              </span>
            ) : null}
          </div>

          {waveBand()}

          {/*
            THE TRANSPORT (user directive, 2026-08-26), in the order asked
            for: settings at the far left, pause beside it, the record
            button in the middle, then the mic and the audio source.

            The middle button is the whole state machine: red circle to
            begin, white circle with a stop square while a take rolls, and
            pressing stop ASKS — save it or delete it — because those are
            two answers, not a confirmation.
          */}
          <div className="mt-4 flex items-center justify-center gap-3" dir="ltr">
            {/* the guided lessons ring these two anchors by name (the
                `rec-meeting` / `rec-devices` targets in EchoSectionMenu).
                They moved with the controls: a tour target that no longer
                exists does not fail loudly, it silently skips a step. */}
            <span data-tour="rec-meeting" className="inline-flex">
              <KebabMenu
                label={t("settingsMenu")}
                items={settingsItems}
                trigger={<IconSettings width={18} height={18} />}
                triggerClassName="h-10 w-10 rounded-full border border-border bg-surface text-fg-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg"
              />
            </span>
            <button
              type="button"
              title={phase === "recording" ? t("pause") : t("resume")}
              aria-label={phase === "recording" ? t("pause") : t("resume")}
              disabled={!live}
              className="tap grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
              onClick={phase === "recording" ? pause : resume}
            >
              {phase === "recording"
                ? <IconPause width={18} height={18} />
                : <IconPlay width={18} height={18} />}
            </button>
            {live ? (
              <button
                type="button"
                title={t("stopButton")}
                aria-label={t("stopButton")}
                className="tap grid h-16 w-16 place-items-center rounded-full bg-fg shadow-lg transition-transform hover:scale-105 active:scale-95"
                onClick={() => setStopAsk(true)}
              >
                <span aria-hidden className="block h-5 w-5 rounded-[4px] bg-danger" />
              </button>
            ) : (
              <button
                data-tour="rec-start"
                type="button"
                title={resuming ? t("resumeStart") : t("start")}
                aria-label={resuming ? t("resumeStart") : t("start")}
                className="tap grid h-16 w-16 place-items-center rounded-full bg-danger text-white shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
                disabled={phase === "starting" || phase === "finishing"}
                onClick={() => start()}
              >
                <span aria-hidden className="block h-5 w-5 rounded-full border-2 border-white" />
              </button>
            )}
            <span data-tour="rec-devices" className="inline-flex items-center gap-3">
            <SelectMenu
              variant="round"
              ariaLabel={t("micField")}
              panelHeading={t("micField")}
              icon={<IconMic width={18} height={18} />}
              value={micId}
              onChange={setMicId}
              disabled={live || phase === "finishing"}
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
              variant="round"
              ariaLabel={t("sourceField")}
              panelHeading={t("sourceField")}
              icon={<IconPulse width={18} height={18} />}
              value={source}
              onChange={(v) => setSource(v as "mic" | "system")}
              disabled={live || phase === "finishing"}
              options={[
                { value: "mic", label: t("sourceMic") },
                { value: "system", label: t("sourceSystem") },
              ]}
            />
            </span>
          </div>

          {/* THE TRANSCRIPT — the surface's main column now that Keywords
              is gone and Notes moved beside the action items (user
              directive, 2026-08-26). Stamped rows, one per turn; a
              speaker change opens a row and wears its own tone. */}
          <div className="mt-5 border-t border-border pt-4">
            {s.captions !== null ? (
              s.captionRows.length === 0 && s.captions.interim === "" ? (
                <p className="text-sm text-fg-muted">{t("liveWaiting")}</p>
              ) : (
                <div className="max-h-80 space-y-3 overflow-y-auto pe-1">
                  {s.captionRows.map((row, i) => {
                    const tone = row.speaker
                      ? SPEAKER_TONE[s.liveSpeakers.indexOf(row.speaker) % SPEAKER_TONE.length]!
                      : null;
                    return (
                      <div key={i} className="flex gap-3 text-sm leading-7">
                        <span className="ltr w-10 shrink-0 pt-0.5 text-end text-xs tabular-nums text-fg-subtle">
                          {formatClock(Math.floor(row.atMs / 1000), locale)}
                        </span>
                        {row.speaker ? (
                          <span
                            className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold tabular-nums ${tone}`}
                            title={t("speakerNamed", { n: digits(row.speaker, locale) })}
                          >
                            {digits(row.speaker, locale)}
                          </span>
                        ) : null}
                        <p dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap text-fg">
                          {row.text}
                        </p>
                      </div>
                    );
                  })}
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

        <div className="mt-4 space-y-4 lg:mt-0">
          {/* items can be planned BEFORE the take (client state); ticking
              one persists a stamped chapter, so it waits for the call */}
          <AgendaPanel
            callId={s.callId}
            atMs={s.recordedMs}
            onChapter={addChapterMark}
          />

          {/* the notebook moved UNDER the action items (user directive,
              2026-08-26) — and it carries the mark-this-moment button that
              left the transport, which is where a marker belongs anyway:
              beside the writing it anchors */}
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-fg">{t("notesTitle")}</p>
              {live ? (
                <button
                  type="button"
                  title={t("markButton")}
                  aria-label={t("markButton")}
                  className="tap grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
                  onClick={() => { addChapterMark(s.recordedMs); notify(t("marked")); }}
                >
                  <IconClock width={15} height={15} />
                </button>
              ) : null}
            </div>
            {s.callId ? (
              <div className="mt-2">
                <RecorderNotes callId={s.callId} atMs={s.recordedMs} onChapter={addChapterMark} />
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-fg-muted">{t("notesIdle")}</p>
            )}
          </div>

          {/* the voices the lane has told apart so far. They are NUMBERS,
              deliberately: live diarization separates speakers, it does
              not name them — matching a voice to a person in the directory
              happens after the take, and a name here would be a guess
              wearing an avatar. */}
          {s.liveSpeakers.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-sm font-semibold text-fg">{t("peopleTitle")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {s.liveSpeakers.map((label, i) => (
                  <span
                    key={label}
                    title={t("speakerNamed", { n: digits(label, locale) })}
                    className={`grid h-8 w-8 place-items-center rounded-full border bg-surface-2 text-xs font-semibold tabular-nums ${
                      SPEAKER_TONE[i % SPEAKER_TONE.length]
                    }`}
                  >
                    {digits(label, locale)}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-fg-subtle">{t("peopleHint")}</p>
            </div>
          ) : null}
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
