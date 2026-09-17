"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { speakerNaming } from "@/lib/speakerNaming";
import { api } from "@/api/client";
import type { Call, MeetingRecord, Person, Speaker, TranscriptSegment } from "@/api/types";
import { meetingVoiceCandidates } from "@/lib/voiceCandidates";
import { VoicePicker } from "./VoicePicker";
import { dirFor } from "@/lib/textDirection";
import { IconCheck, IconDownload, IconMic, IconMicOff, IconPlay, IconPause } from "@/components/icons";
import { digits, formatClock } from "@/lib/format";
import { SkeletonLines } from "@/components/scaffold";
import { notify } from "@/lib/notify";

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

/**
 * `call: null` — THE BYTES ARE STILL LEAVING THIS BROWSER (2026-09-08).
 *
 * The upload lane hands the file to the meeting's own page now rather than
 * holding the wizard open for it, so there is a real stretch — the whole
 * send, which for an hour of audio is the longest step in the pipeline —
 * where the ladder has not started because the record does not exist yet.
 * Rendering nothing there would put a person who just pressed «آپلود» on a
 * blank screen; rendering the card at step one is the truth, and it is the
 * same picture the pipeline continues into.
 */
export function ProcessingCard({ call, title, locale }: {
  call: Call | null; title: string; locale: string;
}) {
  const t = useTranslations("meetings");
  /* step one, «آپلود صدا», is exactly where an in-flight upload is */
  const at = call === null ? 0 : ladderIndex(call.status);
  const known = call === null || (LADDER as readonly string[]).includes(call.status);
  return (
    <div className="tile mx-auto w-full max-w-xl p-6">
      <div className="text-center">
        <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-accent/30" aria-hidden>
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />
          <IconMic width={24} height={24} className="text-accent" />
        </span>
        <h2 className="h-section mt-3">{t("processingTitle")}</h2>
        <p className="mt-1 text-xs text-fg-muted">
          {title} — {call === null ? t("uploading") : t("processingSubtitle")}
          {!known && call !== null ? ` (${call.status})` : ""}
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
                <span className="block text-caption text-fg-muted">{t(`step_${key}_sub`)}</span>
              </span>
              {state === "done" ? <span className="shrink-0 text-caption text-accent">{t("stepDone")}</span>
                : state === "active" ? <span className="shrink-0 text-caption text-accent">{t("stepActive")}</span>
                  : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all duration-700"
          style={{ width: `${Math.round(((at + 0.5) / STEP_KEYS.length) * 100)}%` }} />
      </div>
      <p className="mt-3 text-center text-caption leading-5 text-fg-subtle">{t("processingNote")}</p>
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

export function AudioBar({ callId, seekTo, locale, durationMs = null, title = "" }: {
  callId: string;
  /** an external seek request (a transcript row's timestamp) — a FRESH
      object per click, so repeating a timestamp still seeks */
  seekTo: { ms: number } | null;
  locale: string;
  /** the call's total, from the wire — null renders as "—", never as 0:00,
      because "we do not know how long" is not "it is empty" */
  durationMs?: number | null;
  /** what the SAVED file is called — a download whose name is a uuid is a
      file nobody can find again. Empty falls back to the call's id. */
  title?: string;
}) {
  const t = useTranslations("meetings");
  const [parts, setParts] = useState<{ idx: number; offset_ms: number; url: string }[] | null | "absent">(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [saving, setSaving] = useState(false);
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
   * SAVE THE RECORDING.
   *
   * THROUGH A BLOB, and that is the whole design decision. The obvious
   * shape — `<a download href={part.url}>` — is a trap here: the `download`
   * attribute is IGNORED cross-origin, and these are signed storage URLs on
   * another host, so the browser would NAVIGATE to the audio instead of
   * saving it. A person pressing «ذخیره» would land on a bare player in a
   * new tab with the meeting gone from the screen, which reads as the
   * button being broken rather than as the browser obeying a rule.
   *
   * Fetching is safe because the waveform above already does it: `peaksOf`
   * reads the same URL with `fetch` and draws, so CORS on these URLs is a
   * fact this file already depends on rather than a hope.
   *
   * EVERY PART, one file each. A recording is several files when it ran
   * long (the parts this bar plays back to back), and there is no single
   * artefact to hand over — so the honest thing is to save what exists and
   * name each with its number. Sequential, not parallel: a browser that
   * gets several saves at once asks the person about them all at once.
   */
  const nameFor = (part: { idx: number; url: string }, mime: string) => {
    /* the URL's own extension is the real one — the MIME is the fallback,
       because storage answers `application/octet-stream` for some keys */
    const fromUrl = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(part.url)?.[1];
    const fromMime = /(webm|mpeg|mp4|wav|ogg|m4a)/i.exec(mime)?.[1];
    const ext = (fromUrl ?? (fromMime === "mpeg" ? "mp3" : fromMime) ?? "webm").toLowerCase();
    /* A FILE NAME IS A PATH SEGMENT: separators and control characters are
       the only things that must not survive it — Persian is a perfectly
       good file name and is left alone. The control range is spelled with
       escape SEQUENCES rather than the characters themselves, and that is
       not style: the first draft of this line came out of a script that
       collapsed them into an actual NUL, and the file went binary. */
    const base = (title.trim() === "" ? callId : title.trim())
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .slice(0, 80);
    return parts.length > 1 ? `${base}-${part.idx + 1}.${ext}` : `${base}.${ext}`;
  };

  const save = () => {
    if (saving) return;
    setSaving(true);
    void (async () => {
      try {
        for (const part of parts) {
          const res = await fetch(part.url);
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          const href = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = href;
          a.download = nameFor(part, blob.type);
          document.body.appendChild(a);
          a.click();
          a.remove();
          /* revoked on a timer, not on the next line: revoking synchronously
             can beat the browser's own read of the blob */
          setTimeout(() => URL.revokeObjectURL(href), 60_000);
        }
      } catch {
        /* through the bus, like every other outcome on this page — a banner
           in the bar would move the row it lives in */
        notify(t("audioDownloadFailed"));
      } finally {
        setSaving(false);
      }
    })();
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
        className="btn-primary btn-sm w-control-sm shrink-0 px-0"
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
      {/*
        ONE LINE, ALWAYS — and it was never a WRAP (user report twice,
        2026-09-08: "make sure that the audio time will not break into 2
        lines", then "still looks broken to 3 lines").
        `.badge-num` is `display: inline-grid; place-items: center` — it
        exists for ONE glyph centred in a circle, and this readout has
        THREE children, so the grid gave each its own implicit ROW. The
        text was never wrapping; it was being stacked. That is why the
        first fix, `whitespace-nowrap`, changed nothing and why its test
        went green over the bug: a class assertion cannot see a rule
        arriving from a stylesheet two files away.
        What is wanted from `.badge-num` here is the tabular figures — so
        the utility is taken directly and the grid is left behind. `flex`
        makes the row explicit rather than implicit, `shrink-0` keeps the
        box off the canvas's shrink, and `whitespace-nowrap` stays for the
        one break the flex row still permits.
      */}
      <span className="flex shrink-0 items-center whitespace-nowrap text-xs tabular-nums text-fg-muted">
        {formatClock(Math.floor(posMs / 1000), locale)}
        <span className="mx-1 text-fg-subtle">/</span>
        {total === null ? "—" : formatClock(Math.floor(total / 1000), locale)}
      </span>
      {/*
        SAVE — the play key's exact shape, so the bar ends in two controls
        of one family rather than a square and a lozenge. Disabled while a
        save is running: a second press would fetch the same bytes again.
      */}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        aria-label={t("audioDownload")}
        title={t("audioDownload")}
        className="btn-secondary btn-sm w-control-sm shrink-0 px-0"
      >
        <IconDownload width={14} height={14} />
      </button>
      {/*
        A FIXED WIDTH, and it is the point of this control.

        The label is ×1, ×1.25, ×1.5 or ×2 — four different widths — so on
        an auto-sized key every press moved the key itself, the save button
        beside it and the right edge of the waveform. The width is the
        widest label's, which is «×۱٫۲۵», and `px-0` hands the centring to
        the class rather than to padding that would fight it.
      */}
      <button
        type="button"
        onClick={nextSpeed}
        aria-label={t("audioSpeed")}
        className="btn-secondary btn-sm badge-num w-[3.25rem] shrink-0 px-0"
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

/* EXPORTED for the LIVE transcript (2026-09-08): a voice must look the same
   either side of the finish, and two lists of four colours is the pair that
   stops matching the first time either is touched. */
export const SPEAKER_TONES = [
  "bg-accent-soft text-accent",
  "bg-info/10 text-info",
  "bg-warning/10 text-warning",
  "bg-danger/10 text-danger",
];

export function TranscriptPanel({ callId, meeting, isHost, onSeek, locale }: {
  callId: string;
  /** whose people the voices may be named from (db/0202's roster + the host) */
  meeting: MeetingRecord;
  /** db/0093: only the call's OWNER may move a voice's directory link, and
      the record of a meeting belongs to its host (0202) */
  isHost: boolean;
  onSeek: (ms: number) => void;
  locale: string;
}) {
  const t = useTranslations("meetings");
  const [segments, setSegments] = useState<TranscriptSegment[] | null | "failed">(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  /* re-read the voices after a link: one name changes EVERY turn that voice
     took, which is the whole reason the picker sits on the name rather than
     in a panel above it */
  const [linked, setLinked] = useState(0);

  useEffect(() => {
    let alive = true;
    void api.getTranscript(callId)
      .then((rows) => { if (alive) setSegments(rows); })
      .catch(() => { if (alive) setSegments("failed"); });
    return () => { alive = false; };
  }, [callId]);

  useEffect(() => {
    let alive = true;
    void api.getSpeakers(callId)
      .then((rows) => { if (alive) setSpeakers(rows); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [callId, linked]);

  useEffect(() => {
    /* the directory is read for the PICKER — a colleague who cannot name a
       voice has no use for it, and asking for it anyway would be a request
       per transcript for a list nothing renders */
    if (!isHost) return undefined;
    let alive = true;
    void api.directory()
      .then((rows) => { if (alive) setPeople(rows); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [callId, isHost, linked]);

  if (segments === null) return <div className="p-4"><SkeletonLines lines={5} /></div>;
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
        <h3 className="h-card mt-3">{t("noSpeechTitle")}</h3>
        <p className="mt-1 max-w-md text-xs leading-6 text-fg-muted">{t("noSpeechBody")}</p>
      </div>
    );
  }

  const toneOf = new Map<string, string>();
  for (const sp of speakers) {
    toneOf.set(sp.id, SPEAKER_TONES[toneOf.size % SPEAKER_TONES.length]!);
  }

  /*
   * WHO THIS VOICE COULD BE — the meeting's own people and nobody else (user
   * directive, 2026-09-07: "only from people that have been in the meeting,
   * not all of them"). The rule is in lib/voiceCandidates.ts, where it can be
   * tested: it crosses two tables (a roster of ACCOUNTS, a directory of
   * PEOPLE) and none of that crossing is visible from this DOM.
   */
  const candidates = meetingVoiceCandidates(meeting, people, locale);

  return (
    <section aria-label={t("transcriptTitle")} className="tile flex min-h-0 flex-col p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="h-card">{t("transcriptTitle")}</h3>
        <span className="text-caption text-fg-subtle">
          {t("transcriptCount", { n: digits(segments.length, locale) })}
        </span>
      </header>
      <ol className="scroll-quiet min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
        {segments.map((seg) => {
          /* NEVER THE INTERNAL LABEL (2026-09-06). This read
             `person_name ?? label`, so an unlinked voice was shown to a
             reader as «S1·1» — the diarizer's own string, in the place a
             name goes. See lib/speakerNaming.ts. */
          const naming = speakerNaming(seg.speaker_id, speakers);
          const name = naming.kind === "person" ? naming.name
            : naming.kind === "ordinal" ? t("speakerNamed", { n: digits(naming.n, locale) })
              : null;
          const speaker = speakers.find((s) => s.id === seg.speaker_id);
          const tone = seg.speaker_id !== null ? toneOf.get(seg.speaker_id) ?? SPEAKER_TONES[0]! : "bg-surface-2 text-fg-muted";
          return (
            /*
             * THE WHOLE LINE SEEKS (user, 2026-09-08: "make the transcript
             * clickable and once clicked move me to the relevant place in the
             * audio track").
             *
             * Only the CLOCK was a control, which is the smallest target on
             * the row and the one part of it nobody is reading — a person who
             * spots the sentence they want clicks the sentence. `/calls/[id]`
             * has worked this way since #17; this panel is the same transcript
             * against the same audio, so it gets the same gesture rather than
             * a second convention.
             *
             * The row is a plain `li` with a handler, not a `role="button"`:
             * the speaker name inside it is ALREADY a button (the voice
             * picker), and a button inside a button is neither reachable nor
             * announceable. The clock stays exactly as it was, so the keyboard
             * path to this seek is unchanged.
             */
            <li
              key={seg.id}
              /* the hover ground is drawn INSIDE the list's own box — a
                 negative margin to bleed it to the edges made the `ol` wider
                 than its scroller and hung a horizontal scrollbar under a
                 column of text that has nothing to scroll sideways to */
              className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-2"
              onClick={() => {
                /* A DRAG THAT ENDED IN THIS ROW IS A QUOTE, NOT A SEEK.
                   Selecting a sentence to copy fires `click` on mouseup, and
                   jumping the audio there would scrub the recording every
                   time somebody quoted it — with the selection collapsed by
                   the seek that follows, so the copy fails too. */
                const picked = typeof window !== "undefined" ? window.getSelection() : null;
                if (picked !== null && !picked.isCollapsed) return;
                onSeek(seg.start_ms);
              }}
            >
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
                  {/* THE NAME IS THE CONTROL (user directive, 2026-09-07).
                      A voice with no id at all is not a voice this record
                      holds — there is nothing to link — so it stays text. */}
                  {/* the picker opens a menu ON this row — its click is about
                      the VOICE, not about where the audio should go */}
                  {isHost && seg.speaker_id !== null && speaker !== undefined ? (
                    <span onClick={(e) => e.stopPropagation()}>
                    <VoicePicker
                      callId={callId}
                      speaker={speaker}
                      name={name ?? t("unattributed")}
                      candidates={candidates}
                      people={people}
                      onLinked={() => setLinked((n) => n + 1)}
                    />
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-fg">{name ?? t("unattributed")}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onSeek(seg.start_ms)}
                    className="badge-num text-caption text-fg-subtle hover:text-accent"
                    title={t("playFromHere")}
                    dir="ltr"
                  >
                    {formatClock(Math.floor(seg.start_ms / 1000), locale)}
                  </button>
                </div>
                {/* each line in its own direction (2026-09-06): an English
                    sentence inside a Persian meeting reads left-to-right,
                    and a line whose language was not identified follows the
                    page as before */}
                <p className="mt-0.5 text-sm leading-6 text-fg" dir={dirFor(seg.language)} lang={seg.language ?? undefined}>{seg.text}</p>
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
