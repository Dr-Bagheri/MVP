"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call, CallStatus, Speaker, SummaryVersion, TranscriptSegment } from "@/api/types";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { Card, Chip, PageHeader, StatusChip } from "@/components/ui";
import { formatClock, formatDate, digits } from "@/lib/format";

/**
 * Read view (SPEC "The core loop" #3): player beside the transcript, summary
 * above, clicking a line seeks the audio. Parts share ONE continuous
 * timeline, so a line's position is its absolute ms.
 */

/**
 * Pipeline positions at which transcription itself has FINISHED, and so
 * `transcript_timing` is worth showing.
 *
 * The value counts TRANSCRIBED parts only — an untranscribed part isn't
 * counted as untimed, it isn't counted at all — so mid-flight it reports what
 * the transcript looks like so far. That is the honest thing to send, but it
 * has a sharp edge: the worker asserts a part's word-timing flag ONCE, AFTER
 * writing that part's segments, so between those two moments the part counts
 * transcribed-but-not-timed and the call reads **"none"** for an instant.
 * "none" is the strongest degraded claim there is, and flashing it on a
 * perfectly healthy call is a visible lie. Declining to make the claim until
 * transcription ends costs no new copy — it is a suppression, not a string.
 *
 * NOT simply `status === "ready"`: `linking` is link-speakers ACROSS parts,
 * so a call that has reached it necessarily has every part transcribed, and
 * summarization runs later still. Neither can change a transcript's timing,
 * so a mixed call sitting in either already has a settled, true claim to
 * make. Gating on `ready` alone would withhold correct information for two
 * whole pipeline stages.
 *
 * Named for the PIPELINE STAGE, not for permanence: an agent correction that
 * blanks a line's words demotes the flag even after `ready`. That is a true
 * change of fact rather than a retraction, so it needs no gate — but it does
 * mean this value must never be cached as though it were immutable.
 */
const TRANSCRIPTION_COMPLETE: readonly CallStatus[] = ["linking", "summarizing", "ready"];

/**
 * The membership test takes a `string`, while the list above keeps its narrow
 * `CallStatus[]` type. Both halves are deliberate.
 *
 * The list stays narrow so a typo in one of those three literals is a compile
 * error — that is the whole reason to type a constant. The PARAMETER is wide
 * because `call.status` is `string` on the wire: core/ types it that way on
 * purpose so a status added by a later migration cannot crash a client, and
 * that promise only holds if consumers stop insisting the value is one of the
 * six they know.
 *
 * The alternative was `includes(call.status as CallStatus)`, which compiles
 * and is a lie — it asserts the server can only ever send what this file
 * already knows about. An unknown status returns false here, which suppresses
 * the provenance caveat: the safe direction, since a caveat about a pipeline
 * stage we do not recognise is worse than no caveat.
 */
const transcriptionComplete = (status: string): boolean =>
  (TRANSCRIPTION_COMPLETE as readonly string[]).includes(status);
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
  const [rows, setRows] = useState<TranscriptSegment[]>([]);
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

  /**
   * `speaker_id` is null on the wire when nothing has attributed the segment
   * yet — verified on a live row. That is a real state and gets its own
   * word: passing null through would have printed `undefined` above the
   * line, which reads as a bug rather than as "we don't know who spoke".
   */
  const speakerName = (speakerId: string | null) => {
    if (speakerId === null) return t("unattributed");
    const speaker = speakers.find((s) => s.id === speakerId);
    return speaker?.person_name ?? speaker?.label ?? speakerId;
  };

  /*
   * The breadcrumb leaf. Three states, not two — FE2's correction to the
   * shape I proposed, and it fixes a bug I'd have shipped:
   *
   *   undefined  not loaded yet   → leaf omitted, trail is briefly shorter
   *   null       loaded, no title → "Untitled"
   *   string     the title
   *
   * I proposed `string | null` with null meaning "not yet", which collapses
   * two different nothings into one value — and the collapse costs exactly
   * the case it was meant to protect: a genuinely untitled call becomes
   * indistinguishable from one still loading, so it renders as a permanently
   * missing crumb instead of as an untitled call.
   *
   * `call?.title` gives that split for free: undefined while the fetch is in
   * flight, then whatever the server actually sent.
   */
  useCrumbTitle(call?.title);

  const summary = versions.find((v) => v.version === shownVersion) ?? null;

  if (!call) return <EchoAppShell page={t("transcript")}>{null}</EchoAppShell>;

  return (
    <EchoAppShell page={call.title} presetCallId={call.id}>
      <PageHeader
        title={call.title}
        subtitle={
          (call.parts?.length ?? 0) > 1
            ? `${formatDate(call.started_at, locale)} · ${tCalls("parts", { count: digits(call.parts?.length ?? 0, locale) })}`
            : formatDate(call.started_at, locale)
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
                {/* total is null on live rows (unknown, not zero) — showing
                    «نامعلوم» beats a confident 0:00 that isn't true */}
                {formatClock(playheadMs / 1000, locale)} /{" "}
                {call.duration_ms === null
                  ? tCalls("durationUnknown")
                  : formatClock(call.duration_ms / 1000, locale)}
              </span>
              <span className="flex-1" />
              <span className="text-xs text-fg-muted">
                {call.transcript_timing === "full"
                  ? t("seekHint")
                  : call.transcript_timing === "mixed"
                    ? t("seekHintMixed")
                    : t("seekHintLine")}
              </span>
            </div>
            {/* M6/M20 provenance — subtle, explained, self-clearing.
                "mixed" and "none" now say DIFFERENT things: «بخشی» scopes the
                caveat to one part of an otherwise complete transcript, which
                is the truth for a mostly-word-timed call and was actively
                misleading under the shared string. null = no transcript at
                all, so there is nothing to caveat.
                Suppressed until transcription ends — see TRANSCRIPTION_COMPLETE. */}
            {transcriptionComplete(call.status) &&
            (call.transcript_timing === "mixed" || call.transcript_timing === "none") ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="warning">
                  {call.transcript_timing === "mixed" ? t("degradedPart") : t("degraded")}
                </Chip>
                <span className="text-xs text-fg-muted">
                  {call.transcript_timing === "mixed" ? t("degradedPartHint") : t("degradedHint")}
                </span>
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
                  {/* M20's top rung, decided PER ROW. `call.word_timestamps`
                      is an all-parts AND — one degraded part turns it false —
                      so AND-ing it here stripped click-a-word from rows that
                      carry perfectly good word timing. The row's own words are
                      the only correct authority; the call flag explains
                      provenance above, and explaining is all it may do. */}
                  {row.words.length > 0 ? (
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
                          {word.w}{" "}
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
    </EchoAppShell>
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
function rowSeekable(row: TranscriptSegment): boolean {
  return row.end_ms > row.start_ms;
}
