"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A smoothed 0–1 loudness for the Aurora orb (the spec's `useAudioLevel`):
 * works with a microphone MediaStream or an HTMLAudioElement (the M37
 * server-TTS playback), via AudioContext + AnalyserNode + RMS. All nodes
 * and frames are cleaned up when the source changes or the hook unmounts.
 *
 * One provider caveat, honored here: `createMediaElementSource` REROUTES
 * the element's audio, so the analyser chain must reconnect to the
 * destination or measuring the voice silences it.
 */

/** RMS of a time-domain byte buffer (128 = silence), normalized ~0–1. */
export function computeRms(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  // full-scale sine RMS ≈ 0.707 — scale so ordinary speech reads mid-range
  return Math.min(1, Math.sqrt(sum / samples.length) * 1.9);
}

export function useAudioLevel(source: MediaStream | HTMLAudioElement | null): number {
  const [level, setLevel] = useState(0);
  const smoothed = useRef(0);

  useEffect(() => {
    if (!source || typeof window === "undefined" || !("AudioContext" in window)) {
      smoothed.current = 0;
      setLevel(0);
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    let node: AudioNode;
    try {
      if (source instanceof MediaStream) {
        node = context.createMediaStreamSource(source);
        node.connect(analyser);
      } else {
        const mediaNode = context.createMediaElementSource(source);
        mediaNode.connect(analyser);
        analyser.connect(context.destination); // keep the voice audible
        node = mediaNode;
      }
    } catch {
      // an element can carry only ONE media source ever — a second hook on
      // the same element is a caller bug; degrade to silence, not a crash
      void context.close();
      return;
    }
    const buffer = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      const raw = computeRms(buffer);
      // asymmetric easing: react fast, decay gently — no jumping orb
      const weight = raw > smoothed.current ? 0.35 : 0.12;
      smoothed.current += (raw - smoothed.current) * weight;
      setLevel(Math.round(smoothed.current * 100) / 100);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      node.disconnect();
      analyser.disconnect();
      void context.close();
      smoothed.current = 0;
      setLevel(0);
    };
  }, [source]);

  return level;
}

/**
 * The graceful stand-in for sources the Web Audio API cannot measure
 * (speechSynthesis has no tappable stream): a slow eased breath, clearly
 * alive, never pretending to be a real waveform.
 */
export function useSyntheticPulse(active: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      setLevel(Math.round((0.35 + 0.25 * Math.sin(t * 2.4) * Math.sin(t * 0.9)) * 100) / 100);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return level;
}
