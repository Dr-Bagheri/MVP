"use client";

/**
 * Dictation for the assistant composer — the mic button's actual job.
 *
 * Uses the browser's SpeechRecognition (Chrome/Edge; Google's recognizer
 * handles fa-IR). This is deliberately NOT Echo's pipeline: Echo records
 * calls into storage for transcription and summary; this turns a spoken
 * sentence into composer text and keeps nothing. Different promise,
 * different machinery.
 *
 * The absence taxonomy matters here (rule 12): "this browser cannot do
 * this" (unsupported), "the person said no" (denied), and "it stopped"
 * (idle) are three different nothings, and the button must not render
 * them as one.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type DictationStatus = "idle" | "listening" | "unsupported" | "denied";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?: () => void;
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function recognitionCtor(): (new () => RecognitionLike) | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => RecognitionLike)
    | undefined;
}

export function useDictation(
  lang: string,
  onText: (text: string) => void,
): { status: DictationStatus; toggle: () => void } {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const recRef = useRef<RecognitionLike | null>(null);
  // ref, not closure: onresult fires long after the render that created it,
  // and a stale onText would append into an input state that no longer exists
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const toggle = useCallback(() => {
    if (recRef.current) {
      recRef.current.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r?.isFinal) text += r[0].transcript;
      }
      if (text.trim()) onTextRef.current(text.trim());
    };
    rec.onerror = (e) => {
      setStatus(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "denied"
          : "idle",
      );
    };
    rec.onend = () => {
      recRef.current = null;
      // denied/unsupported must survive the end event — they are the message
      setStatus((s) => (s === "listening" ? "idle" : s));
    };
    recRef.current = rec;
    setStatus("listening");
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setStatus("idle");
    }
  }, [lang]);

  useEffect(
    () => () => {
      recRef.current?.abort?.();
    },
    [],
  );

  return { status, toggle };
}
