"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { PartUploader, type UploaderProgress } from "@/lib/callUpload";
import { Card, Chip, Field, Progress } from "@/components/ui";
import { Link } from "@/i18n/routing";
import { digits, formatClock } from "@/lib/format";
import { PART_MS } from "./uploadRules";

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

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const uploader = useRef<PartUploader | null>(null);
  const callId = useRef<string | null>(null);
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
      stream.current?.getTracks().forEach((track) => track.stop());
      void audioCtx.current?.close();
    },
    [],
  );

  /**
   * A live recording must not keep rolling while nobody is looking (user
   * directive, 2026-08-20): leaving the tab, closing it, or navigating to
   * another section PAUSES the take instead of silently recording a wall.
   *
   * Three doors, three guards:
   *  - tab hidden (switch/minimize) → pause. No auto-resume: coming back
   *    and pressing resume is a decision, and an automatic one would splice
   *    an absence into the take without anyone choosing it.
   *  - tab close / hard reload → the browser's own leave prompt (and a
   *    best-effort pause, so cancelling the leave lands on a paused take).
   *  - IN-APP navigation → the first click on any link pauses and stays
   *    (App Router has no cancellable route event, so the guard is a
   *    capture-phase click listener). While PAUSED the guard is off: the
   *    second, deliberate click leaves — the unmount teardown stops the
   *    recorder, which flushes and uploads everything captured so far.
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
    const onClickCapture = (e: MouseEvent) => {
      if (phaseRef.current !== "recording") return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      e.preventDefault();
      e.stopPropagation();
      pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [phase]);

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

  async function start(): Promise<void> {
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
    try {
      const created = await api.createCall({
        title: title.trim() || undefined,
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
    uploader.current = new PartUploader(api, callId.current, setProgress);
    recordedRef.current = 0;
    partStartMs.current = 0;
    partIdx.current = 0;
    partsEnqueued.current = 0;
    setRecordedMs(0);
    setPreviews([]);
    startMeter();
    startPartRecorder(0, 0);
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
      setPhase("paused");
    }
  }

  function resume(): void {
    if (recorder.current?.state === "paused") {
      recorder.current.resume();
      lastTick.current = Date.now();
      setPhase("recording");
    }
  }

  async function finish(): Promise<void> {
    setPhase("finishing");
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

    if (partsEnqueued.current === 0) {
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

  return (
    <Card className="max-w-2xl">
      {phase === "idle" || phase === "starting" ? (
        <>
          <Field label={t("titleField")}>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
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
            {phase === "starting" ? t("starting") : t("start")}
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
          <Link href="/echo/calls" className="btn-secondary inline-flex">
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
