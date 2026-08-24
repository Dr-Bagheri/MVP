"use client";

import { Fragment, use, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call, CallNote, CallStatus, Me, Person, Speaker, SummaryVersion, TranscriptSegment } from "@/api/types";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { Link } from "@/i18n/routing";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { Card, Chip } from "@/components/ui";
import { formatClock, formatDate, formatDuration, digits } from "@/lib/format";
import { isFillerWord, stripFillers } from "@/lib/cleanRead";
import { IconAction, KebabMenu } from "@/components/rowActions";
import { IconArchive, IconFileText, IconGlobe, IconPencil, IconShare, IconSparkle, IconTag } from "@/components/icons";
import { SummaryBody } from "@/components/echo/SummaryBody";
import { faDisplay } from "@/lib/faDisplay";
import {
  canExportSubtitles,
  downloadText,
  exportFilename,
  markdownFrom,
  srtFrom,
  vttFrom,
} from "@/lib/exportCall";
import { notify } from "@/lib/notify";
import { redactSensitive } from "@/lib/redact";
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
  const tStatus = useTranslations("status");
  const tCalls = useTranslations("calls");
  const tCommon = useTranslations("common");
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
  /** the ⋯ menu's tag editor (2026-08-24) — whole-set, like the table's */
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");

  async function saveDetailTags(): Promise<void> {
    const tags = [...new Set(
      tagsDraft.split(/[,،]/).map((s) => s.trim()).filter((s) => s !== ""),
    )].slice(0, 10);
    setTagsOpen(false);
    try {
      await api.setCallTags(id, tags);
      setCall(await api.getCall(id));
    } catch { /* refusal already surfaced by the notification system */ }
  }
  /** redact identifier-shaped digit runs in EXPORTS (first slice of the
      redaction engine) — display stays verbatim; the toggle guards what
      leaves the product, not what the room said */
  const [redactExports, setRedactExports] = useState(false);
  /** Regenerate-summary panel (user directive, 2026-08-23): template from
      the ruled list + an optional instruction; the run rides the normal
      pipeline, so the existing status polling shows it and the new version
      arrives through the same fetch as every other. */
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenTemplate, setRegenTemplate] = useState<string>("");
  const [regenInstruction, setRegenInstruction] = useState("");
  const [regenFigures, setRegenFigures] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  async function regenerate(): Promise<void> {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      await api.resummarize(id, {
        ...(regenTemplate ? { template: regenTemplate } : {}),
        ...(regenInstruction.trim() ? { instruction: regenInstruction.trim() } : {}),
        ...(regenFigures ? { figures: true } : {}),
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
  /** player controls (2026-08-24): volume + speed live on the top bar */
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  /** 0092: edit modes — summary as a draft, one transcript line at a time */
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState("");
  /** speaker inline editor (2026-08-24): opened from the pencil ON the
      label in the transcript — the side roster card is gone */
  const [editSpeakerId, setEditSpeakerId] = useState<string | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState("");
  /** Word-like type size for the summary document, persisted per device */
  const [fontScale, setFontScale] = useState(1);
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem("neurai-summary-scale"));
      if (stored >= 0.85 && stored <= 1.4) setFontScale(stored);
    } catch { /* stays 1 */ }
  }, []);
  function bumpFontScale(delta: number): void {
    setFontScale((prev) => {
      const next = Math.round(Math.min(1.4, Math.max(0.85, prev + delta)) * 100) / 100;
      try { localStorage.setItem("neurai-summary-scale", String(next)); } catch { /* per-session */ }
      return next;
    });
  }

  async function saveSummaryEdit(): Promise<void> {
    const body = summaryDraft.trim();
    if (body === "") return;
    try {
      const { version } = await api.editSummary(id, body);
      setEditingSummary(false);
      const all = await api.getSummaries(id);
      setVersions(all);
      setShownVersion(version);
    } catch {
      notify(t("editFailed"), "warn");
    }
  }

  async function saveRowEdit(segmentId: string): Promise<void> {
    const text = rowDraft.trim();
    if (text === "") return;
    try {
      await api.editSegment(id, segmentId, text);
      setEditRowId(null);
      setRows(await api.getTranscript(id));
    } catch {
      notify(t("editFailed"), "warn");
    }
  }

  function exportSubtitles(kind: "srt" | "vtt"): void {
    if (!call) return;
    const out = redactExports
      ? rows.map((r) => ({ ...r, text: redactSensitive(r.text) }))
      : rows;
    downloadText(
      exportFilename(call.title, kind),
      kind === "srt" ? srtFrom(out, speakerName) : vttFrom(out, speakerName),
      "text/plain",
    );
  }

  function exportMarkdown(): void {
    if (!call) return;
    const out = redactExports
      ? rows.map((r) => ({ ...r, text: redactSensitive(r.text) }))
      : rows;
    downloadText(
      exportFilename(call.title, "md"),
      markdownFrom({
        title: call.title || t("untitledExport"),
        date: formatDate(call.started_at, locale),
        summary: redactExports
          ? (summary?.body ? redactSensitive(summary.body) : null)
          : (summary?.body ?? null),
        rows: out,
        speakerName,
        labels: { summary: t("summary"), transcript: t("transcript") },
      }),
      "text/markdown",
    );
  }

  async function saveSpeakerEdit(speakerId: string, personId: string | null | undefined): Promise<void> {
    try {
      const label = speakerDraft.trim();
      const current = speakers.find((s) => s.id === speakerId);
      if (label && label !== current?.label) {
        await api.renameSpeaker(id, speakerId, label);
      }
      if (personId !== undefined) {
        await api.linkSpeaker(id, speakerId, personId);
      }
      setSpeakers(await api.getSpeakers(id));
    } catch {
      notify(t("editFailed"), "warn");
    }
  }
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
    // a fresh src resets element properties in some browsers — reassert
    audioEl.current.volume = volume;
    audioEl.current.playbackRate = rate;
  };

  function setVolumeBoth(v: number): void {
    setVolume(v);
    if (audioEl.current) audioEl.current.volume = v;
  }

  function setRateBoth(r: number): void {
    setRate(r);
    if (audioEl.current) audioEl.current.playbackRate = r;
  }

  function stopPlayback(): void {
    audioEl.current?.pause();
    setPlaying(false);
    setPlayheadMs(0);
  }

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
   * Cleanup #7: notebook chapters render INSIDE the transcript, as dividers
   * at their moment — computed against the VISIBLE rows so a speaker filter
   * doesn't strand a divider before a hidden line.
   */
  const chaptersBefore = useMemo(() => {
    const anchored = notes
      .filter((n) => n.at_ms !== null)
      .sort((a, b) => (a.at_ms ?? 0) - (b.at_ms ?? 0));
    const visible = speakerFilter === null
      ? rows
      : rows.filter((r) => r.speaker_id === speakerFilter);
    const map = new Map<string, CallNote[]>();
    let ci = 0;
    for (const row of visible) {
      const before: CallNote[] = [];
      while (ci < anchored.length && (anchored[ci]?.at_ms ?? 0) <= row.start_ms) {
        before.push(anchored[ci]!);
        ci += 1;
      }
      if (before.length > 0) map.set(row.id, before);
    }
    return map;
  }, [notes, rows, speakerFilter]);

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
      {/* structured header (2026-08-24): title on its own line with a real
          division under it; status chip and model name are GONE — the page
          is about the record, not the pipeline */}
      <div className="mb-4 border-b border-border pb-4">
        <h1 className="text-2xl font-bold leading-tight text-fg">
          {call.title.trim() === "" ? tCalls("untitled") : call.title}
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-sm text-fg-muted">
          <span>{formatDate(call.started_at, locale)}</span>
          {call.duration_ms !== null ? (
            <span>{formatDuration(call.duration_ms / 1000, locale)}</span>
          ) : null}
          {(call.parts?.length ?? 0) > 1 ? (
            <span>{tCalls("parts", { count: digits(call.parts?.length ?? 0, locale) })}</span>
          ) : null}
        </p>
      </div>

      {/* THE PLAYER — on top of the summary, sticky while reading (user
          directive): seek bar, pause/stop, volume, speed from a menu */}
      <div className="sticky top-2 z-30 mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-sm">
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
        <button
          className="btn-primary h-9 w-9 min-h-0 shrink-0 px-0 disabled:opacity-50"
          onClick={togglePlay}
          disabled={audioParts === null || audioParts.length === 0}
          title={audioParts === null ? t("noAudio") : undefined}
          aria-label={playing ? t("pause") : t("play")}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          className="btn-secondary h-9 w-9 min-h-0 shrink-0 px-0 disabled:opacity-50"
          onClick={stopPlayback}
          disabled={audioParts === null || audioParts.length === 0}
          aria-label={t("stop")}
        >
          ◼
        </button>
        <span className="ltr shrink-0 text-xs tabular-nums text-fg-muted">
          {formatClock(playheadMs / 1000, locale)} /{" "}
          {call.duration_ms === null
            ? tCalls("durationUnknown")
            : formatClock(call.duration_ms / 1000, locale)}
        </span>
        <input
          type="range"
          dir="ltr"
          className="min-w-0 flex-1 accent-accent"
          min={0}
          max={Math.max(call.duration_ms ?? 0, playheadMs, 1)}
          value={playheadMs}
          disabled={audioParts === null || audioParts.length === 0}
          aria-label={t("seek")}
          onChange={(e) => {
            const ms = Number(e.target.value);
            setPlayheadMs(ms);
            void playFrom(ms);
          }}
        />
        <input
          type="range"
          dir="ltr"
          className="hidden w-20 shrink-0 accent-accent sm:block"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label={t("volume")}
          onChange={(e) => setVolumeBoth(Number(e.target.value))}
        />
        <KebabMenu
          label={t("speed")}
          trigger={<span className="ltr text-xs font-semibold">{rate}×</span>}
          items={[1, 1.5, 2].map((r) => ({
            key: String(r),
            label: `${r}×${rate === r ? " ✓" : ""}`,
            onSelect: () => setRateBoth(r),
          }))}
        />
      </div>

      {/* summary above the transcript, versioned */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">{t("summary")}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* versions as a SELECT (user report: the chip row grew without
                bound) — one control, any number of versions */}
            {versions.length > 0 ? (
              <select
                className="input h-8 min-h-0 w-auto py-0 text-xs"
                value={shownVersion ?? ""}
                aria-label={t("versions")}
                onChange={(e) => setShownVersion(Number(e.target.value))}
              >
                {[...versions].reverse().map((v) => (
                  <option key={v.version} value={v.version}>
                    {t("version", { n: digits(v.version, locale) })}
                    {v.model === "human" ? " ✎" : ""}
                  </option>
                ))}
              </select>
            ) : null}
            {/* Word-like type size (user directive): the whole document
                scales from one control pair */}
            <IconAction label={t("fontSmaller")} onClick={() => bumpFontScale(-0.1)}>
              <span className="text-[11px] font-semibold">A−</span>
            </IconAction>
            <IconAction label={t("fontLarger")} onClick={() => bumpFontScale(0.1)}>
              <span className="text-[13px] font-semibold">A+</span>
            </IconAction>
            {/* the summary is EDITABLE (0092): a new version, never in place */}
            {summary && !showSummaryEn ? (
              <IconAction
                label={t("editSummary")}
                onClick={() => {
                  setSummaryDraft(summary.body);
                  setEditingSummary(true);
                }}
              >
                <IconPencil />
              </IconAction>
            ) : null}
            {/* ONE ⋯ for everything else (user directive): translate,
                regenerate, exports, scope, archive, tags */}
            <KebabMenu
              label={tCalls("moreActions")}
              items={[
                {
                  key: "translate",
                  label: tCalls("translate"),
                  icon: <IconGlobe />,
                  onSelect: () => {
                    void translate("summary");
                    void translate("transcript");
                  },
                },
                ...(call.status === "ready"
                  ? [{
                      key: "regenerate",
                      label: t("regenerate"),
                      icon: <IconSparkle />,
                      onSelect: () => setRegenOpen(true),
                    }]
                  : []),
                {
                  key: "export-srt",
                  label: `${t("exportLabel")} SRT`,
                  icon: <IconFileText />,
                  disabled: !canExportSubtitles(rows),
                  onSelect: () => exportSubtitles("srt"),
                },
                {
                  key: "export-vtt",
                  label: `${t("exportLabel")} VTT`,
                  icon: <IconFileText />,
                  disabled: !canExportSubtitles(rows),
                  onSelect: () => exportSubtitles("vtt"),
                },
                {
                  key: "export-md",
                  label: `${t("exportLabel")} MD`,
                  icon: <IconFileText />,
                  disabled: rows.length === 0,
                  onSelect: () => exportMarkdown(),
                },
                {
                  key: "scope",
                  label: call.scope === "org" ? tCalls("makePrivate") : tCalls("makeOrg"),
                  icon: <IconShare />,
                  onSelect: () =>
                    void api
                      .setScope(id, call.scope === "org" ? "private" : "org")
                      .then(() => api.getCall(id))
                      .then(setCall)
                      .catch(() => undefined),
                },
                {
                  key: "archive",
                  label: call.archived_at === null ? tCalls("archive") : tCalls("unarchive"),
                  icon: <IconArchive />,
                  onSelect: () =>
                    void api
                      .setArchived(id, call.archived_at === null)
                      .then(() => api.getCall(id))
                      .then(setCall)
                      .catch(() => undefined),
                },
                ...(call.tags !== undefined
                  ? [{
                      key: "tags",
                      label: tCalls("tags"),
                      icon: <IconTag />,
                      onSelect: () => setTagsOpen((v) => !v),
                    }]
                  : []),
              ]}
            />
          </div>
        </div>
        {/* inline tag editor for the detail page, opened from ⋯ */}
        {tagsOpen && call.tags !== undefined ? (
          <div className="mb-3 flex items-center gap-2">
            <input
              className="input h-8 min-h-0 w-64 py-0 text-xs"
              autoFocus
              placeholder={tCalls("tagsHint")}
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveDetailTags();
                if (e.key === "Escape") setTagsOpen(false);
              }}
            />
            <button
              className="text-xs text-accent underline-offset-2 hover:underline"
              onClick={() => void saveDetailTags()}
            >
              {tCommon("save")}
            </button>
          </div>
        ) : null}
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
            <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
              <input
                type="checkbox"
                checked={regenFigures}
                onChange={(e) => setRegenFigures(e.target.checked)}
              />
              {t("regenFigures")}
            </label>
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
            {editingSummary ? (
              /* the EDIT mode (0092): a draft over the shown version; save
                 writes a NEW version authored 'human' — nothing overwritten */
              <div className="space-y-2">
                <textarea
                  className="input min-h-64 w-full py-2 text-sm leading-7"
                  value={summaryDraft}
                  autoFocus
                  onChange={(e) => setSummaryDraft(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button
                    className="btn-primary h-9 min-h-0 px-4 text-sm"
                    disabled={summaryDraft.trim() === ""}
                    onClick={() => void saveSummaryEdit()}
                  >
                    {tCommon("save")}
                  </button>
                  <button
                    className="btn-secondary h-9 min-h-0 px-4 text-sm"
                    onClick={() => setEditingSummary(false)}
                  >
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            ) : showSummaryEn && summaryEn === "loading" ? (
              <p className="text-sm text-fg-muted">{t("translating")}</p>
            ) : showSummaryEn && typeof summaryEn === "string" ? (
              /* the TRANSLATION view: LTR English, clearly a rendering of
                 the record rather than the record itself */
              <p className="ltr whitespace-pre-wrap text-start text-sm leading-8 text-fg">
                {summaryEn}
              </p>
            ) : (
              /* the DOCUMENT view (2026-08-24): chapters bold and larger,
                 paragraphs smaller — and the whole thing scales from the
                 A−/A+ control like a word processor */
              <div style={{ fontSize: `${0.875 * fontScale}rem` }}>
                <SummaryBody text={summary.body} />
              </div>
            )}
            {/* 0087 grounding verdict — rendered ONLY when a verdict exists.
                Absent field (un-migrated) and null (unchecked) both render
                nothing: an absent check must not look like a passed one. */}
            {summary.grounding ? (
              summary.grounding.clean ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
                  <span aria-hidden>✓</span> {t("groundingClean")}
                </p>
              ) : (
                <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                  <p className="text-xs font-semibold text-warning">{t("groundingFlagged")}</p>
                  <ul className="mt-1 space-y-1">
                    {summary.grounding.flags.map((flag, i) => (
                      <li key={i} className="text-xs leading-5 text-fg-muted">
                        «{flag.claim}»{flag.note ? ` — ${flag.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : null}
            {/* the model name is GONE from the reading view (user directive)
                — provenance lives in the version history, not on the page */}
            {showSummaryEn && typeof summaryEn === "string" ? (
              <div className="mt-3 flex justify-end">
                <button
                  className="text-xs text-fg-muted underline-offset-2 hover:underline"
                  onClick={() => setShowSummaryEn(false)}
                >
                  {t("showOriginal")}
                </button>
              </div>
            ) : null}
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

      <div className="space-y-4">
        {/* transcript — full width now: the speaker roster card is gone,
            speakers are edited ON their labels in the lines (2026-08-24) */}
        <Card className="!p-0">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-fg">{t("transcript")}</h2>
              <span className="flex-1" />
              {showTranscriptEn && typeof transcriptEn === "string" ? (
                <button
                  className="text-xs text-fg-muted underline-offset-2 hover:underline"
                  onClick={() => setShowTranscriptEn(false)}
                >
                  {t("showOriginal")}
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
                {/* exports moved into the summary card's ⋯ (user directive);
                    the redact stance stays visible because it changes what
                    every export contains */}
                <button
                  type="button"
                  aria-pressed={redactExports}
                  title={t("redactHint")}
                  onClick={() => setRedactExports((v) => !v)}
                  className={`h-7 rounded-full px-2.5 text-xs transition-colors ${
                    redactExports
                      ? "bg-accent-soft font-semibold text-accent"
                      : "bg-surface-2 text-fg-muted hover:text-fg"
                  }`}
                >
                  {t("redactToggle")}
                </button>
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
          ) : rows.length === 0
            && call.provisional_transcript
            && !transcriptionComplete(call.status) ? (
            /* M40: the live-caption preview — readable SECONDS after finish,
               loudly provisional, replaced (and schema-cleared) the moment
               the checked transcript lands */
            <div className="p-4">
              <Chip tone="warning">{t("provisionalChip")}</Chip>
              <p dir="auto" className="mt-3 whitespace-pre-wrap text-sm leading-8 text-fg">
                {faDisplay(call.provisional_transcript)}
              </p>
              <p className="mt-3 text-xs text-fg-muted">{t("provisionalHint")}</p>
            </div>
          ) : (
          <ul className="divide-y divide-border">
            {(speakerFilter === null
              ? rows
              : rows.filter((row) => row.speaker_id === speakerFilter)
            ).map((row) => (
              <Fragment key={row.id}>
              {(chaptersBefore.get(row.id) ?? []).map((chapter) => (
                <li key={`ch-${chapter.id}`} className="bg-surface-2/60 px-4 py-2">
                  <span className="text-xs font-bold text-fg">
                    {chapter.body.split("\n")[0]}
                  </span>
                  <span className="ms-2 text-[11px] text-fg-subtle ltr">
                    {formatClock((chapter.at_ms ?? 0) / 1000, locale)}
                  </span>
                </li>
              ))}
              <li
                className={`group flex gap-3 px-4 py-3 transition-colors ${
                  activeRowId === row.id ? "bg-accent-soft" : ""
                } ${rowSeekable(row) ? "cursor-pointer hover:bg-surface-2" : "cursor-default"}`}
                onClick={() => {
                  // Backend ruling: with no usable timing, do NOT silently
                  // seek to 0 — offer no seek at all. And an open editor
                  // must not turn a click into a seek.
                  if (!rowSeekable(row) || editRowId === row.id) return;
                  setPlayheadMs(row.start_ms);
                  void playFrom(row.start_ms);
                }}
              >
                <span className="w-14 shrink-0 pt-0.5 text-xs text-fg-muted ltr">
                  {formatClock(row.start_ms / 1000, locale)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span
                      className="relative flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-xs font-semibold text-accent">
                        {speakerName(row.speaker_id)}
                      </span>
                      {/* the pencil ON the speaker (user directive): rename
                          the label or link a directory person right here —
                          the side roster card is gone */}
                      {row.speaker_id !== null ? (
                        <IconAction
                          label={t("editSpeaker")}
                          className="h-5 w-5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => {
                            setEditSpeakerId((prev) =>
                              prev === row.speaker_id ? null : row.speaker_id);
                            setSpeakerDraft(
                              speakers.find((s) => s.id === row.speaker_id)?.label ?? "");
                          }}
                        >
                          <IconPencil width={12} height={12} />
                        </IconAction>
                      ) : null}
                      {editSpeakerId !== null && editSpeakerId === row.speaker_id ? (
                        <span className="absolute start-0 top-6 z-20 block w-64 rounded-lg border border-border bg-surface p-3 shadow-xl">
                          <input
                            className="input h-8 min-h-0 w-full py-0 text-xs"
                            aria-label={t("speakerLabel")}
                            placeholder={t("speakerLabel")}
                            value={speakerDraft}
                            autoFocus
                            onChange={(e) => setSpeakerDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                void saveSpeakerEdit(row.speaker_id!, undefined);
                                setEditSpeakerId(null);
                              }
                              if (e.key === "Escape") setEditSpeakerId(null);
                            }}
                          />
                          <select
                            className="input mt-2 h-8 min-h-0 w-full py-0 text-xs"
                            aria-label={t("linkSpeaker")}
                            value={speakers.find((s) => s.id === row.speaker_id)?.person_id ?? ""}
                            onChange={(e) =>
                              void saveSpeakerEdit(row.speaker_id!, e.target.value || null)
                            }
                          >
                            <option value="">{t("noPerson")}</option>
                            {directory.map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.display_name}
                              </option>
                            ))}
                          </select>
                          <span className="mt-2 flex items-center justify-between">
                            <button
                              className="text-xs text-accent underline-offset-2 hover:underline"
                              onClick={() => {
                                void saveSpeakerEdit(row.speaker_id!, undefined);
                                setEditSpeakerId(null);
                              }}
                            >
                              {tCommon("save")}
                            </button>
                            <Link
                              href="/echo/speakers"
                              className="text-[11px] text-fg-muted underline-offset-2 hover:underline"
                            >
                              {t("manageSpeakers")}
                            </Link>
                          </span>
                        </span>
                      ) : null}
                    </span>
                    {row.channel !== null ? (
                      <span className="text-[11px] text-fg-muted ltr">ch{row.channel + 1}</span>
                    ) : null}
                    {row.edited ? (
                      <span className="chip bg-surface-2 text-fg-muted">{t("edited")}</span>
                    ) : null}
                    {/* the LINE is editable too (0092) */}
                    <IconAction
                      label={t("editLine")}
                      className="ms-auto h-5 w-5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => {
                        setEditRowId(row.id);
                        setRowDraft(row.text);
                      }}
                    >
                      <IconPencil width={12} height={12} />
                    </IconAction>
                  </div>
                  {editRowId === row.id ? (
                    <span className="block" onClick={(e) => e.stopPropagation()}>
                      <textarea
                        className="input min-h-16 w-full py-1.5 text-sm leading-7"
                        value={rowDraft}
                        autoFocus
                        onChange={(e) => setRowDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditRowId(null);
                        }}
                      />
                      <span className="mt-1.5 flex items-center gap-2">
                        <button
                          className="text-xs text-accent underline-offset-2 hover:underline"
                          disabled={rowDraft.trim() === ""}
                          onClick={() => void saveRowEdit(row.id)}
                        >
                          {tCommon("save")}
                        </button>
                        <button
                          className="text-xs text-fg-muted underline-offset-2 hover:underline"
                          onClick={() => setEditRowId(null)}
                        >
                          {tCommon("cancel")}
                        </button>
                      </span>
                    </span>
                  ) : row.words.length > 0 ? (
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
                          {faDisplay(word.w)}{" "}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="text-sm leading-7 text-fg">
                      {faDisplay(cleanRead ? stripFillers(row.text) : row.text)}
                    </p>
                  )}
                </div>
              </li>
              </Fragment>
            ))}
          </ul>
          )}
        </Card>

        {/* the speaker roster CARD is gone (user directive, 2026-08-24):
            speakers are edited on their labels inside the transcript */}

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
