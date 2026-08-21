"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { announceRecordingLive } from "@/lib/assistantBus";
import { PartUploader, type UploaderProgress } from "@/lib/callUpload";
import { Card, Chip, Field, Progress } from "@/components/ui";
import { Link } from "@/i18n/routing";
import { digits, formatClock } from "@/lib/format";
import { PART_MS, resumePoint } from "./uploadRules";
import { recorderControls } from "./recorderControls";

/**
 * The browser recorder — Part 5's centrepiece, and the first REAL producer
 * on the upload wire (the mock it replaces invented its level meter from
 * `Math.random()` and recorded nothing).
 *
 * What it actually does now:
 *  - **Microphone picker** from `enumerateDevices` (labels appear after the
 *    permission grant — the browser's rule, so the list refreshes then).
 *  - **Level meter** from an `AnalyserNode` reading the live stream: RMS of
 *    the time-domain signal, throttled to ~12 fps. It shows the SIGNAL, so
 *    a dead mic reads as a flat meter before it costs anyone a meeting
 *    (rule 7's spirit at the UI: positive detection, visible silence).
 *  - **Pause/resume** via `MediaRecorder.pause()` — paused time is not
 *    recorded and not counted; the clock is RECORDED time.
 *  - **30-minute parts** (M2/M7): at each boundary the current recorder is
 *    stopped (its blob uploads immediately: sign → PUT → register) and a
 *    fresh one starts on the same stream. Each part is a complete,
 *    independently decodable container — slicing one long stream would
 *    yield chunks only the first of which can be decoded.
 *  - **Finish** stops the last part, waits behind the upload barrier, and
 *    only then flips the call to `processing`. A failed part BLOCKS finish
 *    with its bytes kept and a retry control — a call finished with a
 *    missing part would transcribe with a silent hole (M21: never the
 *    user's data).
 *  - **Speaker picker** drives playback of the finished parts via
 *    `setSinkId` — preview is where an output device choice has meaning.
 */

type Phase = "idle" | "starting" | "recording" | "paused" | "finishing" | "done" | "failed";

interface DeviceOption {
  id: string;
  label: string;
}

export function Recorder({ onFinished }: { onFinished?: () => void }) {
  const t = useTranslations("capture");
  const locale = useLocale();

  const [phase, setPhase] = useState<Phase>("idle");
  const [title, setTitle] = useState("");
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [speakers, setSpeakers] = useState<DeviceOption[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [speakerId, setSpeakerId] = useState<string>("");
  const [level, setLevel] = useState(0);
  const [recordedMs, setRecordedMs] = useState(0);
  const [progress, setProgress] = useState<UploaderProgress>({ done: 0, pending: 0, failed: 0 });
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<{ idx: number; url: string }[]>([]);
  /**
   * RESUME mode (user directive, 2026-08-20): a call left unfinished — the
   * person navigated away, closed the tab, or paused and left — shows as
   * paused in the Calls table, and its Resume action lands here with
   * `?resume=<id>`. Recording then CONTINUES on the same call: same id, the
   * next part index, the offset where the audio actually ends. `null` =
   * fresh-recording mode; "loading" while the call is fetched; "gone" when
   * the id can no longer be resumed (finished meanwhile, or not theirs).
   */
  const [resumeTarget, setResumeTarget] = useState<
    | null
    | "loading"
    | "gone"
    | { callId: string; title: string | null; nextIdx: number; offsetMs: number }
  >(null);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const uploader = useRef<PartUploader | null>(null);
  const callId = useRef<string | null>(null);
  /**
   * M38 — live captions while recording: a SECOND MediaRecorder taps the
   * same stream in 1s slices and posts them to the relay; captions ride
   * back as SSE. Independent of the part recorder on purpose — the upload
   * pipeline's 30-minute part math must never share a recorder with a
   * best-effort caption lane. `captions === null` = lane off (unavailable
   * or not started); "" finals with "" interim = on and listening.
   */
  const [captions, setCaptions] = useState<{ finals: string; interim: string } | null>(null);
  const [captionsDown, setCaptionsDown] = useState(false);
  const liveId = useRef<string | null>(null);
  const liveRec = useRef<MediaRecorder | null>(null);
  const liveEs = useRef<EventSource | null>(null);
  const liveFinals = useRef("");

  async function startLiveCaptions(mime: string): Promise<void> {
    try {
      const { session_id } = await api.liveSttStart();
      liveId.current = session_id;
    } catch {
      // the lane is optional; its ABSENCE is said out loud (M21), once
      setCaptionsDown(true);
      return;
    }
    liveFinals.current = "";
    setCaptions({ finals: "", interim: "" });
    setCaptionsDown(false);
    const rec = new MediaRecorder(stream.current!, { mimeType: mime });
    rec.ondataavailable = (event) => {
      if (event.data.size > 0 && liveId.current) {
        void api.liveSttAudio(liveId.current, event.data).catch(() => undefined);
      }
    };
    rec.start(1000);
    liveRec.current = rec;
    const es = new EventSource(`/api/live-stt/${encodeURIComponent(liveId.current)}/events`);
    es.onmessage = (event) => {
      try {
        const body = JSON.parse(event.data as string) as {
          type: string;
          tokens?: { text: string; is_final: boolean }[];
        };
        if (body.type === "closed" || body.type === "error") {
          es.close();
          if (body.type === "error") setCaptionsDown(true);
          return;
        }
        if (body.type === "tokens" && body.tokens) {
          const finalText = body.tokens.filter((t) => t.is_final).map((t) => t.text).join("");
          const interim = body.tokens.filter((t) => !t.is_final).map((t) => t.text).join("");
          if (finalText) liveFinals.current += finalText;
          setCaptions({ finals: liveFinals.current, interim });
        }
      } catch { /* not a caption frame */ }
    };
    liveEs.current = es;
  }

  function stopLiveCaptions(): void {
    if (liveRec.current && liveRec.current.state !== "inactive") liveRec.current.stop();
    liveRec.current = null;
    if (liveId.current) void api.liveSttStop(liveId.current).catch(() => undefined);
    liveId.current = null;
    // leave the EventSource open briefly — the provider flushes finals on
    // stop; the relay's `closed` event (or its idle reaper) ends it
    const es = liveEs.current;
    liveEs.current = null;
    if (es) setTimeout(() => es.close(), 5000);
  }
  const audioCtx = useRef<AudioContext | null>(null);
  const meterRaf = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTick = useRef<number>(0);
  const recordedRef = useRef<number>(0);
  const partStartMs = useRef<number>(0);
  const partIdx = useRef<number>(0);
  const mimeType = useRef<string>("audio/webm");
  const previewEl = useRef<HTMLAudioElement>(null);
  /** Resolved by `onstop` AFTER it has enqueued (or skipped) its part. */
  const flushDone = useRef<(() => void) | null>(null);
  /** Parts actually handed to the uploader — zero means nothing to finish. */
  const partsEnqueued = useRef<number>(0);
  /** Resume adopts a call that already HAS parts: finishing with zero NEW
   *  parts is then legitimate (they came back just to press finish). */
  const priorParts = useRef<boolean>(false);

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

  // teardown on unmount — the recorder must not outlive its screen
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      cancelAnimationFrame(meterRaf.current);
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      if (liveRec.current && liveRec.current.state !== "inactive") liveRec.current.stop();
      liveEs.current?.close();
      if (liveId.current) void api.liveSttStop(liveId.current).catch(() => undefined);
      stream.current?.getTracks().forEach((track) => track.stop());
      void audioCtx.current?.close();
    },
    [],
  );

  /**
   * Leaving does not lose a take — it PAUSES it (user directive, 2026-08-20,
   * revised same day from a stay-on-page guard to the resume model): an
   * unfinished call shows as paused in the Calls table and continues from
   * where the audio ends via its Resume action. So navigation is free —
   * the unmount teardown stops the recorder, which flushes and uploads the
   * current part. Two listeners remain:
   *  - tab hidden (switch/minimize) → pause: the mic must not keep rolling
   *    while nobody is looking. No auto-resume — splicing an absence into a
   *    take is a decision, not a default.
   *  - tab close / hard reload → the browser's leave prompt: unlike in-app
   *    navigation, a closing tab cannot flush the current part, so up to
   *    the current part's audio would be lost silently. The prompt is the
   *    honest cost sentence; everything already uploaded stays resumable.
   */
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    if (phase !== "recording") return;
    const onVisibility = () => {
      if (document.hidden && phaseRef.current === "recording") pause();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (phaseRef.current === "recording") pause();
      e.preventDefault();
      // older Chrome shows the prompt only when returnValue is set
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [phase]);

  /**
   * M33: publish the live controls for the agent surface — the SAME
   * functions the buttons call — while a take is live; clear on change.
   * The agent's pause/resume tools reach these or get an honest refusal.
   */
  useEffect(() => {
    if (phase === "recording" || phase === "paused") {
      recorderControls.current = {
        phase: () => (phaseRef.current === "recording" ? "recording"
          : phaseRef.current === "paused" ? "paused" : "other"),
        pause,
        resume,
        finish,
      };
      // the assistant's ears follow the take (user rule, 2026-08-21):
      // rolling = assistant deaf and closed; paused/finished = ears back
      announceRecordingLive(phase === "recording");
      return () => {
        recorderControls.current = null;
        announceRecordingLive(false);
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /**
   * M33: `?agentStart=<title>` — the agent's start_recording lands here and
   * the recorder starts itself through its OWN start() (the human path,
   * M33 rule 2: no parallel implementation). Once only (the ref): React
   * StrictMode double-fires effects in dev, and two starts would race
   * getUserMedia against itself.
   */
  const agentStarted = useRef(false);
  useEffect(() => {
    if (agentStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    const agentTitle = params.get("agentStart");
    if (agentTitle === null || params.get("resume")) return;
    agentStarted.current = true;
    setTitle(agentTitle);
    // the title rides as an argument — reading it back from state here would
    // be the stale-closure trap (this render's `title` is still empty)
    void start(agentTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot adoption
  }, []);

  /**
   * Adopt the resume target from the URL. Read from `location.search` in an
   * effect, deliberately NOT `useSearchParams()` — that hook forces a
   * prerender bailout that broke the production build once already (the
   * hub's Suspense failure). Guarded: only a call still in `recording`
   * status is resumable — anything else gets the honest "gone" screen
   * rather than a recorder that would upload into a finished call.
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
   * One complete part-recorder on the shared stream. `idx`/`offsetMs` and
   * the chunk list are CLOSED OVER, not shared refs: at a part boundary the
   * next recorder starts before the old one's `onstop` has fired, and a
   * shared chunks array would be reset under the old recorder's feet — the
   * whole part silently lost while the meter kept moving.
   */
  function startPartRecorder(idx: number, offsetMs: number): void {
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4"; // Safari
    mimeType.current = mime.split(";")[0]!;
    const localChunks: BlobPart[] = [];
    const rec = new MediaRecorder(stream.current!, {
      mimeType: mime,
      audioBitsPerSecond: 48_000,
    });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) localChunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(localChunks, { type: mimeType.current });
      if (blob.size > 0) {
        setPreviews((prev) => [...prev, { idx, url: URL.createObjectURL(blob) }]);
        uploader.current?.enqueue({
          idx,
          offsetMs,
          blob,
          contentType: mimeType.current,
        });
        partsEnqueued.current += 1;
      }
      /*
       * ALWAYS resolve the flush, even for an empty tail — and only AFTER
       * the enqueue above. `finish()` awaits this before settling the
       * upload barrier: `stop()` returns before `onstop` fires, so without
       * the handshake the barrier settled on an EMPTY queue ("clean",
       * vacuously), the call flipped to processing, and the only part
       * arrived too late to a call that no longer accepts audio. Both live
       * "stuck at processing" calls were exactly this — zero parts, ever.
       */
      flushDone.current?.();
      flushDone.current = null;
    };
    recorder.current = rec;
    rec.start();
  }

  /** RMS level meter on the live stream — the real signal, not a die roll. */
  function startMeter(): void {
    const ctx = new AudioContext();
    audioCtx.current = ctx;
    const source = ctx.createMediaStreamSource(stream.current!);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let last = 0;
    const loop = (now: number) => {
      meterRaf.current = requestAnimationFrame(loop);
      if (now - last < 80) return; // ~12fps is plenty for a meter
      last = now;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const centered = (data[i]! - 128) / 128;
        sum += centered * centered;
      }
      // RMS of speech sits low; the sqrt-of-RMS curve spreads it over the bar
      setLevel(Math.min(1, Math.sqrt(Math.sqrt(sum / data.length)) * 1.4));
    };
    meterRaf.current = requestAnimationFrame(loop);
  }

  async function start(titleOverride?: string): Promise<void> {
    setError(null);
    setPhase("starting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(micId ? { deviceId: { exact: micId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch {
      setPhase("idle");
      setError(t("micDenied"));
      return;
    }
    await refreshDevices(); // labels exist now that permission does
    const resuming = typeof resumeTarget === "object" && resumeTarget !== null;
    if (resuming) {
      // RESUME: the call exists — adopt it and continue after its last audio
      callId.current = resumeTarget.callId;
    } else {
      try {
        const created = await api.createCall({
          title: (titleOverride ?? title).trim() || undefined,
          source: "web",
        });
        callId.current = created.id;
      } catch {
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = null;
        setPhase("idle");
        setError(t("createFailed"));
        return;
      }
    }
    uploader.current = new PartUploader(api, callId.current, setProgress);
    /* on resume the clock and part math START at the existing audio's end,
       so the person sees the take's TOTAL time and the next part lands with
       the next index at the right offset — resumePoint's two guarantees */
    const base = resuming ? resumeTarget : { nextIdx: 0, offsetMs: 0 };
    priorParts.current = resuming && base.nextIdx > 0;
    recordedRef.current = base.offsetMs;
    partStartMs.current = base.offsetMs;
    partIdx.current = base.nextIdx;
    partsEnqueued.current = 0;
    setRecordedMs(base.offsetMs);
    setPreviews([]);
    startMeter();
    startPartRecorder(base.nextIdx, base.offsetMs);
    // best-effort live captions on the same stream (M38) — failure is a
    // visible note, never a blocked recording
    void startLiveCaptions(
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    );
    lastTick.current = Date.now();
    timer.current = setInterval(() => {
      // the clock counts RECORDED time: it advances only while recording
      if (recorder.current?.state === "recording") {
        const now = Date.now();
        recordedRef.current += now - lastTick.current;
        lastTick.current = now;
        setRecordedMs(recordedRef.current);
        // the 30-minute boundary rolls the part: stop uploads it, a fresh
        // recorder continues on the same stream (M2's split, recorded time)
        if (recordedRef.current - partStartMs.current >= PART_MS) {
          recorder.current.stop();
          partIdx.current += 1;
          partStartMs.current = recordedRef.current;
          startPartRecorder(partIdx.current, partStartMs.current);
        }
      } else {
        lastTick.current = Date.now();
      }
    }, 500);
    setPhase("recording");
  }

  function pause(): void {
    if (recorder.current?.state === "recording") {
      recorder.current.pause();
      if (liveRec.current?.state === "recording") liveRec.current.pause();
      setPhase("paused");
    }
  }

  function resume(): void {
    if (recorder.current?.state === "paused") {
      recorder.current.resume();
      if (liveRec.current?.state === "paused") liveRec.current.resume();
      lastTick.current = Date.now();
      setPhase("recording");
    }
  }

  async function finish(): Promise<void> {
    setPhase("finishing");
    stopLiveCaptions();
    if (timer.current) clearInterval(timer.current);
    cancelAnimationFrame(meterRaf.current);
    setLevel(0);
    // WAIT for onstop to enqueue the final part before settling the barrier
    // (the handshake described on onstop; stop() alone returns too early)
    await new Promise<void>((resolve) => {
      if (!recorder.current || recorder.current.state === "inactive") {
        resolve();
        return;
      }
      flushDone.current = resolve;
      recorder.current.stop();
    });
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audioCtx.current?.close();
    audioCtx.current = null;

    if (partsEnqueued.current === 0 && !priorParts.current) {
      // no audio ever reached the uploader — finishing would create a call
      // stuck at "processing" forever, with nothing for the pipeline to do
      setPhase("failed");
      setError(t("nothingRecorded"));
      return;
    }

    const settled = await uploader.current!.settle();
    if (!settled.clean) {
      // finish is BLOCKED: a call flipped to processing with a missing part
      // would transcribe around a silent hole. The bytes are kept.
      setPhase("failed");
      return;
    }
    try {
      await api.finishCall(callId.current!);
    } catch {
      setPhase("failed");
      setError(t("finishFailed"));
      return;
    }
    setPhase("done");
    onFinished?.();
  }

  async function retryUploads(): Promise<void> {
    if (partsEnqueued.current === 0) {
      // nothing was ever recorded — there is nothing to retry; start over
      setPhase("idle");
      setError(null);
      return;
    }
    setPhase("finishing");
    setError(null);
    uploader.current!.retryFailed();
    const settled = await uploader.current!.settle();
    if (!settled.clean) {
      setPhase("failed");
      return;
    }
    try {
      await api.finishCall(callId.current!);
      setPhase("done");
      onFinished?.();
    } catch {
      setPhase("failed");
      setError(t("finishFailed"));
    }
  }

  // the preview element follows the chosen output device (setSinkId is the
  // one place a speaker choice has meaning in a recorder)
  useEffect(() => {
    const el = previewEl.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && speakerId) void el.setSinkId(speakerId).catch(() => undefined);
  }, [speakerId, previews]);

  const live = phase === "recording" || phase === "paused";
  const recordedSec = Math.floor(recordedMs / 1000);
  const inPartMs = recordedMs - partStartMs.current;
  const partNo = partIdx.current + 1;

  const resuming = typeof resumeTarget === "object" && resumeTarget !== null;

  if (resumeTarget === "loading") {
    return (
      <Card className="max-w-2xl">
        <p className="text-sm text-fg-muted">{t("resumeLoading")}</p>
      </Card>
    );
  }
  if (resumeTarget === "gone") {
    return (
      <Card className="max-w-2xl">
        <p className="text-sm text-fg-muted">{t("resumeGone")}</p>
        <Link href="/echo/records" className="btn-secondary mt-4 inline-flex px-4">
          {t("resumeBackToCalls")}
        </Link>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl">
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
          <Field label={t("titleField")}>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
              /* on resume the call already has its name — renames live in the
                 Calls table, and a silently-ignored edit here would be a
                 control that reads as wired and does nothing */
              disabled={resuming}
            />
          </Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t("micField")}>
              <select className="input" value={micId} onChange={(e) => setMicId(e.target.value)}>
                {mics.length === 0 ? <option value="">{t("micDefault")}</option> : null}
                {mics.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("speakerField")}>
              <select
                className="input"
                value={speakerId}
                onChange={(e) => setSpeakerId(e.target.value)}
              >
                {speakers.length === 0 ? <option value="">{t("speakerDefault")}</option> : null}
                {speakers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button
            className="btn-primary mt-5 h-12 px-6"
            disabled={phase === "starting"}
            onClick={() => void start()}
          >
            {phase === "starting" ? t("starting") : resuming ? t("resumeStart") : t("start")}
          </button>
        </>
      ) : null}

      {live || phase === "finishing" ? (
        <>
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

          {/* live input-level meter — the REAL signal */}
          <div className="mt-4 flex h-8 items-end gap-1" dir="ltr" aria-hidden>
            {Array.from({ length: 28 }).map((_, i) => {
              const active = phase === "recording" && level > i / 28;
              return (
                <span
                  key={i}
                  className={`w-full rounded-sm transition-all ${
                    active ? "bg-accent" : "bg-surface-2"
                  }`}
                  style={{ height: active ? `${30 + (i % 5) * 12}%` : "18%" }}
                />
              );
            })}
          </div>

          {/* M38: live captions — the relay's rolling transcript. Interim
              words render muted; finals accumulate. Absence says so. */}
          {captions !== null ? (
            <div className="mt-4 rounded-md border border-border bg-surface p-3">
              <p className="text-xs font-semibold text-fg-subtle">{t("liveTitle")}</p>
              <p dir="auto" className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-fg">
                {captions.finals === "" && captions.interim === "" ? (
                  <span className="text-fg-muted">{t("liveWaiting")}</span>
                ) : (
                  <>
                    {captions.finals}
                    <span className="text-fg-muted">{captions.interim}</span>
                  </>
                )}
              </p>
            </div>
          ) : captionsDown ? (
            <p className="mt-4 text-xs text-fg-muted">{t("liveUnavailable")}</p>
          ) : null}

          {/* 30-minute part indicator (M7) */}
          <div className="mt-4 rounded-md bg-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-fg">
                {t("currentPart", {
                  n: digits(partNo, locale),
                  time: formatClock(Math.floor(inPartMs / 1000), locale),
                })}
              </span>
              <Chip tone="info">
                {formatClock(Math.max(0, Math.floor((PART_MS - inPartMs) / 1000)), locale)}
              </Chip>
            </div>
            <Progress value={Math.min(100, (inPartMs / PART_MS) * 100)} />
            <p className="mt-2 text-xs leading-6 text-fg-muted">{t("partNotice")}</p>
          </div>

          {progress.done + progress.pending + progress.failed > 0 ? (
            <p className="mt-3 text-xs text-fg-muted">
              {t("uploadProgress", {
                done: digits(progress.done, locale),
                pending: digits(progress.pending, locale),
              })}
            </p>
          ) : null}

          {live ? (
            <div className="mt-5 flex flex-wrap gap-3">
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
            </div>
          ) : null}
        </>
      ) : null}

      {phase === "done" ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-success">
            <Chip tone="success">{t("finishedChip")}</Chip>
            {t("finishedBody", { parts: digits(Math.max(1, progress.done), locale) })}
          </p>
          {previews[0] ? (
            <div>
              <p className="mb-1 text-xs text-fg-muted">{t("previewLabel")}</p>
              {/* one element, sink follows the speaker picker */}
              <audio ref={previewEl} controls src={previews[0].url} className="w-full" />
            </div>
          ) : null}
          <Link href="/echo/records" className="btn-secondary inline-flex">
            {t("goToCalls")}
          </Link>
          <button
            className="btn-primary ms-3 inline-flex"
            onClick={() => {
              setPhase("idle");
              setTitle("");
              setProgress({ done: 0, pending: 0, failed: 0 });
            }}
          >
            {t("recordAnother")}
          </button>
        </div>
      ) : null}

      {phase === "failed" ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-danger">
            {error ??
              t("uploadFailedBody", { failed: digits(progress.failed, locale) })}
          </p>
          <button className="btn-primary" onClick={() => void retryUploads()}>
            {t("retryUploads")}
          </button>
        </div>
      ) : null}

      {phase === "idle" && error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
