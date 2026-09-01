"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call, Speaker, SummaryVersion, TranscriptSegment } from "@/api/types";
import { parseSummary, type SummaryBlock } from "@/components/echo/SummaryBody";
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
export function AudioBar({ callId, seekTo, locale }: {
  callId: string;
  /** an external seek request (a transcript row's timestamp) — a FRESH
      object per click, so repeating a timestamp still seeks */
  seekTo: { ms: number } | null;
  locale: string;
}) {
  const t = useTranslations("meetings");
  const [parts, setParts] = useState<{ idx: number; offset_ms: number; url: string }[] | null | "absent">(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activePart = useRef(0);

  const resigning = useRef(false);
  useEffect(() => {
    let alive = true;
    void api.getCallAudio(callId)
      .then((r) => { if (alive) setParts(r === null ? "absent" : [...r.parts].sort((a, b) => a.idx - b.idx)); })
      .catch(() => { if (alive) setParts("absent"); });
    return () => { alive = false; };
  }, [callId]);

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

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2 shadow-card">
      <button
        type="button"
        aria-label={playing ? t("audioPause") : t("audioPlay")}
        onClick={toggle}
        className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent"
      >
        {playing ? <IconPause width={14} height={14} /> : <IconPlay width={14} height={14} />}
      </button>
      <span className="text-xs font-medium text-fg">{t("audioLabel")}</span>
      <span className="badge-num ms-auto text-xs text-fg-muted" dir="ltr">
        {formatClock(Math.floor(posMs / 1000), locale)}
      </span>
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

/* ── the extraction panel: the summary's sections, sliced by heading ───── */
interface Section { title: string; blocks: SummaryBlock[] }

/** the reference's tab set, each matched to the headings the shipped
    summary skill actually produces; a miss renders a named absence */
const EXTRACTION_TABS: Array<{ key: string; match: RegExp }> = [
  /* the patterns cover the SHIPPED templates' own section names (worker
     summarizer addenda: تصمیم‌ها، اقدامات بعدی، موانع و مشکلات، …) — a
     regex that matches no heading the producer ever writes is a tab that
     is always empty while reading as wired */
  { key: "decisions", match: /مصوب|تصمیم/ },
  { key: "actions", match: /اکشن|اقدام/ },
  { key: "summary", match: /خلاصه|چکیده|جمع‌بندی/ },
  { key: "questions", match: /سؤال|سوال|پرسش/ },
  { key: "risks", match: /ریسک|خطر|موانع|مشکل/ },
];

function sliceSections(text: string): Section[] {
  const blocks = parseSummary(text);
  const sections: Section[] = [];
  let current: Section = { title: "", blocks: [] };
  for (const block of blocks) {
    if (block.kind === "heading") {
      if (current.blocks.length > 0 || current.title !== "") sections.push(current);
      current = { title: block.text, blocks: [] };
    } else {
      current.blocks.push(block);
    }
  }
  if (current.blocks.length > 0 || current.title !== "") sections.push(current);
  return sections;
}

function renderBlocks(blocks: SummaryBlock[]): React.ReactNode {
  return blocks.map((block, i) => {
    if (block.kind === "heading") return <h4 key={i} className="text-sm font-semibold text-fg">{block.text}</h4>;
    if (block.kind === "bullets" || block.kind === "numbered") {
      return (
        <ul key={i} className="space-y-1.5">
          {block.items.map((item, j) => (
            <li key={j} className="rounded-xl border border-border bg-surface p-3 text-sm leading-6 text-fg shadow-card">
              {item}
            </li>
          ))}
        </ul>
      );
    }
    return <p key={i} className="text-sm leading-7 text-fg">{block.text}</p>;
  });
}

export function ExtractionPanel({ callId }: { callId: string }) {
  const t = useTranslations("meetings");
  const [versions, setVersions] = useState<SummaryVersion[] | null | "failed">(null);
  const [tab, setTab] = useState("decisions");

  useEffect(() => {
    let alive = true;
    void api.getSummaries(callId)
      .then((v) => { if (alive) setVersions(v); })
      .catch(() => { if (alive) setVersions("failed"); });
    return () => { alive = false; };
  }, [callId]);

  const sections = useMemo(
    () => (Array.isArray(versions) && versions[0] !== undefined ? sliceSections(versions[0].body) : []),
    [versions],
  );

  if (versions === null) return <p className="p-4 text-sm text-fg-muted">…</p>;
  if (versions === "failed") return <p className="p-4 text-sm text-fg-muted">{t("readFailed")}</p>;
  if (versions[0] === undefined) return <p className="p-4 text-sm text-fg-muted">{t("noMinutesYet")}</p>;

  const sectionFor = (key: string): Section | undefined => {
    const spec = EXTRACTION_TABS.find((entry) => entry.key === key);
    const hit = spec === undefined ? undefined : sections.find((s) => spec.match.test(s.title));
    if (hit !== undefined) return hit;
    /* the خلاصه tab falls back to EVERYTHING the summary said — a summary
       with no matching heading (the default skill writes free prose) must
       not render five empty tabs while the text sits unreachable */
    if (key === "summary") {
      const untitled = sections.filter((s) => s.title === "");
      const blocks = untitled.flatMap((s) => s.blocks);
      if (blocks.length > 0) return { title: "", blocks };
      return { title: "", blocks: parseSummary(Array.isArray(versions) && versions[0] !== undefined ? versions[0].body : "") };
    }
    return undefined;
  };
  const active = sectionFor(tab);

  return (
    <section aria-label={t("extractionTitle")} className="tile flex min-h-0 flex-col p-4">
      <div role="tablist" className="mb-3 flex flex-wrap items-center gap-1 rounded-xl bg-surface-2 p-1">
        {EXTRACTION_TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={`tap h-8 rounded-lg px-3 text-xs font-medium transition-colors ${
              tab === entry.key ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"
            }`}
          >
            {t(`ext_${entry.key}`)}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11px] text-fg-subtle">{t("extractionProvenance")}</p>
      <div className="scroll-quiet min-h-0 flex-1 space-y-2 overflow-y-auto pe-1">
        {active === undefined
          ? <p className="p-2 text-sm text-fg-muted">{t("extractionSectionAbsent")}</p>
          : renderBlocks(active.blocks)}
      </div>
    </section>
  );
}
