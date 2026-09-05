"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call, Speaker, TranscriptSegment } from "@/api/types";
import { IconCheck, IconMic, IconMicOff, IconPlay, IconPause } from "@/components/icons";
import { digits, formatClock } from "@/lib/format";

/**
 * بازبینی — the reference's review surface, on Echo's real artifacts:
 *
 *   · mid-pipeline: the staged processing card (the call-status ladder
 *     wearing the reference's four step labels — the screen cannot
 *     disagree with the worker, because the status IS the steps);
 *   · ready: the audio player bar, the full TRANSCRIPT (speaker, time,
 *     text — a click seeks the audio there), and the EXTRACTION panel —
 *     the summary's own sections (مصوبات / اکشن‌آیتم‌ها / خلاصه / …)
 *     sliced by their headings, never invented: a section the summary
 *     does not carry renders as its named absence.
 */

const LADDER = ["recording", "processing", "linking", "summarizing", "ready"] as const;
const STEP_KEYS = ["upload", "transcribe", "diarize", "extract"] as const;

function ladderIndex(status: string): number {
  const at = (LADDER as readonly string[]).indexOf(status);
  /* an unknown status is a NEWER pipeline, not a broken one — treat as
     mid-processing and let the raw word show beside the card */
  return at === -1 ? 1 : at;
}

export function ProcessingCard({ call, title, locale }: {
  call: Call; title: string; locale: string;
}) {
  const t = useTranslations("meetings");
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
            <li key={key}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${state === "active" ? "bg-accent-soft" : ""}`}>
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${
                  state === "done" ? "bg-accent text-on-accent"
                    : state === "active" ? "border-2 border-accent text-accent"
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
              {state === "done" ? <span className="shrink-0 text-[11px] text-accent">{t("stepDone")}</span>
                : state === "active" ? <span className="shrink-0 text-[11px] text-accent">{t("stepActive")}</span>
                  : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all duration-700"
          style={{ width: `${Math.round(((at + 0.5) / STEP_KEYS.length) * 100)}%` }} />
      </div>
      <p className="mt-3 text-center text-[11px] leading-5 text-fg-subtle">{t("processingNote")}</p>
    </div>
  );
}

/* ── the AUDIO bar: one continuous player over the call's parts ────────── */
const SPEEDS = [1, 1.25, 1.5, 2] as const;
/** how many bars the waveform draws — the reference's strip is ~140 wide */
const PEAK_COUNT = 140;

/**
 * Decode one part and reduce it to PEAK_COUNT amplitudes in [0,1].
 *
 * Client-side on purpose, for now: it needs no server work and no ffmpeg on
 * the box, and a meeting's first part is what people scrub. The honest cost
 * is memory — a 30-minute part decodes to ~300MB of PCM — so only the FIRST
 * part is decoded and the rest of the strip is drawn flat. Peaks computed by
 * the worker at transcode time (one small array per part, stored beside the
 * timings) are the right next step; this is the version that ships today and
 * says so.
 */
async function peaksOf(url: string): Promise<Float32Array | null> {
  try {
    const buf = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null));
    if (buf === null) return null;
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(buf);
    void ctx.close();
    const data = audio.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / PEAK_COUNT));
    const out = new Float32Array(PEAK_COUNT);
    let max = 0;
    for (let i = 0; i < PEAK_COUNT; i += 1) {
      let peak = 0;
      const from = i * per;
      for (let j = from; j < from + per && j < data.length; j += 8) {
        const v = Math.abs(data[j] ?? 0);
        if (v > peak) peak = v;
      }
      out[i] = peak;
      if (peak > max) max = peak;
    }
    /* normalise so a quiet room still draws a readable strip */
    if (max > 0) for (let i = 0; i < PEAK_COUNT; i += 1) out[i] = (out[i] ?? 0) / max;
    return out;
  } catch {
    return null;
  }
}

export function AudioBar({ callId, seekTo, locale, durationMs = null }: {
  callId: string;
  /** an external seek request (a transcript row's timestamp) — a FRESH
      object per click, so repeating a timestamp still seeks */
  seekTo: { ms: number } | null;
  locale: string;
  /** the call's total, from the wire — null renders as "—", never as 0:00,
      because "we do not know how long" is not "it is empty" */
  durationMs?: number | null;
}) {
  const t = useTranslations("meetings");
  const [parts, setParts] = useState<{ idx: number; offset_ms: number; url: string }[] | null | "absent">(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePart = useRef(0);

  const resigning = useRef(false);
  useEffect(() => {
    let alive = true;
    void api.getCallAudio(callId)
      .then((r) => { if (alive) setParts(r === null ? "absent" : [...r.parts].sort((a, b) => a.idx - b.idx)); })
      .catch(() => { if (alive) setParts("absent"); });
    return () => { alive = false; };
  }, [callId]);

  /* the waveform, once the first part's URL is known */
  useEffect(() => {
    if (!Array.isArray(parts) || parts[0] === undefined) return;
    let alive = true;
    void peaksOf(parts[0].url).then((p) => { if (alive) setPeaks(p); });
    return () => { alive = false; };
  }, [parts]);

  /* the speed follows the element — and re-applies after a part switch or a
     re-sign, because a fresh `src` resets playbackRate to 1 */
  useEffect(() => {
    const audio = audioRef.current;
    if (audio !== null) audio.playbackRate = speed;
  }, [speed, parts]);

  const total = durationMs !== null && durationMs > 0 ? durationMs : null;

  /* draw: played bars in the accent, the rest muted; the canvas is redrawn
     on every position tick, which at 140 bars is nothing */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const styles = getComputedStyle(canvas);
    const accent = `rgb(${styles.getPropertyValue("--accent").trim()})`;
    const muted = `rgb(${styles.getPropertyValue("--fg-subtle").trim()} / 0.45)`;
    const played = total === null ? 0 : Math.min(1, posMs / total);
    const gap = 1.5;
    const bar = Math.max(1, (w - gap * (PEAK_COUNT - 1)) / PEAK_COUNT);
    /* the layout is DIRECTION-AGNOSTIC on purpose: audio time runs one way in
       every language, so the strip is drawn start→end and the whole bar
       wears dir="ltr" below */
    for (let i = 0; i < PEAK_COUNT; i += 1) {
      const amp = peaks === null ? 0.18 : Math.max(0.08, peaks[i] ?? 0);
      const bh = Math.max(2, amp * (h - 4));
      const x = i * (bar + gap);
      ctx.fillStyle = i / PEAK_COUNT <= played ? accent : muted;
      ctx.fillRect(x, (h - bh) / 2, bar, bh);
    }
  }, [peaks, posMs, total]);

  /** the signed URLs live ~an hour; a media error on a long-open page gets
      ONE fresh signing per incident, resuming where it died */
  const resign = () => {
    if (resigning.current) return;
    resigning.current = true;
    const resumeAt = posMs;
    void api.getCallAudio(callId).then((r) => {
      resigning.current = false;
      if (r === null) { setParts("absent"); return; }
      const fresh = [...r.parts].sort((a, b) => a.idx - b.idx);
      setParts(fresh);
      const audio = audioRef.current;
      const part = fresh[activePart.current];
      if (audio !== null && part !== undefined) {
        audio.src = part.url;
        audio.currentTime = Math.max(0, (resumeAt - part.offset_ms) / 1000);
        void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    }).catch(() => { resigning.current = false; setPlaying(false); });
  };

  /* find the part holding a call-position and seek the element into it */
  const seek = (ms: number) => {
    if (!Array.isArray(parts) || parts.length === 0) return;
    let idx = 0;
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i]!.offset_ms <= ms) idx = i;
    }
    const audio = audioRef.current;
    if (audio === null) return;
    const part = parts[idx]!;
    if (activePart.current !== idx || audio.src === "") {
      activePart.current = idx;
      audio.src = part.url;
    }
    audio.currentTime = Math.max(0, (ms - part.offset_ms) / 1000);
    setPosMs(ms);
    void audio.play().then(() => setPlaying(true)).catch(() => undefined);
  };

  useEffect(() => {
    if (seekTo !== null) seek(seekTo.ms);
    // parts arriving later must not replay an old request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTo]);

  if (parts === null) return null;
  if (parts === "absent" || parts.length === 0) {
    return <p className="text-xs text-fg-subtle">{t("noAudio")}</p>;
  }

  const toggle = () => {
    const audio = audioRef.current;
    if (audio === null) return;
    if (playing) { audio.pause(); setPlaying(false); return; }
    if (audio.src === "") audio.src = parts[0]!.url;
    void audio.play().then(() => setPlaying(true)).catch(() => undefined);
  };

  const nextSpeed = () => {
    const at = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(at + 1) % SPEEDS.length]!);
  };

  /*
   * THE REFERENCE'S BAR, in one row (user directive, 2026-09-02: "add the
   * sound bar to the after meeting page in the same row plus the speed
   * button like image"): play · label · waveform · elapsed/total · speed.
   * Clicking the strip seeks — the waveform is a control, not an ornament.
   */
  return (
    <div
      className="card flex items-center gap-3 px-3 py-2"
      dir="ltr"
    >
      {/*
        2026-09-03: the theme's control, not a twelfth invented size. This was
        a 40px ROUND button sitting an inch from the ×speed key on its own row
        — and that key is a `.btn btn-sm`, 34px with an 8px corner. Two
        transport keys, one bar, two shapes, which is the "ten different
        developers" complaint at its smallest possible scale.
        It takes `.btn-sm`'s height rather than `.btn-icon`'s 28 so it matches
        the key it shares the row with, and is squared by a WIDTH — the
        spelling TaskDialogs already uses — instead of a fresh height. The
        product's other player (calls/[id]) closed the identical finding a day
        earlier on its own play/stop pair; this is the second instance of it.
        `tap` goes with the geometry it was propping up: `.btn` composes it.
      */}
      <button
        type="button"
        aria-label={playing ? t("audioPause") : t("audioPlay")}
        onClick={toggle}
        className="btn btn-sm w-[34px] shrink-0 px-0 bg-accent text-on-accent"
      >
        {playing ? <IconPause width={14} height={14} /> : <IconPlay width={14} height={14} />}
      </button>
      <span className="shrink-0 text-xs font-medium text-fg">{t("audioLabel")}</span>
      <canvas
        ref={canvasRef}
        role="slider"
        aria-label={t("audioLabel")}
        aria-valuemin={0}
        aria-valuemax={total ?? 0}
        aria-valuenow={Math.floor(posMs)}
        tabIndex={0}
        className="h-8 min-w-0 flex-1 cursor-pointer"
        onClick={(e) => {
          if (total === null) return;
          const rect = e.currentTarget.getBoundingClientRect();
          seek(Math.max(0, Math.min(total, ((e.clientX - rect.left) / rect.width) * total)));
        }}
        onKeyDown={(e) => {
          if (total === null) return;
          if (e.key === "ArrowRight") seek(Math.min(total, posMs + 5000));
          if (e.key === "ArrowLeft") seek(Math.max(0, posMs - 5000));
        }}
      />
      <span className="badge-num shrink-0 text-xs text-fg-muted">
        {formatClock(Math.floor(posMs / 1000), locale)}
        <span className="mx-1 text-fg-subtle">/</span>
        {total === null ? "—" : formatClock(Math.floor(total / 1000), locale)}
      </span>
      <button
        type="button"
        onClick={nextSpeed}
        aria-label={t("audioSpeed")}
        className="btn btn-sm badge-num shrink-0 border border-border font-semibold text-fg"
      >
        ×{digits(speed, locale)}
      </button>
      <audio
        ref={audioRef}
        onError={resign}
        onTimeUpdate={(e) => {
          const part = parts[activePart.current];
          if (part) setPosMs(part.offset_ms + e.currentTarget.currentTime * 1000);
        }}
        onEnded={() => {
          /* walk to the next part — one recording, several files */
          const next = activePart.current + 1;
          const part = parts[next];
          const audio = audioRef.current;
          if (part && audio) {
            activePart.current = next;
            audio.src = part.url;
            audio.playbackRate = speed;
            void audio.play().catch(() => setPlaying(false));
          } else {
            setPlaying(false);
          }
        }}
      />
    </div>
  );
}

/* ── the transcript panel ──────────────────────────────────────────────── */
function speakerName(seg: TranscriptSegment, speakers: Speaker[]): string | null {
  if (seg.speaker_id === null) return null;
  const sp = speakers.find((s) => s.id === seg.speaker_id);
  if (sp === undefined) return null;
  return sp.person_name ?? sp.label;
}

const SPEAKER_TONES = [
  "bg-accent-soft text-accent",
  "bg-info/10 text-info",
  "bg-warning/10 text-warning",
  "bg-danger/10 text-danger",
];

export function TranscriptPanel({ callId, onSeek, locale }: {
  callId: string;
  onSeek: (ms: number) => void;
  locale: string;
}) {
  const t = useTranslations("meetings");
  const [segments, setSegments] = useState<TranscriptSegment[] | null | "failed">(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);

  useEffect(() => {
    let alive = true;
    void api.getTranscript(callId)
      .then((rows) => { if (alive) setSegments(rows); })
      .catch(() => { if (alive) setSegments("failed"); });
    void api.getSpeakers(callId)
      .then((rows) => { if (alive) setSpeakers(rows); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [callId]);

  if (segments === null) return <p className="p-4 text-sm text-fg-muted">…</p>;
  if (segments === "failed") return <p className="p-4 text-sm text-fg-muted">{t("readFailed")}</p>;
  /* RECORDED BUT SILENT is its own state, not an empty transcript: the
     pipeline finished, the audio is there, and no speech was found —
     saying "no transcript yet" would send someone waiting for one that is
     never coming (the reference names this state, and so do we) */
  if (segments.length === 0) {
    return (
      <div className="tile grid place-items-center p-8 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent" aria-hidden>
          <IconMicOff width={24} height={24} />
        </span>
        <h3 className="mt-3 text-sm font-bold text-fg">{t("noSpeechTitle")}</h3>
        <p className="mt-1 max-w-md text-xs leading-6 text-fg-muted">{t("noSpeechBody")}</p>
      </div>
    );
  }

  const toneOf = new Map<string, string>();
  for (const sp of speakers) {
    toneOf.set(sp.id, SPEAKER_TONES[toneOf.size % SPEAKER_TONES.length]!);
  }

  return (
    <section aria-label={t("transcriptTitle")} className="tile flex min-h-0 flex-col p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-fg">{t("transcriptTitle")}</h3>
        <span className="text-[11px] text-fg-subtle">
          {t("transcriptCount", { n: digits(segments.length, locale) })}
        </span>
      </header>
      <ol className="scroll-quiet min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
        {segments.map((seg) => {
          const name = speakerName(seg, speakers);
          const tone = seg.speaker_id !== null ? toneOf.get(seg.speaker_id) ?? SPEAKER_TONES[0]! : "bg-surface-2 text-fg-muted";
          return (
            <li key={seg.id} className="flex items-start gap-2.5">
              {/* NOT `<Avatar>`, deliberately (2026-09-03 sweep). The GROUND is
                  the point here: `tone` gives each speaker their own colour from
                  SPEAKER_TONES, which is how a reader tells voices apart while
                  scanning a transcript. `Avatar` has one ground for everybody by
                  design — adopting it would make every speaker's mark identical
                  and delete the only thing this one does beyond showing a
                  letter. Its fallback is «؟» too, the Persian mark, where
                  `Avatar`'s is Latin "?". */}
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${tone}`} aria-hidden>
                {(name ?? "؟").slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-fg">{name ?? t("unattributed")}</span>
                  <button
                    type="button"
                    onClick={() => onSeek(seg.start_ms)}
                    className="badge-num text-[11px] text-fg-subtle hover:text-accent"
                    title={t("playFromHere")}
                    dir="ltr"
                  >
                    {formatClock(Math.floor(seg.start_ms / 1000), locale)}
                  </button>
                </div>
                <p className="mt-0.5 text-sm leading-6 text-fg">{seg.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/*
 * The extraction panel that used to live here is GONE (0160). It sliced the
 * summary's prose by heading and rendered the paragraphs under each, which
 * could only ever be read — and was empty for every meeting whose audio had
 * not been processed, which is the complaint that replaced it. Its five
 * sections are rows now, in `ItemsPanel`, where a person can add one before
 * anybody has spoken; its خلاصه tab was a second rendering of the minutes,
 * which have their own tab and their own document.
 */
