"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BOOST_GAIN } from "@/lib/recordingEngine";
import { playTestChime } from "@/lib/deviceTest";

/**
 * MIC & SPEAKER CHECK (user directive, 2026-08-25): "a microphone and
 * speaker test sound bar with volume".
 *
 * The mic half opens its OWN short-lived stream on the chosen device and
 * draws the live level — the only honest way to answer "is this the right
 * microphone, and can it hear me": a device NAME proves nothing, a moving
 * bar proves everything. The stream is released the moment the check stops,
 * so nothing holds the device before the take begins.
 *
 * The speaker half plays a soft two-tone chime through the CHOSEN output
 * (setSinkId where the browser has it) at the chosen volume — testing the
 * output on the default device would answer a question nobody asked.
 *
 * The gain slider and the enhance toggle are LIVE in the meter: what the
 * bar shows while you drag is what the recorder will receive, because both
 * apply the same multiplier the engine applies (BOOST_GAIN).
 */
export function DeviceCheck({
  micId,
  speakerId,
  boost,
  onBoostChange,
  gain,
  onGainChange,
}: {
  micId: string;
  speakerId: string;
  boost: boolean;
  onBoostChange: (next: boolean) => void;
  /** the mic's monitoring gain, 0.5–3 — the meter's own multiplier */
  gain: number;
  onGainChange: (next: number) => void;
}) {
  const t = useTranslations("capture");
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [micError, setMicError] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  /** everything the check opened, closed — an idle page holds no device */
  function stopListening(): void {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setLevel(0);
    setPeak(0);
    setListening(false);
  }
  useEffect(() => stopListening, []);
  /* the device changed under a running check — re-open on the new one */
  useEffect(() => {
    if (listening) {
      stopListening();
      void startListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- device swap only
  }, [micId]);

  async function startListening(): Promise<void> {
    setMicError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(micId ? { deviceId: { exact: micId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      setListening(true);
      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        // RMS → a 0–1 reading, then the SAME multipliers the recorder uses,
        // so the bar is a preview of the take rather than a decoration
        const rms = Math.sqrt(sum / buffer.length);
        const shown = Math.min(1, rms * 6 * gainRef.current * (boostRef.current ? BOOST_GAIN : 1));
        setLevel(shown);
        setPeak((p) => Math.max(shown, p * 0.94));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setMicError(true);
      setListening(false);
    }
  }

  /* read inside the animation frame without restarting it */
  const gainRef = useRef(gain);
  gainRef.current = gain;
  const boostRef = useRef(boost);
  boostRef.current = boost;

  /** one chime, shared with the speaker dropdown (lib/deviceTest) */
  async function testSpeaker(): Promise<void> {
    await playTestChime(speakerId, volume);
  }

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary h-9 min-h-0 px-3 text-xs"
          onClick={() => (listening ? stopListening() : void startListening())}
        >
          {listening ? t("micTestStop") : t("micTest")}
        </button>
        {/* the LEVEL — twenty segments, a decaying peak marker over them */}
        <span className="relative flex h-3 min-w-[10rem] flex-1 items-center gap-[3px]" aria-hidden>
          {Array.from({ length: 20 }, (_, i) => {
            const on = level * 20 > i;
            return (
              <span
                key={i}
                className={`h-full flex-1 rounded-sm transition-colors ${
                  on
                    ? i > 16 ? "bg-danger" : i > 12 ? "bg-warning" : "bg-success"
                    : "bg-surface-2"
                }`}
              />
            );
          })}
          {peak > 0.02 ? (
            <span
              className="absolute top-0 h-full w-0.5 rounded bg-fg/70"
              style={{ insetInlineStart: `${Math.min(99, peak * 100)}%` }}
            />
          ) : null}
        </span>
        <span className="text-xs text-fg-muted">
          {listening
            ? level > 0.02 ? t("micHears") : t("micSilent")
            : micError ? t("micTestFailed") : ""}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="w-24 shrink-0">{t("micGain")}</span>
          <input
            type="range"
            dir="ltr"
            className="flex-1 accent-accent"
            min={0.5}
            max={3}
            step={0.1}
            value={gain}
            onChange={(e) => onGainChange(Number(e.target.value))}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary h-9 min-h-0 px-3 text-xs"
            onClick={() => void testSpeaker()}
          >
            {t("speakerTest")}
          </button>
          <input
            type="range"
            dir="ltr"
            className="flex-1 accent-accent"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label={t("speakerVolume")}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </div>
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-6 text-fg">
        <input
          type="checkbox"
          className="mt-1.5"
          checked={boost}
          onChange={(e) => onBoostChange(e.target.checked)}
        />
        <span>
          {t("boostOption")}
          <span className="block text-fg-muted">{t("boostHint")}</span>
        </span>
      </label>
    </div>
  );
}
