"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call, Speaker, SummaryVersion, TranscriptRow } from "@/api/types";
import { AppShell } from "@/components/AppShell";
import { Card, Chip, PageHeader, StatusChip } from "@/components/ui";
import { formatClock, formatDate, digits } from "@/lib/format";

/**
 * Read view (SPEC "The core loop" #3): player beside the transcript, summary
 * above, clicking a line seeks the audio. Parts share ONE continuous
 * timeline, so a line's position is its absolute ms.
 */
export default function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("call");
  const tStatus = useTranslations("status");
  const tCalls = useTranslations("calls");
  const locale = useLocale();

  const [call, setCall] = useState<Call | null>(null);
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [versions, setVersions] = useState<SummaryVersion[]>([]);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void api.getCall(id).then(setCall);
    void api.getTranscript(id).then(setRows);
    void api.getSpeakers(id).then(setSpeakers);
    void api.getSummaries(id).then((all) => {
      setVersions(all);
      setShownVersion(all.at(-1)?.version ?? null);
    });
  }, [id]);

  // stand-in for the real <audio> element until signed URLs exist
  useEffect(() => {
    if (playing) {
      timer.current = setInterval(() => setPlayheadMs((ms) => ms + 500), 500);
    } else if (timer.current) {
      clearInterval(timer.current);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  const activeRowId = useMemo(
    () => rows.find((r) => playheadMs >= r.start_ms && playheadMs < r.end_ms)?.id ?? null,
    [rows, playheadMs],
  );

  const speakerName = (speakerId: string) => {
    const speaker = speakers.find((s) => s.id === speakerId);
    return speaker?.person_name ?? speaker?.label ?? speakerId;
  };

  const summary = versions.find((v) => v.version === shownVersion) ?? null;

  if (!call) return <AppShell page={t("transcript")}>{null}</AppShell>;

  return (
    <AppShell page={call.title} presetCallId={call.id}>
      <PageHeader
        title={call.title}
        subtitle={
          call.parts.length > 1
            ? `${formatDate(call.created_at, locale)} · ${tCalls("parts", { count: digits(call.parts.length, locale) })}`
            : formatDate(call.created_at, locale)
        }
        actions={<StatusChip status={call.status} label={tStatus(call.status)} />}
      />

      {/* summary above the transcript, versioned */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">{t("summary")}</h2>
          {versions.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-fg-muted">{t("versions")}:</span>
              {versions.map((v) => (
                <button
                  key={v.version}
                  onClick={() => setShownVersion(v.version)}
                  className={`chip ${
                    v.version === shownVersion
                      ? "bg-accent-soft text-accent"
                      : "bg-surface-2 text-fg-muted"
                  }`}
                >
                  {t("version", { n: digits(v.version, locale) })}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {summary ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-8 text-fg">{summary.content}</p>
            <p className="mt-3 text-xs text-fg-muted ltr">{summary.model_id}</p>
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            {call.status === "ready" ? t("noSummaryYet") : t("processing", { status: tStatus(call.status) })}
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* transcript */}
        <Card className="!p-0">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                className="btn-primary h-10 min-h-0 w-10 px-0"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "pause" : "play"}
              >
                {playing ? "⏸" : "▶"}
              </button>
              <span className="text-sm text-fg-muted ltr">
                {formatClock(playheadMs / 1000, locale)} / {formatClock(call.duration_seconds, locale)}
              </span>
              <span className="flex-1" />
              <span className="text-xs text-fg-muted">
                {call.word_timestamps ? t("seekHint") : t("seekHintLine")}
              </span>
            </div>
            {/* M6: fallback-lane provenance — subtle, explained, self-clearing */}
            {!call.word_timestamps ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="warning">{t("degraded")}</Chip>
                <span className="text-xs text-fg-muted">{t("degradedHint")}</span>
              </div>
            ) : null}
          </div>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li
                key={row.id}
                className={`flex gap-3 px-4 py-3 transition-colors ${
                  activeRowId === row.id ? "bg-accent-soft" : ""
                } ${rowSeekable(row) ? "cursor-pointer hover:bg-surface-2" : "cursor-default"}`}
                onClick={() => {
                  // Backend ruling: with no usable timing, do NOT silently
                  // seek to 0 — offer no seek at all.
                  if (!rowSeekable(row)) return;
                  setPlayheadMs(row.start_ms);
                  setPlaying(true);
                }}
              >
                <span className="w-14 shrink-0 pt-0.5 text-xs text-fg-muted ltr">
                  {formatClock(row.start_ms / 1000, locale)}
                </span>
                <div className="min-w-0">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="text-xs font-semibold text-accent">
                      {speakerName(row.speaker_id)}
                    </span>
                    {row.channel !== null ? (
                      <span className="text-[11px] text-fg-muted ltr">ch{row.channel + 1}</span>
                    ) : null}
                    {row.edited ? (
                      <span className="chip bg-surface-2 text-fg-muted">{t("edited")}</span>
                    ) : null}
                  </div>
                  {/* click-a-word when the lane gave word timing; otherwise
                      the whole line stays the seek target (M6) */}
                  {call.word_timestamps && row.words.length > 0 ? (
                    <p className="text-sm leading-7 text-fg">
                      {row.words.map((word, i) => (
                        <span
                          key={`${row.id}-${i}`}
                          className="cursor-pointer rounded px-0.5 hover:bg-accent/20"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlayheadMs(word.start_ms);
                            setPlaying(true);
                          }}
                        >
                          {word.text}{" "}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="text-sm leading-7 text-fg">{row.text}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* speaker roster */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-fg">{t("speakers")}</h2>
          <ul className="space-y-3">
            {speakers.map((speaker) => (
              <li key={speaker.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">
                    {speaker.person_name ?? speaker.label}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {formatClock(speaker.talk_seconds, locale)}
                  </span>
                </div>
                {speaker.person_id ? (
                  <Chip tone="success">{t("linkSpeaker")} ✓</Chip>
                ) : (
                  <button className="btn-secondary mt-1 h-8 min-h-0 px-2 text-xs">
                    {t("linkSpeaker")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}

/**
 * The degradation ladder (M20): word → line → span, never "nothing". A
 * prose-only transcription arrives as ONE segment anchored to the speech it
 * came from (first speech → last speech in that part), so this gate passes
 * it and the click seeks into real audio — coarse but true. It only ever
 * refuses a zero-length row, which core/ rejects at its boundary
 * (InvalidTimingError); a click that silently jumps to 0 was a visible
 * quality gap in the predecessor product.
 */
function rowSeekable(row: TranscriptRow): boolean {
  return row.end_ms > row.start_ms;
}
