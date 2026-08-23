"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call, CallNote, CallStatus, Me, Person, Speaker, SummaryVersion, TranscriptSegment } from "@/api/types";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { Link } from "@/i18n/routing";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { Card, Chip, PageHeader, StatusChip } from "@/components/ui";
import { formatClock, formatDate, digits, modelLabel } from "@/lib/format";
import { isFillerWord, stripFillers } from "@/lib/cleanRead";
import { notify } from "@/lib/notify";
import { SUMMARY_TEMPLATES, type SummaryTemplate } from "@echo/core/vocabulary";

/** Template → its literal message key: typed against the producer's union,
    so a new ruled template breaks this build until it gets a label. */
const TEMPLATE_LABEL_KEY: Record<SummaryTemplate, "templateBoard" | "templateGroup" | "templateTeam" | "templateItTeam" | "templateInterview"> = {
  board: "templateBoard",
  group: "templateGroup",
  team: "templateTeam",
  it_team: "templateItTeam",
  interview: "templateInterview",
};

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
  const tTitles = useTranslations("titles");
  const tStatus = useTranslations("status");
  const tCalls = useTranslations("calls");
  const locale = useLocale();

  const [call, setCall] = useState<Call | null>(null);
  const [rows, setRows] = useState<TranscriptSegment[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  /** The Echo speakers directory — the dropdown's option list. */
  const [directory, setDirectory] = useState<Person[]>([]);
  const [versions, setVersions] = useState<SummaryVersion[]>([]);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  /** Notes & chapters (0079) + who I am, for the delete-own gate. */
  const [notes, setNotes] = useState<CallNote[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  /**
   * English translations, per target (user directive): display-only, held
   * in state — the Persian record stays the single source of truth. Three
   * states each: null = not asked, "loading", or the text. `showEn` flips
   * the view without refetching.
   */
  const [summaryEn, setSummaryEn] = useState<string | "loading" | null>(null);
  const [transcriptEn, setTranscriptEn] = useState<string | "loading" | null>(null);
  const [showSummaryEn, setShowSummaryEn] = useState(false);
  const [showTranscriptEn, setShowTranscriptEn] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  /**
   * Reading modes (user directive, 2026-08-23) — DISPLAY only, the record
   * is untouched: filter the transcript to one speaker's lines, and a
   * clean-read toggle that hides pure hesitation sounds. The filler list
   * is deliberately narrow (uh/um/hmm and their Persian spellings) — a
   * word that can carry meaning («خب», "like") is never on it, because a
   * clean-read that changes what was said is an edit wearing a view.
   */
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);
  const [cleanRead, setCleanRead] = useState(false);
  /** Regenerate-summary panel (user directive, 2026-08-23): template from
      the ruled list + an optional instruction; the run rides the normal
      pipeline, so the existing status polling shows it and the new version
      arrives through the same fetch as every other. */
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenTemplate, setRegenTemplate] = useState<string>("");
  const [regenInstruction, setRegenInstruction] = useState("");
  const [regenBusy, setRegenBusy] = useState(false);

  async function regenerate(): Promise<void> {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      await api.resummarize(id, {
        ...(regenTemplate ? { template: regenTemplate } : {}),
        ...(regenInstruction.trim() ? { instruction: regenInstruction.trim() } : {}),
      });
      setRegenOpen(false);
      setRegenInstruction("");
      notify(t("regenStarted"));
      // the status flips to summarizing — the polling effect takes it from here
      const fresh = await api.getCall(id).catch(() => null);
      if (fresh) setCall(fresh);
    } catch {
      notify(t("regenFailed"), "warn");
    } finally {
      setRegenBusy(false);
    }
  }

  async function translate(what: "summary" | "transcript"): Promise<void> {
    const set = what === "summary" ? setSummaryEn : setTranscriptEn;
    const show = what === "summary" ? setShowSummaryEn : setShowTranscriptEn;
    setTranslateError(null);
    set("loading");
    show(true);
    try {
      // the model rides along so a user with no saved preference still
      // translates — core falls back to their preference when omitted
      const catalogue = await api.models();
      const model = catalogue.preferred_model ?? catalogue.models[0]?.id;
      const result = await api.translateCall(id, what, model);
      set(result.text);
    } catch {
      set(null);
      show(false);
      setTranslateError(t("translateFailed"));
    }
  }
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Signed playback URLs, one per part. `null` = no audio to offer. */
  const [audioParts, setAudioParts] = useState<
    { idx: number; offset_ms: number; url: string }[] | null
  >(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  /** The part whose URL is loaded in the element right now. */
  const loadedIdx = useRef<number | null>(null);

  useEffect(() => {
    void api.getCall(id).then(setCall);
    void api.getTranscript(id).then(setRows);
    void api.getSpeakers(id).then(setSpeakers);
    void api.directory().then(setDirectory).catch(() => setDirectory([]));
    void api.callNotes(id).then(setNotes).catch(() => setNotes([]));
    void api.me().then(setMe).catch(() => setMe(null));
    void api.getSummaries(id).then((all) => {
      setVersions(all);
      setShownVersion(all.at(-1)?.version ?? null);
    });
    // 404 = no audio (not there / not yours / nothing uploaded) — the
    // player simply doesn't offer itself; other failures leave it hidden too
    void api
      .getCallAudio(id)
      .then((res) => setAudioParts(res?.parts ?? null))
      .catch(() => setAudioParts(null));
    /*
     * ?translate=1 — the calls table's Translate action lands here and both
     * translations fire on arrival. window.location, not useSearchParams: a
     * mount-time read needs no Suspense boundary and cannot trip the
     * prerender gate the way the hub's hook did.
     */
    if (new URLSearchParams(window.location.search).get("translate") === "1") {
      void translate("summary");
      void translate("transcript");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once per call
  }, [id]);

  /**
   * While the PIPELINE is still moving this call (user report, 2026-08-23:
   * the status only changed on a full page refresh), the page re-reads
   * itself every few seconds — and when a poll sees the status become
   * terminal, it fetches what the pipeline produced (transcript, speakers,
   * summaries, audio) so "Ready" arrives WITH its content, not as a chip
   * over an empty page. Stops the moment nothing is in flight.
   */
  useEffect(() => {
    const WORKER_MOVED = new Set(["processing", "linking", "summarizing"]);
    if (!call || !WORKER_MOVED.has(call.status)) return;
    const timer = setInterval(() => {
      void api.getCall(id).then((fresh) => {
        if (!fresh) return;
        setCall(fresh);
        if (!WORKER_MOVED.has(fresh.status)) {
          void api.getTranscript(id).then(setRows).catch(() => undefined);
          void api.getSpeakers(id).then(setSpeakers).catch(() => undefined);
          void api.getSummaries(id).then((all) => {
            setVersions(all);
            setShownVersion(all.at(-1)?.version ?? null);
          }).catch(() => undefined);
          void api.getCallAudio(id)
            .then((res) => setAudioParts(res?.parts ?? null))
            .catch(() => undefined);
        }
      }).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [call, id]);

  /**
   * The REAL player (the fake clock this replaces once showed 0:11 of an
   * 0:08 recording — a playhead with no audio behind it). One element, the
   * parts as one continuous timeline: each part carries `offset_ms`, so
   * global time = part offset + element time, a part ending rolls to the
   * next, and a seek picks the right part before it sets the element.
   */
  const partFor = (ms: number) => {
    if (!audioParts || audioParts.length === 0) return null;
    let candidate = audioParts[0]!;
    for (const part of audioParts) if (part.offset_ms <= ms) candidate = part;
    return candidate;
  };

  const loadPart = (part: { idx: number; url: string }) => {
    if (!audioEl.current || loadedIdx.current === part.idx) return;
    audioEl.current.src = part.url;
    loadedIdx.current = part.idx;
  };

  async function playFrom(ms: number): Promise<void> {
    const part = partFor(ms);
    if (!part || !audioEl.current) return;
    loadPart(part);
    audioEl.current.currentTime = Math.max(0, (ms - part.offset_ms) / 1000);
    try {
      await audioEl.current.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  function togglePlay(): void {
    if (!audioEl.current) return;
    if (playing) {
      audioEl.current.pause();
      setPlaying(false);
    } else if (loadedIdx.current === null) {
      void playFrom(playheadMs);
    } else {
      void audioEl.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

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

  if (!call) return <EchoAppShell>{null}</EchoAppShell>;

  return (
    <EchoAppShell>
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
          <div className="flex flex-wrap items-center gap-3">
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
            {call.status === "ready" ? (
              <button
                className="text-xs text-accent underline-offset-2 hover:underline"
                onClick={() => setRegenOpen((v) => !v)}
              >
                {t("regenerate")}
              </button>
            ) : null}
          </div>
        </div>
        {regenOpen && call.status === "ready" ? (
          <div className="mb-3 space-y-2 rounded-lg border border-border bg-surface-2/40 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className="input h-9 min-h-0 py-0 text-xs"
                value={regenTemplate}
                onChange={(e) => setRegenTemplate(e.target.value)}
              >
                <option value="">{t("templateDefault")}</option>
                {SUMMARY_TEMPLATES.map((k) => (
                  <option key={k} value={k}>
                    {t(TEMPLATE_LABEL_KEY[k])}
                  </option>
                ))}
              </select>
              <input
                className="input h-9 min-h-0 py-0 text-xs"
                maxLength={500}
                placeholder={t("regenInstructionHint")}
                value={regenInstruction}
                onChange={(e) => setRegenInstruction(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void regenerate(); }}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                className="btn-primary h-8 min-h-0 px-3 text-xs"
                disabled={regenBusy}
                onClick={() => void regenerate()}
              >
                {t("regenGo")}
              </button>
              <button
                className="text-xs text-fg-muted underline-offset-2 hover:underline"
                onClick={() => setRegenOpen(false)}
              >
                {t("regenCancel")}
              </button>
            </div>
          </div>
        ) : null}
        {summary ? (
          <>
            {showSummaryEn && summaryEn === "loading" ? (
              <p className="text-sm text-fg-muted">{t("translating")}</p>
            ) : showSummaryEn && typeof summaryEn === "string" ? (
              /* the TRANSLATION view: LTR English, clearly a rendering of
                 the record rather than the record itself */
              <p className="ltr whitespace-pre-wrap text-start text-sm leading-8 text-fg">
                {summaryEn}
              </p>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-8 text-fg">{summary.body}</p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <p className="text-xs text-fg-muted ltr">{modelLabel(summary.model)}</p>
              <span className="flex-1" />
              {showSummaryEn && typeof summaryEn === "string" ? (
                <button
                  className="text-xs text-fg-muted underline-offset-2 hover:underline"
                  onClick={() => setShowSummaryEn(false)}
                >
                  {t("showOriginal")}
                </button>
              ) : summaryEn !== "loading" ? (
                <button
                  className="text-xs text-accent underline-offset-2 hover:underline"
                  onClick={() =>
                    typeof summaryEn === "string"
                      ? setShowSummaryEn(true)
                      : void translate("summary")
                  }
                >
                  {t("translateEn")}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            {call.status === "ready" ? t("noSummaryYet") : t("processing", { status: tStatus(call.status) })}
          </p>
        )}
        {translateError ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {translateError}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* transcript */}
        <Card className="!p-0">
          <div className="border-b border-border px-4 py-3">
            {/* the element behind the whole player — parts roll through it */}
            <audio
              ref={audioEl}
              className="hidden"
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                const part = audioParts?.find((p) => p.idx === loadedIdx.current);
                if (part) setPlayheadMs(part.offset_ms + el.currentTime * 1000);
              }}
              onEnded={() => {
                // a part ending is not the CALL ending unless it was the last
                const next = audioParts?.find((p) => p.idx === (loadedIdx.current ?? 0) + 1);
                if (next) void playFrom(next.offset_ms);
                else setPlaying(false);
              }}
              onPause={() => setPlaying(false)}
            />
            <div className="flex items-center gap-3">
              <button
                className="btn-primary h-10 min-h-0 w-10 px-0 disabled:opacity-50"
                onClick={togglePlay}
                disabled={audioParts === null || audioParts.length === 0}
                title={audioParts === null ? t("noAudio") : undefined}
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
              {showTranscriptEn && typeof transcriptEn === "string" ? (
                <button
                  className="text-xs text-fg-muted underline-offset-2 hover:underline"
                  onClick={() => setShowTranscriptEn(false)}
                >
                  {t("showOriginal")}
                </button>
              ) : transcriptEn !== "loading" && rows.length > 0 ? (
                <button
                  className="text-xs text-accent underline-offset-2 hover:underline"
                  onClick={() =>
                    typeof transcriptEn === "string"
                      ? setShowTranscriptEn(true)
                      : void translate("transcript")
                  }
                >
                  {t("translateEn")}
                </button>
              ) : null}
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
            {/* reading modes — display only; the toggles say so by holding
                their pressed state, and verbatim is always one press back */}
            {rows.length > 0 && !showTranscriptEn ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {speakers.length > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-pressed={speakerFilter === null}
                      onClick={() => setSpeakerFilter(null)}
                      className={`h-7 rounded-full px-2.5 text-xs transition-colors ${
                        speakerFilter === null
                          ? "bg-accent-soft font-semibold text-accent"
                          : "bg-surface-2 text-fg-muted hover:text-fg"
                      }`}
                    >
                      {t("allSpeakers")}
                    </button>
                    {speakers.map((sp) => (
                      <button
                        key={sp.id}
                        type="button"
                        aria-pressed={speakerFilter === sp.id}
                        onClick={() =>
                          setSpeakerFilter((prev) => (prev === sp.id ? null : sp.id))
                        }
                        className={`h-7 rounded-full px-2.5 text-xs transition-colors ${
                          speakerFilter === sp.id
                            ? "bg-accent-soft font-semibold text-accent"
                            : "bg-surface-2 text-fg-muted hover:text-fg"
                        }`}
                      >
                        {sp.label}
                      </button>
                    ))}
                  </>
                ) : null}
                <span className="ms-auto" />
                <button
                  type="button"
                  aria-pressed={cleanRead}
                  onClick={() => setCleanRead((v) => !v)}
                  className={`h-7 rounded-full px-2.5 text-xs transition-colors ${
                    cleanRead
                      ? "bg-accent-soft font-semibold text-accent"
                      : "bg-surface-2 text-fg-muted hover:text-fg"
                  }`}
                >
                  {t("cleanRead")}
                </button>
              </div>
            ) : null}
          </div>
          {showTranscriptEn && transcriptEn === "loading" ? (
            <p className="p-4 text-sm text-fg-muted">{t("translating")}</p>
          ) : showTranscriptEn && typeof transcriptEn === "string" ? (
            /* the whole transcript as one English document — timestamps
               survive translation because the prompt preserves structure */
            <p className="ltr whitespace-pre-wrap p-4 text-start text-sm leading-8 text-fg">
              {transcriptEn}
            </p>
          ) : (
          <ul className="divide-y divide-border">
            {(speakerFilter === null
              ? rows
              : rows.filter((row) => row.speaker_id === speakerFilter)
            ).map((row) => (
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
                  void playFrom(row.start_ms);
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
                      {(cleanRead
                        ? row.words.filter((word) => !isFillerWord(word.w))
                        : row.words
                      ).map((word, i) => (
                        <span
                          key={`${row.id}-${i}`}
                          className="cursor-pointer rounded px-0.5 hover:bg-accent/20"
                          onClick={(e) => {
                            e.stopPropagation();
                            // actually SEEK AND PLAY — this handler used to
                            // set two state flags and never touch the audio
                            // element: click-a-word looked wired and did
                            // nothing audible
                            setPlayheadMs(word.start_ms);
                            void playFrom(word.start_ms);
                          }}
                        >
                          {word.w}{" "}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="text-sm leading-7 text-fg">
                      {cleanRead ? stripFillers(row.text) : row.text}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          )}
        </Card>

        {/* speaker roster: rename the LABEL in place, and pick the person
            from the Echo speakers directory (user directive: a dropdown,
            not a dead button). Talk time is GONE from here — nothing
            measures it yet, and formatClock(undefined) was the NaN:NaN on
            the card. */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-fg">{t("speakers")}</h2>
          <ul className="space-y-4">
            {speakers.map((speaker) => (
              <li key={speaker.id} className="space-y-1.5">
                <input
                  className="input h-9 min-h-0 text-sm"
                  aria-label={t("speakerLabel")}
                  defaultValue={speaker.label}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== speaker.label) {
                      void api
                        .renameSpeaker(id, speaker.id, next)
                        .then(() => api.getSpeakers(id))
                        .then(setSpeakers)
                        .catch(() => undefined);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
                <select
                  className="input h-9 min-h-0 py-0 text-xs"
                  aria-label={t("linkSpeaker")}
                  value={speaker.person_id ?? ""}
                  onChange={(e) => {
                    void api
                      .linkSpeaker(id, speaker.id, e.target.value || null)
                      .then(() => api.getSpeakers(id))
                      .then(setSpeakers)
                      .catch(() => undefined);
                  }}
                >
                  <option value="">{t("noPerson")}</option>
                  {directory.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.display_name}
                    </option>
                  ))}
                </select>
                {speaker.person_name ? (
                  <p className="text-xs text-fg-muted">
                    {speaker.person_name}
                    {speaker.person_title ? ` — ${tTitles(speaker.person_title)}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <Link
            href="/echo/speakers"
            className="mt-3 inline-block text-xs text-accent underline-offset-2 hover:underline"
          >
            {t("manageSpeakers")}
          </Link>
        </Card>

        {/* notes & chapters (0079) — annotations of the call, never the
            record; author-attributed, delete = own only (the server's rule,
            mirrored as button visibility) */}
        {notes.length > 0 ? (
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-fg">{t("notesHeading")}</h2>
            <ul className="space-y-2">
              {notes.map((note) => (
                <li key={note.id} className="flex items-start gap-2 text-sm leading-6 text-fg">
                  <span className="ltr mt-0.5 shrink-0 text-xs text-fg-subtle">
                    {note.at_ms !== null
                      ? formatClock(Math.floor(note.at_ms / 1000), locale)
                      : "—"}
                  </span>
                  {note.kind === "chapter" ? (
                    <span className="mt-0.5 shrink-0 rounded bg-accent-soft px-1 py-0.5 text-[10px] font-semibold text-accent">
                      {t("chapterChip")}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1" dir="auto">{note.body}</span>
                  {me && note.created_by === me.id ? (
                    <button
                      type="button"
                      className="tap shrink-0 rounded px-1.5 text-xs text-fg-muted hover:text-danger"
                      onClick={() => {
                        void api
                          .deleteCallNote(note.id)
                          .then(() => api.callNotes(id))
                          .then(setNotes)
                          .catch(() => undefined);
                      }}
                    >
                      {t("noteDelete")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
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
