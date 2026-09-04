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
  ringSlice,
  RING_SAMPLE_RATE,
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
import { shouldLinkMeeting } from "./meetingLink";
import { shouldStick } from "@/lib/threadFollow";
import { AgendaPanel, RecorderNotes } from "./RecorderNotes";
import { ConfirmDialog, KebabMenu, SelectMenu, type KebabItem } from "@/components/rowActions";
import {
  IconCheck, IconChip, IconClock, IconFileText, IconGlobe, IconMic,
  IconPause, IconPeople3, IconPlay, IconPulse, IconSettings, IconSpeaker,
} from "@/components/icons";
import { EchoMark } from "@/components/platform/icons";
import { playTestChime } from "@/lib/deviceTest";
import { useAudioLevel } from "@/lib/useAudioLevel";
import { establishedSpeakers } from "@/lib/liveSpeakers";
import { planSnippet } from "@/lib/voiceSnippet";
import { encodeWav } from "@/lib/wav";
import { customTemplates, type CustomTemplate } from "@/lib/summaryTemplates";
import type { Person } from "@/api/types";
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

export function Recorder({ onFinished, meeting: meetingProp }: {
  onFinished?: () => void;
  /** 0145: a meeting page embedding the recorder hands the meeting DOWN as
      a prop; the `?meeting=` URL adoption below stays for /echo links */
  meeting?: { id: string; mode: "upload" | "in_person" | "online"; title: string };
}) {
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
  /**
   * NOISE SUPPRESSION (user directive, 2026-08-28): the browser's own
   * filter, a checkbox now instead of a constant. Default ON — that is the
   * behavior every take had before the choice existed. Held the way `boost`
   * is held (component state for this visit, no store): the default is the
   * right answer often enough that re-choosing per visit costs nothing.
   */
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  /** the CHECK's own monitoring gain — how loud the meter reads, so a
      far mic can be judged before the take (it does not change the take) */
  const [monitorGain, setMonitorGain] = useState(1);
  /** the stop button's question: save this take, or delete it? */
  const [stopAsk, setStopAsk] = useState(false);
  /**
   * Naming a live voice (user ask, 2026-08-26: "can we do the voice naming
   * during the recording as well?"). label → directory person id.
   *
   * LIVE ONLY, and the card says so: the realtime lane's labels ("1", "2")
   * are its own numbering and do not correspond to the speaker rows the
   * pipeline creates from the finished audio, so persisting this map would
   * attach a name to the wrong voice on the record. What it does buy is
   * real: a transcript you can read while the meeting is happening.
   */
  const [voiceNames, setVoiceNames] = useState<Record<string, string>>({});
  /** labels the matcher has already answered for — asked once, not on a
      loop: a second opinion on the same voice costs money and changes
      nothing, and a label that came back unknown stays unknown until the
      person names it themselves */
  const asked = useRef<Set<string>>(new Set());
  const matching = useRef(false);
  const [namingVoice, setNamingVoice] = useState<string | null>(null);
  const [namePick, setNamePick] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
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
      noiseSuppression,
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

  /**
   * 0145 — a MEETING handed to the recorder (`/echo?meeting=<id>`): the
   * meeting's title becomes the take's, and its holding mode picks the
   * source — online is the section we did not have, and it means the
   * system-audio source (both sides of the online meeting in one take).
   * Same one-shot location.search read as `resume` above, and for the same
   * production-build reason.
   */
  const [meetingTarget, setMeetingTarget] = useState<{ id: string; linked: boolean } | null>(null);
  /**
   * The engine's callId AT ADOPTION TIME. The engine is module-level and
   * survives navigation with its last take's id still in hand — so "there
   * is a callId" is NOT evidence this meeting produced it. Only a take
   * that STARTS after adoption (callId changes from this baseline) may be
   * linked; without the baseline, opening a due meeting right after an
   * unrelated take silently claimed that take as the meeting's record.
   */
  const meetingBaselineCallId = useRef<string | null>(null);
  useEffect(() => {
    const adopt = (m: { id: string; mode: string; title: string; call_id?: string | null }) => {
      meetingBaselineCallId.current = recorderSnapshot().callId ?? null;
      setMeetingTarget({ id: m.id, linked: (m.call_id ?? null) !== null });
      setTitle((prev) => (prev.trim() === "" ? m.title : prev));
      if (m.mode === "online") setSource("system");
      else if (m.mode === "in_person") setSource("mic");
    };
    const prefillOnly = (m: { title: string; mode: string }) => {
      /* the read failed: we cannot know whether a record is already linked,
         so linking stays DISARMED — prefill is a convenience, a wrong link
         is a corrupted record */
      setTitle((prev) => (prev.trim() === "" ? m.title : prev));
      if (m.mode === "online") setSource("system");
      else if (m.mode === "in_person") setSource("mic");
    };
    if (meetingProp !== undefined) {
      /* embedded on the meeting's own page: the prop IS the meeting; still
         ask the server for call_id so a second visit never re-links */
      void api.meetingDetail(meetingProp.id)
        .then(adopt)
        .catch(() => prefillOnly(meetingProp));
      return;
    }
    const id = new URLSearchParams(window.location.search).get("meeting");
    if (!id) return;
    void api
      .meetingDetail(id)
      .then(adopt)
      .catch(() => setMeetingTarget(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot adoption
  }, []);

  /**
   * The link back: the first call this recorder creates becomes the
   * meeting's record. Written as soon as the call EXISTS rather than at
   * finish — a tab that dies mid-take still leaves the meeting pointing at
   * the partial record, which is the honest state. Once linked, never
   * re-written: a second take on the same page is its own call.
   */
  useEffect(() => {
    /* the decision lives in meetingLink.ts, where its matrix is pinned —
       including the baseline case: the engine's leftover callId from an
       earlier, unrelated take must never be claimed */
    if (!shouldLinkMeeting(meetingTarget, s.callId ?? null, meetingBaselineCallId.current)) return;
    const target = meetingTarget!;
    setMeetingTarget({ ...target, linked: true });
    void api.updateMeeting(target.id, { call_id: s.callId }).catch(() => {
      /* the refusal leaves the meeting unlinked — visible on its own screen,
         and re-linkable from there once that surface offers it; swallowing
         here keeps a link failure from interrupting a live recording */
    });
  }, [meetingTarget, s.callId]);

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
      icon: <IconSpeaker width={16} height={16} />,
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
      icon: <IconGlobe width={16} height={16} />,
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
      icon: <IconFileText width={16} height={16} />,
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
      icon: <IconChip width={16} height={16} />,
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
  /**
   * LIVE VOICE MATCHING (user ask, 2026-08-26). Once a voice has plainly
   * held the floor for a stretch, a few seconds of it go to the matcher,
   * and a confident answer names it on screen — the same question M39
   * asks after a call, asked while the call is still happening.
   *
   * Every guard here exists because a WRONG name is worse than a number:
   *  · the window comes from planSnippet, which refuses anything near a
   *    handover — recognition runs behind the room, so audio cut at a
   *    caption's timestamp lands late;
   *  · one attempt per label, ever (`asked`), and one in flight at a time;
   *  · a label the person already named is left alone — a human's answer
   *    outranks the machine's;
   *  · silence about it when the server is unsure or unreachable: the
   *    voice simply stays numbered.
   */
  useEffect(() => {
    if (phase !== "recording" || matching.current) return;
    const plan = planSnippet(s.captionRows, s.recordedMs);
    if (!plan || asked.current.has(plan.label) || voiceNames[plan.label]) return;
    const samples = ringSlice(plan.startMs, plan.endMs);
    if (!samples) return;              // the ring rolled past it
    asked.current.add(plan.label);
    matching.current = true;
    const label = plan.label;
    void api.matchVoice(encodeWav(samples, RING_SAMPLE_RATE))
      .then(async (verdict) => {
        if (!verdict.person_id) return;
        setVoiceNames((prev) => (prev[label] ? prev : { ...prev, [label]: verdict.person_id! }));
        /* the name has to be renderable: the card reads it out of the
           directory, so make sure the directory is loaded before the
           chip goes looking for it */
        if (people === null) {
          await api.directory().then(setPeople).catch(() => setPeople([]));
        }
      })
      .catch(() => undefined)          // a convenience that failed is not an error the take must show
      .finally(() => { matching.current = false; });
  }, [phase, s.captionRows, s.recordedMs, voiceNames, people]);

  /**
   * The voices we are willing to CALL voices, and what to call them.
   *
   * `s.liveSpeakers` is the raw truth from the wire — every label the
   * provider attached. What the screen shows is the subset with enough
   * evidence behind it (lib/liveSpeakers): a stray "Uh." at the top of a
   * take is not a second participant, and saying "2" when one person is
   * in the room is the screen lying about the room.
   */
  /*
   * THE TRANSCRIPT FOLLOWS THE SPEECH (user report, 2026-08-28: "the
   * transcription should show the latest, not need to scroll down"). Same
   * decision the assistant's thread uses, same helper: pinned at the bottom
   * → every new row keeps the newest words in view; scrolled UP to re-read
   * → no yank, because following and fighting are different behaviours.
   * The pin recomputes on the person's own scroll, so returning to the
   * bottom re-arms it.
   */
  const captionsRef = useRef<HTMLDivElement | null>(null);
  const captionsPinned = useRef(true);
  useEffect(() => {
    const box = captionsRef.current;
    if (box && captionsPinned.current) box.scrollTop = box.scrollHeight;
  }, [s.captionRows, s.captions?.interim]);

  const voices = establishedSpeakers(s.liveSpeakers, s.captionRows);
  const personFor = (label: string): Person | undefined => {
    const id = voiceNames[label];
    return id ? people?.find((candidate) => candidate.id === id) : undefined;
  };
  /** initials for the circle — the product's avatar since M24 */
  const initialsOf = (name: string): string =>
    name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0] ?? "").join("");
  function openNaming(label: string): void {
    setNamePick(voiceNames[label] ?? "");
    setNamingVoice(label);
    /* the directory is a member-visible read, so anybody recording can
       name a voice — unlike the account link, which is an admin's claim
       about who somebody IS */
    if (people === null) {
      void api.directory().then(setPeople).catch(() => setPeople([]));
    }
  }

  const waveBand = () => {
    const SLOTS = 96;
    const shown = s.wave.slice(-SLOTS);
    const pad = SLOTS - shown.length;
    const span = s.recordedMs - s.waveStartMs;
    const msPerSample = s.wave.length > 0 && span > 0 ? span / s.wave.length : 0;
    const visibleStartMs = s.recordedMs - shown.length * msPerSample;
    const windowSpan = s.recordedMs - visibleStartMs;
    /* the glow follows the LIVE level in three steps rather than
       continuously: a filter that changes every frame re-rasterises the
       whole scope, and nobody can see more than three steps of a halo */
    const glow = phase !== "recording" || s.level < 0.08 ? "0" : s.level < 0.35 ? "1" : "2";
    const values = Array.from({ length: SLOTS }, (_, i) =>
      Math.max(0.02, i < pad ? 0 : shown[i - pad]!));
    const lane = (kind: "up" | "down") => (
      <div className={`wave-lane wave-lane-${kind}`}>
        {values.map((v, i) => (
          <span
            key={i}
            className="wave-bar"
            style={{ "--v": v, "--age": (i / SLOTS).toFixed(3) } as React.CSSProperties}
          />
        ))}
      </div>
    );
    /*
     * THE RAIL is the whole take, not the window: 0:00 at the left, now at
     * the right, and the bright band marks the slice the wave above is
     * showing. As the take grows that marker narrows and slides right —
     * which is the "timer passing under it", and it is a real reading
     * rather than a decorative sweep. Before anything is recorded there is
     * nothing to mark, so the rail stays neutral.
     */
    const takeMs = Math.max(s.recordedMs, 1);
    const windowLeftPct = takeMs > 0 ? Math.max(0, (visibleStartMs / takeMs) * 100) : 0;
    return (
      <div className="mt-3" dir="ltr" aria-hidden>
        <div className="wave-scope h-28" data-glow={glow}>
          {s.wave.length === 0 ? <span className="wave-idle" /> : null}
          {lane("up")}
          {lane("down")}
          <span className="wave-grain" />
          {msPerSample > 0
            ? s.chapterMarks.map((ms, i) => {
                const denom = s.recordedMs - visibleStartMs;
                if (denom <= 0) return null;
                const frac = (ms - visibleStartMs) / denom;
                if (frac < 0 || frac > 1) return null;
                return (
                  <span
                    key={`c-${i}`}
                    className="absolute bottom-3 top-3 z-[4] w-0.5 rounded bg-warning"
                    style={{ left: `${frac * 100}%` }}
                  />
                );
              })
            : null}
          {/* NOW — the newest bar's edge, fading at both ends so it does
              not punch through the letterbox */}
          {s.wave.length > 0 ? (
            <span
              className="absolute bottom-1 right-0 top-1 z-[4] w-px"
              style={{
                background: "linear-gradient(180deg, transparent, rgb(var(--fg)) 14%, rgb(var(--fg)) 86%, transparent)",
              }}
            >
              <span className="absolute -top-0.5 right-1/2 h-2 w-2 translate-x-1/2 rounded-full bg-fg shadow-[0_0_10px_2px_rgb(var(--accent)/0.8)]" />
            </span>
          ) : null}
        </div>
        <div className="wave-rail">
          {s.recordedMs > 0 ? (
            <>
              <span
                className="wave-rail-past"
                style={{ clipPath: `inset(0 0 0 ${windowLeftPct}%)` }}
              />
              <span className="wave-rail-fill" style={{ width: "100%" }} />
            </>
          ) : null}
        </div>
        {windowSpan >= 5_000 ? (
          <div className="mt-1 flex select-none justify-between text-[10px] leading-none tabular-nums text-fg-subtle">
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
        {/* 2026-09-03: `.btn` is already inline-flex and already carries the
            reference's 15px padding — `px-4` was a sixteenth pixel this file
            picked on its own, and the redundant display class is what made it
            look deliberate. */}
        <Link href="/meetings" className="btn-secondary mt-4">
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
          hideCancel
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
          onCancel={() => {
            setStopAsk(false);
            /* dismissal = "keep recording": the take that stop paused
               picks up again, so the pause is invisible unless a decision
               was actually made */
            if (recorderSnapshot().phase === "paused") resume();
          }}
        />
      ) : null}
      {/* NAMING A LIVE VOICE (user ask, 2026-08-26). The directory is the
          list, because these are the people this org records; the hint is
          honest about the reach — this labels the live transcript, and the
          record's own attribution is decided after processing. */}
      {namingVoice !== null ? (
        <ConfirmDialog
          title={t("nameVoiceTitle", { n: digits(namingVoice, locale) })}
          body={
            <div className="space-y-3">
              <p className="text-sm text-fg-muted">{t("nameVoiceBody")}</p>
              <SelectMenu
                ariaLabel={t("nameVoicePick")}
                value={namePick}
                onChange={setNamePick}
                options={[
                  { value: "", label: t("nameVoiceNobody") },
                  ...(people ?? []).map((candidate) => ({
                    value: candidate.id,
                    label: candidate.linked_member_name
                      ? `${candidate.display_name} · ${candidate.linked_member_name}`
                      : candidate.display_name,
                  })),
                ]}
              />
              {people !== null && people.length === 0 ? (
                <p className="text-xs text-warning">{t("nameVoiceEmpty")}</p>
              ) : null}
            </div>
          }
          confirmLabel={t("nameVoiceSave")}
          cancelLabel={t("stopKeep")}
          danger={false}
          onConfirm={() => {
            const label = namingVoice;
            setVoiceNames((prev) => {
              const next = { ...prev };
              /* clearing is an answer: a voice named by mistake must be
                 un-nameable without reloading the page */
              if (namePick) next[label] = namePick;
              else delete next[label];
              return next;
            });
            setNamingVoice(null);
          }}
          onCancel={() => setNamingVoice(null)}
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

            WHY THESE FIVE KEEP THEIR OWN GEOMETRY (2026-09-03, and it is a
            worklist entry in control.guard.test.ts, not an oversight): the
            row is a purpose-drawn transport — 40px round satellites around a
            64px round record button — and it is a SET. Only three of its
            members answer to this file: the settings kebab hands its shape
            down as `triggerClassName`, and the mic and source pickers wear
            `SelectMenu variant="round"`, whose identical 40px round trigger
            lives in rowActions.tsx. So converting the three here would leave
            four round controls beside one 8px-cornered rectangle: the exact
            "ten different developers" symptom, in one row, on the product's
            centrepiece. Redrawing the transport is a design decision with the
            user, not a class-string edit — and the record button in
            particular is an instrument (it wears the Echo mark and the take's
            state, at a size the theme has no name for), not a labelled
            button.
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
                onClick={() => {
                  /* STOP stops (user report, 2026-08-26: it kept
                     recording while the dialog asked). The take pauses
                     the moment the question is asked — deciding whether
                     to keep a recording is not a reason to go on
                     capturing the room — and dismissing the dialog
                     resumes it, which is what "keep recording" means. */
                  if (phase === "recording") pause();
                  setStopAsk(true);
                }}
              >
                <span aria-hidden className="block h-5 w-5 rounded-[4px] bg-record" />
              </button>
            ) : (
              <button
                data-tour="rec-start"
                type="button"
                title={resuming ? t("resumeStart") : t("start")}
                aria-label={resuming ? t("resumeStart") : t("start")}
                className="tap grid h-16 w-16 place-items-center rounded-full bg-record text-white shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
                disabled={phase === "starting" || phase === "finishing"}
                onClick={() => start()}
              >
                {/* the ECHO MARK on the record button (user directive,
                    2026-08-26): the app's own mark, in the button's ink —
                    a ring and a dot, which is what a record button draws
                    anyway, so the brand and the affordance are one shape */}
                <EchoMark size={28} tone="current" />
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
                  noiseSuppression={noiseSuppression}
                  noiseLabel={t("noiseOption")}
                  noiseHint={t("noiseHint")}
                  onNoiseChange={setNoiseSuppression}
                  /* the constraint binds at getUserMedia — mid-take the box
                     would be a switch wired to nothing (the hint says so) */
                  noiseLocked={live}
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
                <div
                  ref={captionsRef}
                  onScroll={(scrollEvent) => {
                    captionsPinned.current = shouldStick(scrollEvent.currentTarget);
                  }}
                  className="scroll-quiet max-h-80 space-y-3 overflow-y-auto pe-1"
                >
                  {s.captionRows.map((row, i) => {
                    /* a label with too little behind it carries NO badge:
                       the words were said and stay, but we do not claim
                       they were somebody else (lib/liveSpeakers) */
                    const at = row.speaker ? voices.indexOf(row.speaker) : -1;
                    const tone = at >= 0 ? SPEAKER_TONE[at % SPEAKER_TONE.length]! : null;
                    const named = row.speaker ? personFor(row.speaker) : undefined;
                    return (
                      <div key={i} className="flex gap-3 text-sm leading-7">
                        <span className="ltr w-10 shrink-0 pt-0.5 text-end text-xs tabular-nums text-fg-subtle">
                          {formatClock(Math.floor(row.atMs / 1000), locale)}
                        </span>
                        {at >= 0 && row.speaker ? (
                          <span
                            /* .badge-num: the number sits on the circle's
                               CENTRE, not on its own baseline — the theme
                               rule, after this badge rendered visibly low
                               (user report, 2026-08-26) */
                            className={`badge-num mt-0.5 h-5 shrink-0 rounded-full border text-[10px] font-semibold ${
                              named ? "px-1.5" : "w-5"
                            } ${tone}`}
                            title={named
                              ? named.display_name
                              : t("speakerNamed", { n: digits(row.speaker, locale) })}
                          >
                            {named ? initialsOf(named.display_name) : digits(row.speaker, locale)}
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
          {/*
            THE RECORD'S NAME comes back (user directive, 2026-08-26: "on
            top of action items add a title box, as before"). It sits above
            the plan because that is the order the two get written: what
            this meeting IS, then what it has to cover.

            Empty is a real answer, not a missing one — the engine names an
            untitled take itself («جلسه ۳»), so the placeholder says what
            will happen rather than demanding a name. Editable only BEFORE
            the take: once a call exists its title belongs to the record,
            where one pencil renames it, and a second writable copy here
            would be two spellings of one fact.
          */}
          <div className="rounded-xl border border-border bg-surface p-3">
            <label className="block text-sm font-semibold text-fg" htmlFor="rec-title">
              {t("titleField")}
            </label>
            <input
              id="rec-title"
              dir="auto"
              /* 2026-09-03: `.input` answers the height, the padding and the
                 type size once. Four utilities re-answering it here is the
                 same drift one class down — the shape the connectors dropdown
                 was carrying (h-11 min-h-0 py-0 text-sm) the day it turned out
                 to be the one field on its page that did not match. */
              className="input mt-2"
              placeholder={t("titlePlaceholder")}
              value={title}
              disabled={live || phase === "finishing"}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

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
                  /* 2026-09-03: the theme's icon button, not a twelfth invented
                     size. This was already 28px and centred — every measurement
                     `.btn-icon` makes — written out by hand, so the only thing
                     that actually changes is that the corner now matches every
                     other icon button in the platform. `.btn` composes `.tap`. */
                  className="btn btn-icon text-fg-muted hover:bg-surface-2 hover:text-fg"
                  onClick={() => { addChapterMark(s.recordedMs); notify(t("marked")); }}
                >
                  <IconClock width={16} height={16} />
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
          {voices.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-sm font-semibold text-fg">{t("peopleTitle")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {voices.map((label, i) => {
                  const named = personFor(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      title={named ? named.display_name : t("nameVoiceHint")}
                      aria-label={named
                        ? named.display_name
                        : t("speakerNamed", { n: digits(label, locale) })}
                      onClick={() => openNaming(label)}
                      /* 2026-09-03: `.chip` — the theme's badge shape, which a
                         pressable one wears too (the hub's suggestion chips and
                         the skills page's tool toggles are both buttons in it).
                         The height stops being a number this file chose and
                         becomes what the 24px circle plus the chip's own
                         padding comes to, which is the same 32px it was.
                         `.tap` stays: 32px is under the 44px mobile floor and
                         `.chip` carries no hit area of its own. */
                      className={`tap chip border bg-surface-2 ps-1 pe-2.5 font-semibold transition-colors hover:bg-surface ${
                        SPEAKER_TONE[i % SPEAKER_TONE.length]
                      }`}
                    >
                      <span className="badge-num h-6 w-6 shrink-0 rounded-full bg-surface text-[10px]">
                        {named ? initialsOf(named.display_name) : digits(label, locale)}
                      </span>
                      <span className="max-w-28 truncate text-fg">
                        {named ? named.display_name : t("nameVoice")}
                      </span>
                    </button>
                  );
                })}
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
          <Link href="/meetings" className="btn-secondary">
            {t("goToCalls")}
          </Link>
          <button
            className="btn-primary ms-3"
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
  noiseSuppression,
  noiseLabel,
  noiseHint,
  onNoiseChange,
  noiseLocked,
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
  /** noise suppression — the other take-changing control; the meter's own
      stream opens with the same constraint so the bar previews the take */
  noiseSuppression: boolean;
  noiseLabel: string;
  noiseHint: string;
  onNoiseChange: (next: boolean) => void;
  /** true while a take is live: the constraint bound at acquisition */
  noiseLocked: boolean;
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
          // the take's own setting: a meter judged with suppression the
          // recording won't have is a preview of a different recording
          noiseSuppression,
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
    // reopen on a suppression change too — the constraint binds at open
  }, [micId, noiseSuppression]);
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
      {/* NOISE SUPPRESSION (user directive, 2026-08-28): the second control
          here that changes the take itself. Locked while a take is live —
          the constraint bound at getUserMedia, and an enabled box mid-take
          would claim an effect it cannot have (the hint carries the when). */}
      <label
        className={`flex items-start gap-1.5 text-[10px] leading-4 text-fg ${
          noiseLocked ? "opacity-60" : "cursor-pointer"
        }`}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={noiseSuppression}
          disabled={noiseLocked}
          onChange={(e) => onNoiseChange(e.target.checked)}
        />
        <span>
          {noiseLabel}
          <span className="block text-fg-subtle">{noiseHint}</span>
        </span>
      </label>
    </div>
  );
}
