"use client";

import { Fragment, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  IconArchive, IconFileText, IconGlobe, IconPencil, IconRows, IconShare, IconSparkle, IconTag,
} from "@/components/icons";
import { SectionMenu } from "@/components/scaffold";
import { SummaryBody, parseSummary } from "@/components/echo/SummaryBody";
import { faDisplay } from "@/lib/faDisplay";
import {
  canExportSubtitles,
  downloadText,
  exportFilename,
  markdownFrom,
  srtFrom,
  vttFrom,
} from "@/lib/exportCall";
import {
  isGenericTitle, lineDiff, mergeParagraphs, suggestTitleFrom, talkTimes,
} from "@/lib/transcriptView";
import { notify } from "@/lib/notify";
import { openAssistant } from "@/lib/assistantBus";
import { redactSensitive } from "@/lib/redact";
import { SUMMARY_TEMPLATES, type SummaryTemplate } from "@echo/core/vocabulary";
import {
  customTemplates, deleteCustomTemplate, saveCustomTemplate, type CustomTemplate,
} from "@/lib/summaryTemplates";

/** Template → its literal message key: typed against the producer's union,
    so a new ruled template breaks this build until it gets a label. */
const TEMPLATE_LABEL_KEY: Record<SummaryTemplate, "templateBoard" | "templateGroup" | "templateTeam" | "templateItTeam" | "templateInterview"> = {
  board: "templateBoard",
  group: "templateGroup",
  team: "templateTeam",
  it_team: "templateItTeam",
  interview: "templateInterview",
};

/** Each ruled card shows an editable PREVIEW of what its template asks for —
    product strings, typed against the producer's union like the labels. */
const TEMPLATE_PREVIEW_KEY: Record<SummaryTemplate, "templatePreviewBoard" | "templatePreviewGroup" | "templatePreviewTeam" | "templatePreviewItTeam" | "templatePreviewInterview"> = {
  board: "templatePreviewBoard",
  group: "templatePreviewGroup",
  team: "templatePreviewTeam",
  it_team: "templatePreviewItTeam",
  interview: "templatePreviewInterview",
};

/**
 * Read view (SPEC "The core loop" #3) — since 2026-08-24 ONE document-like
 * card: header (title · date · the ⋯ menu), the sticky player, the summary
 * document, the transcript, notes, related records. Clicking a line seeks
 * the audio; parts share ONE continuous timeline.
 */

/** See the long provenance comment in git history: transcription is settled
    from `linking` onward, and the timing claim is withheld before that. */
const TRANSCRIPTION_COMPLETE: readonly CallStatus[] = ["linking", "summarizing", "ready"];
const transcriptionComplete = (status: string): boolean =>
  (TRANSCRIPTION_COMPLETE as readonly string[]).includes(status);

/** #19: the pipeline as STEPS — only statuses on the ladder render it. */
const PIPELINE_LADDER: readonly string[] = ["recording", "processing", "linking", "summarizing", "ready"];

/** #7: stable per-speaker tints (index into the roster, not the id hash —
    a roster is small and its order is stable within a call). */
const SPEAKER_TEXT = ["text-accent", "text-info", "text-success", "text-warning"] as const;
const SPEAKER_BORDER = ["border-accent/60", "border-info/60", "border-success/60", "border-warning/60"] as const;

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
  const tEcho = useTranslations("echo");
  const locale = useLocale();

  const [call, setCall] = useState<Call | null>(null);
  /** the record's own side menu (user directive, 2026-08-25): Summary is
      the default page, Transcript the second — the same two-pane anatomy
      every other sub page has. Local state, not routing: both sections are
      one record, and the player keeps playing across the switch. */
  const [section, setSection] = useState<"summary" | "transcript">("summary");
  const [rows, setRows] = useState<TranscriptSegment[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  /** The Echo speakers directory — the dropdown's option list. */
  const [directory, setDirectory] = useState<Person[]>([]);
  const [versions, setVersions] = useState<SummaryVersion[]>([]);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  /** Notes & chapters (0079) + who I am, for the delete-own gate. */
  const [notes, setNotes] = useState<CallNote[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  /** #16 related: the org's list, fetched once for the tag overlap. */
  const [allCalls, setAllCalls] = useState<Call[]>([]);
  /** English translations, display-only; the Persian record is the truth. */
  const [summaryEn, setSummaryEn] = useState<string | "loading" | null>(null);
  const [transcriptEn, setTranscriptEn] = useState<string | "loading" | null>(null);
  const [showSummaryEn, setShowSummaryEn] = useState(false);
  const [showTranscriptEn, setShowTranscriptEn] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  /** Reading modes — DISPLAY only, the record is untouched. */
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);
  const [cleanRead, setCleanRead] = useState(false);
  const [paragraphMode, setParagraphMode] = useState(false);
  const [followPlayback, setFollowPlayback] = useState(true);
  const [outlineMode, setOutlineMode] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  /** the ⋯ menu's tag editor — whole-set, like the table's */
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");
  /** #2 find in this record */
  const [findQ, setFindQ] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  /** #17 jump-back after a far seek */
  const [jumpBack, setJumpBack] = useState<{ scroll: number } | null>(null);
  /** #13 selection → note */
  const [selNote, setSelNote] = useState<{ text: string; atMs: number; x: number; y: number } | null>(null);
  /** #14 title suggestion editor (only over recorder-invented titles) */
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

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
  /** redact identifier-shaped digit runs in EXPORTS — display stays verbatim */
  const [redactExports, setRedactExports] = useState(false);
  /**
   * The regenerate CARDS (user directive, 2026-08-25): the five ruled
   * templates plus the person's own, each with an editable preview of its
   * prompt; pressing one adds a new version. Custom templates live in the
   * INTERIM local store (lib/summaryTemplates).
   */
  const [customs, setCustoms] = useState<CustomTemplate[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [newTpl, setNewTpl] = useState<{ name: string; prompt: string } | null>(null);
  const [regenFigures, setRegenFigures] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  useEffect(() => { setCustoms(customTemplates()); }, []);

  /**
   * One template card pressed = one NEW VERSION (user directive,
   * 2026-08-25). Ruled cards send their key (edited preview rides as the
   * instruction); custom cards send their prompt, and their NAME becomes
   * the version's stored label (0094).
   */
  async function regenerate(opts: {
    template?: string; instruction?: string; label?: string;
  }): Promise<void> {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      await api.resummarize(id, {
        ...(opts.template ? { template: opts.template } : {}),
        ...(opts.instruction?.trim() ? { instruction: opts.instruction.trim() } : {}),
        ...(opts.label ? { label: opts.label } : {}),
        ...(regenFigures ? { figures: true } : {}),
      });
      notify(t("regenStarted"));
      const fresh = await api.getCall(id).catch(() => null);
      if (fresh) setCall(fresh);
    } catch {
      notify(t("regenFailed"), "warn");
    } finally {
      setRegenBusy(false);
    }
  }

  /** the version picker's NAME for a version: v1 = the original; then the
      stored template label (ruled keys translate; custom names as authored) */
  function versionName(v: SummaryVersion): string {
    if (v.model === "human") return `${t("versionEdited")}`;
    if (v.version === 1) return t("versionOriginal");
    const label = v.template ?? null;
    if (label && (SUMMARY_TEMPLATES as readonly string[]).includes(label)) {
      return t(TEMPLATE_LABEL_KEY[label as SummaryTemplate]);
    }
    return label ?? t("version", { n: digits(v.version, locale) });
  }

  async function translate(what: "summary" | "transcript"): Promise<void> {
    const set = what === "summary" ? setSummaryEn : setTranscriptEn;
    const show = what === "summary" ? setShowSummaryEn : setShowTranscriptEn;
    setTranslateError(null);
    set("loading");
    show(true);
    try {
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
  /** player controls: volume + speed live on the sticky bar */
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  /** 0092: edit modes — summary as a draft, one transcript line at a time */
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  /** Word-like EDITOR controls (user directive): size + markdown shape */
  const [editFontSize, setEditFontSize] = useState(1);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState("");
  /** speaker inline editor — keyed by the ROW (user report: keying by the
      speaker opened every popover of that speaker at once) */
  const [editSpeakerRow, setEditSpeakerRow] = useState<string | null>(null);
  /** the popover closes like every menu: Esc anywhere, click outside */
  useEffect(() => {
    if (editSpeakerRow === null) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.("[data-speaker-pop]")) {
        setEditSpeakerRow(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditSpeakerRow(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [editSpeakerRow]);
  const [speakerDraft, setSpeakerDraft] = useState("");

  /** an edit that fails because 0092 hasn't run yet says WHICH failure */
  function editFailNotify(cause: unknown): void {
    const { status, detail } = cause as { status?: number; detail?: string };
    notify(
      status === 409 || detail === "not_migrated" ? t("editNotReady") : t("editFailed"),
      "warn",
    );
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
    } catch (cause) {
      editFailNotify(cause);
    }
  }

  async function saveRowEdit(segmentId: string): Promise<void> {
    const text = rowDraft.trim();
    if (text === "") return;
    try {
      await api.editSegment(id, segmentId, text);
      setEditRowId(null);
      setRows(await api.getTranscript(id));
    } catch (cause) {
      editFailNotify(cause);
    }
  }

  /** wrap the SELECTION (or insert at caret) — the editor's Bold/Heading/
      bullet controls write the same light markdown the document renders */
  function wrapDraftSelection(before: string, after = "", linePrefix = ""): void {
    const el = draftRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    let next: string;
    if (linePrefix) {
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      next = value.slice(0, lineStart) + linePrefix + value.slice(lineStart);
    } else {
      next = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
    }
    setSummaryDraft(next);
    el.focus();
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

  /** Minutes as a Word file (.doc = HTML Word opens natively): title, date,
      summary, then the transcript — RTL, redaction honoured like every
      export. A real letterhead .docx is the named upgrade; this ships the
      workflow today with zero dependencies. */
  function exportDoc(): void {
    if (!call) return;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const mask = (s: string) => (redactExports ? redactSensitive(s) : s);
    const title = call.title.trim() === "" ? tCalls("untitled") : call.title;
    const lines = rows.map((r) =>
      `<p style="margin:0 0 8px"><b>${esc(speakerName(r.speaker_id))}</b>
       <span style="color:#888">[${formatClock(r.start_ms / 1000, locale)}]</span><br/>
       ${esc(mask(r.text))}</p>`).join("\n");
    const html = `<html dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title></head>
      <body style="font-family:Vazirmatn,Tahoma,sans-serif;line-height:1.9">
      <h1 style="margin:0">${esc(title)}</h1>
      <p style="color:#666;margin:4px 0 18px">${formatDate(call.started_at, locale)}</p>
      ${summary ? `<h2>${esc(t("summary"))}</h2><div>${esc(mask(summary.body)).replace(/\n/g, "<br/>")}</div>` : ""}
      ${rows.length > 0 ? `<h2>${esc(t("transcript"))}</h2>${lines}` : ""}
      </body></html>`;
    downloadText(exportFilename(title, "doc"), html, "application/msword");
  }

  /** true = saved (the caller closes the popover); false = refused, and the
      refusal was said out loud — the popover stays for another try */
  async function saveSpeakerEdit(speakerId: string, personId: string | null | undefined): Promise<boolean> {
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
      notify(t("speakerSaved"));
      return true;
    } catch (cause) {
      // the server's own sentence when it gave one (owner-only link, etc.)
      const detail = (cause as { detail?: string }).detail;
      notify(detail || t("editFailed"), "warn");
      return false;
    }
  }
  /** Signed playback URLs, one per part. `null` = no audio to offer. */
  const [audioParts, setAudioParts] = useState<
    { idx: number; offset_ms: number; url: string }[] | null
  >(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  /** The part whose URL is loaded in the element right now. */
  const loadedIdx = useRef<number | null>(null);
  /** #1 the bounded transcript scroller (5-ish lines, its own scrollbar) */
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void api.getCall(id).then(setCall);
    void api.getTranscript(id).then(setRows);
    void api.getSpeakers(id).then(setSpeakers);
    void api.directory().then(setDirectory).catch(() => setDirectory([]));
    void api.callNotes(id).then(setNotes).catch(() => setNotes([]));
    void api.me().then(setMe).catch(() => setMe(null));
    void api.listCalls({ includeArchived: false }).then(setAllCalls).catch(() => setAllCalls([]));
    void api.getSummaries(id).then((all) => {
      setVersions(all);
      setShownVersion(all.at(-1)?.version ?? null);
    });
    void api
      .getCallAudio(id)
      .then((res) => setAudioParts(res?.parts ?? null))
      .catch(() => setAudioParts(null));
    const params = new URLSearchParams(window.location.search);
    /* ?translate=1 — the table's Translate action lands here */
    if (params.get("translate") === "1") {
      void translate("summary");
      void translate("transcript");
    }
    /* #15: ?t=<seconds> — a shared link opens seeked, never auto-playing.
       A timestamp link is ABOUT the transcript — open that section. */
    const tSec = Number(params.get("t"));
    if (Number.isFinite(tSec) && tSec > 0) {
      setPlayheadMs(tSec * 1000);
      setSection("transcript");
    }
    /* ?section= — the section survives sharing and the back button */
    if (params.get("section") === "transcript") setSection("transcript");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once per call
  }, [id]);

  /** the chosen section rides the URL (replace, not push — switching
      sections is not a navigation someone should have to back out of) */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (section === "transcript") url.searchParams.set("section", "transcript");
    else url.searchParams.delete("section");
    window.history.replaceState(null, "", url);
  }, [section]);

  /** PRINT = the summary document, nothing else (user report: menu fragments
      printed) — printing from the transcript flips to summary first */
  useEffect(() => {
    const onBefore = () => setSection("summary");
    window.addEventListener("beforeprint", onBefore);
    return () => window.removeEventListener("beforeprint", onBefore);
  }, []);

  /** pipeline polling — the page re-reads while the worker moves the call */
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

  /** #17: a click-to-seek remembers where you were READING */
  function seekWithReturn(ms: number): void {
    setJumpBack({ scroll: listRef.current?.scrollTop ?? 0 });
    setPlayheadMs(ms);
    void playFrom(ms);
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

  /** #4 keyboard: space play/pause, arrows seek, +/- speed — never while
      typing in a field */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        void playFrom(playheadMs + 5000);
      } else if (e.key === "ArrowLeft") {
        void playFrom(Math.max(0, playheadMs - 5000));
      } else if (e.key === "+" || e.key === "=") {
        setRateBoth(rate === 1 ? 1.5 : 2);
      } else if (e.key === "-") {
        setRateBoth(rate === 2 ? 1.5 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** #17: the chip expires — an offer to return is stale after half a minute */
  useEffect(() => {
    if (!jumpBack) return;
    const timer = setTimeout(() => setJumpBack(null), 30_000);
    return () => clearTimeout(timer);
  }, [jumpBack]);

  const activeRowId = useMemo(
    () => rows.find((r) => playheadMs >= r.start_ms && playheadMs < r.end_ms)?.id ?? null,
    [rows, playheadMs],
  );

  /** #1: while playing, the active line stays in view (toggleable in ⋯) */
  useEffect(() => {
    if (!playing || !followPlayback || !activeRowId) return;
    listRef.current
      ?.querySelector(`[data-row="${activeRowId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeRowId, playing, followPlayback]);

  const visibleRows = useMemo(
    () => (speakerFilter === null ? rows : rows.filter((r) => r.speaker_id === speakerFilter)),
    [rows, speakerFilter],
  );

  /** #2: matches over the VISIBLE rows; Enter walks them */
  const findMatches = useMemo(() => {
    const q = findQ.trim();
    if (q === "") return [];
    return visibleRows.filter((r) => r.text.includes(q)).map((r) => r.id);
  }, [findQ, visibleRows]);
  const findCurrent = findMatches.length > 0
    ? findMatches[((findIdx % findMatches.length) + findMatches.length) % findMatches.length]
    : null;

  /**
   * PROGRESSIVE transcript (user directive, 2026-08-25): the first 10 lines
   * render at once; scrolling the box reveals the rest in slabs. A seek or
   * a find whose target sits past the frontier pulls the frontier to it —
   * "show me 0:41" must never answer with ten lines from the beginning.
   */
  const [rowLimit, setRowLimit] = useState(10);
  const shownRows = useMemo(() => visibleRows.slice(0, rowLimit), [visibleRows, rowLimit]);
  useEffect(() => {
    const targetId = findCurrent ?? activeRowId;
    if (!targetId) return;
    const idx = visibleRows.findIndex((r) => r.id === targetId);
    if (idx >= rowLimit) setRowLimit(idx + 20);
  }, [findCurrent, activeRowId, visibleRows, rowLimit]);
  useEffect(() => {
    if (!findCurrent) return;
    listRef.current
      ?.querySelector(`[data-row="${findCurrent}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [findCurrent]);

  /** chapters render INSIDE the transcript, at their moment */
  const chaptersBefore = useMemo(() => {
    const anchored = notes
      .filter((n) => n.at_ms !== null)
      .sort((a, b) => (a.at_ms ?? 0) - (b.at_ms ?? 0));
    const map = new Map<string, CallNote[]>();
    let ci = 0;
    for (const row of visibleRows) {
      const before: CallNote[] = [];
      while (ci < anchored.length && (anchored[ci]?.at_ms ?? 0) <= row.start_ms) {
        before.push(anchored[ci]!);
        ci += 1;
      }
      if (before.length > 0) map.set(row.id, before);
    }
    return map;
  }, [notes, visibleRows]);

  /** #10 talk-time shares (only meaningful with >1 speaker) */
  const shares = useMemo(() => talkTimes(rows), [rows]);

  /** #16 related by SHARED TAGS — the only overlap this page can compute
      honestly from what it holds */
  const related = useMemo(() => {
    const mine = new Set(call?.tags ?? []);
    if (mine.size === 0) return [];
    return allCalls
      .filter((c) => c.id !== id && (c.tags ?? []).some((tag) => mine.has(tag)))
      .slice(0, 5);
  }, [allCalls, call, id]);

  const speakerName = useCallback((speakerId: string | null) => {
    if (speakerId === null) return t("unattributed");
    const speaker = speakers.find((s) => s.id === speakerId);
    return speaker?.person_name ?? speaker?.label ?? speakerId;
  }, [speakers, t]);

  const speakerIndex = useCallback(
    (speakerId: string | null) =>
      Math.max(0, speakers.findIndex((s) => s.id === speakerId)),
    [speakers],
  );

  /** #13: select transcript text → offer to keep it as a note */
  function onListMouseUp(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setSelNote(null);
    const text = sel.toString().trim();
    if (text.length < 3 || text.length > 500) return setSelNote(null);
    const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
    const li = node?.closest?.("[data-start]");
    if (!li || !listRef.current?.contains(li)) return setSelNote(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelNote({
      text,
      atMs: Number(li.getAttribute("data-start")),
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }

  async function saveSelectionNote(): Promise<void> {
    if (!selNote) return;
    const body = `«${selNote.text}»`;
    setSelNote(null);
    try {
      await api.addCallNote(id, { kind: "note", at_ms: selNote.atMs, body });
      setNotes(await api.callNotes(id));
      notify(t("selectionSaved"));
    } catch {
      notify(t("editFailed"), "warn");
    }
  }

  useCrumbTitle(call?.title);

  const summary = versions.find((v) => v.version === shownVersion) ?? null;
  const prevVersion = useMemo(() => {
    if (!summary) return null;
    return versions
      .filter((v) => v.version < summary.version)
      .sort((a, b) => b.version - a.version)[0] ?? null;
  }, [versions, summary]);

  if (!call) return <EchoAppShell>{null}</EchoAppShell>;

  const durMs = call.duration_ms ?? 0;
  const stepIdx = PIPELINE_LADDER.indexOf(call.status);
  /** what the WALL actually allows (0093): rename = owner or admin;
      directory LINK = the owner alone. The UI renders exactly that —
      a pencil the database refuses is how this page's speaker bug felt. */
  const mayEditCall = me !== null
    && (call.owner_id === me.id || me.role === "admin" || me.role === "owner");
  const ownsCall = me !== null && call.owner_id === me.id;
  const genericTitle = isGenericTitle(call.title);
  const titleSuggestion = genericTitle && summary ? suggestTitleFrom(summary.body) : null;

  const headings = summary
    ? parseSummary(summary.body).filter((b) => b.kind === "heading")
    : [];

  /** the ONE ⋯ menu, on the title row (user directive) */
  const menuItems = [
    {
      key: "ask",
      label: t("askAbout"),
      icon: <IconSparkle />,
      onSelect: () =>
        openAssistant({
          draft: locale === "fa"
            ? `دربارهٔ رکورد «${call.title || tCalls("untitled")}»: `
            : `About the record "${call.title || tCalls("untitled")}": `,
        }),
    },
    {
      key: "translate",
      label: tCalls("translate"),
      icon: <IconGlobe />,
      onSelect: () => {
        void translate("summary");
        void translate("transcript");
      },
    },
    /* regenerate LEFT the kebab (user directive, 2026-08-25): it lives as
       the template cards under the summary now */
    ...(call.status === "failed"
      ? [{
          key: "retry",
          label: tCalls("retry"),
          icon: <IconSparkle />,
          onSelect: () =>
            void api.retryCall(id)
              .then(() => api.getCall(id)).then(setCall)
              .then(() => notify(tCalls("retryStarted")))
              .catch(() => notify(tCommon("actionFailed"), "warn")),
        }]
      : []),
    {
      key: "export",
      label: t("exportMenu"),
      icon: <IconFileText />,
      sub: [
        {
          key: "export-srt", label: "SRT",
          disabled: !canExportSubtitles(rows),
          onSelect: () => exportSubtitles("srt"),
        },
        {
          key: "export-vtt", label: "VTT",
          disabled: !canExportSubtitles(rows),
          onSelect: () => exportSubtitles("vtt"),
        },
        {
          key: "export-md", label: "Markdown",
          disabled: rows.length === 0,
          onSelect: () => exportMarkdown(),
        },
        {
          /* minutes as a Word file: an HTML .doc — Word opens it natively,
             letterhead-light (title · date · summary · transcript), RTL */
          key: "export-doc", label: "Word (.doc)",
          disabled: rows.length === 0 && !summary,
          onSelect: () => exportDoc(),
        },
        {
          key: "export-redact",
          label: `${t("redactToggle")}${redactExports ? " ✓" : ""}`,
          keepOpen: true,
          onSelect: () => setRedactExports((v) => !v),
        },
      ],
    },
    {
      key: "copy-summary",
      label: t("copySummary"),
      icon: <IconFileText />,
      disabled: !summary,
      onSelect: () => {
        if (!summary) return;
        void navigator.clipboard.writeText(summary.body).then(() => notify(t("copied")));
      },
    },
    { key: "print", label: t("printLabel"), icon: <IconFileText />, onSelect: () => window.print() },
    /* view toggles — grouped into a FLYOUT (2026-08-25: a long kebab never
       scrolls; too many items become a sub-menu instead) */
    {
      key: "view",
      label: t("viewMenu"),
      icon: <IconRows />,
      sub: [
        {
          key: "view-follow",
          label: `${t("followPlayback")}${followPlayback ? " ✓" : ""}`,
          keepOpen: true,
          onSelect: () => setFollowPlayback((v) => !v),
        },
        {
          key: "view-paragraphs",
          label: `${t("paragraphMode")}${paragraphMode ? " ✓" : ""}`,
          keepOpen: true,
          onSelect: () => setParagraphMode((v) => !v),
        },
        {
          key: "view-fillers",
          label: `${t("cleanRead")}${cleanRead ? " ✓" : ""}`,
          keepOpen: true,
          onSelect: () => setCleanRead((v) => !v),
        },
        {
          key: "view-outline",
          label: `${t("outlineMode")}${outlineMode ? " ✓" : ""}`,
          keepOpen: true,
          disabled: headings.length < 2,
          onSelect: () => setOutlineMode((v) => !v),
        },
      ],
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
  ];

  return (
    <EchoAppShell
      menu={
        <SectionMenu
          navLabel={t("docSections")}
          /* the pane title names the PLACE, not the record (user directive):
             this page lives under «ضبط‌ها», and its own crumb carries the title */
          heading={tEcho("section.records")}
          activeSlug={section}
          groups={[{
            key: "doc",
            title: t("docSections"),
            items: [
              {
                slug: "summary",
                href: `/calls/${id}`,
                label: t("summary"),
                icon: <IconFileText />,
                preventNavigation: true,
                onSelect: () => setSection("summary"),
              },
              {
                slug: "transcript",
                href: `/calls/${id}`,
                label: t("transcript"),
                icon: <IconRows />,
                preventNavigation: true,
                onSelect: () => setSection("transcript"),
              },
            ],
          }]}
        />
      }
    >
      {/* ONE document card (user directive, 2026-08-24): header, player,
          summary, transcript, notes — divisions inside one box, not a
          stack of separate cards. Since 2026-08-25 the summary and the
          transcript are SECTIONS picked in the side menu; the header and
          the player stay above both. */}
      <Card className="!m-5 !p-0">
        {/* ── header: title · date · ⋯ ─────────────────────────────────── */}
        <div className="px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {titleDraft !== null ? (
                <span className="flex items-center gap-2">
                  <input
                    className="input h-10 min-h-0 w-full max-w-md text-lg font-bold"
                    value={titleDraft}
                    autoFocus
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setTitleDraft(null);
                      if (e.key === "Enter" && titleDraft.trim()) {
                        void api.setCallTitle(id, titleDraft.trim())
                          .then(() => api.getCall(id)).then(setCall)
                          .catch(() => notify(tCommon("actionFailed"), "warn"));
                        setTitleDraft(null);
                      }
                    }}
                  />
                  <button
                    className="btn-primary h-9 min-h-0 px-3 text-xs"
                    disabled={titleDraft.trim() === ""}
                    onClick={() => {
                      void api.setCallTitle(id, titleDraft.trim())
                        .then(() => api.getCall(id)).then(setCall)
                        .catch(() => notify(tCommon("actionFailed"), "warn"));
                      setTitleDraft(null);
                    }}
                  >
                    {tCommon("save")}
                  </button>
                </span>
              ) : (
                <h1 className="group flex items-center gap-2 text-2xl font-bold leading-tight text-fg">
                  <span className="truncate">
                    {call.title.trim() === "" ? tCalls("untitled") : call.title}
                  </span>
                  {/* pencil-on-hover (user directive, 2026-08-25): the title
                      is always editable to whoever the wall lets edit — the
                      sparkle stays for recorder-invented names only */}
                  {mayEditCall ? (
                    <IconAction
                      label={tCalls("rename")}
                      className="no-print opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => setTitleDraft(call.title)}
                    >
                      <IconPencil width={14} height={14} />
                    </IconAction>
                  ) : null}
                  {/* #14: only a recorder-invented name gets second-guessed */}
                  {titleSuggestion ? (
                    <IconAction
                      label={t("suggestTitle")}
                      className="no-print"
                      onClick={() => setTitleDraft(titleSuggestion)}
                    >
                      <IconSparkle width={14} height={14} />
                    </IconAction>
                  ) : null}
                </h1>
              )}
            </div>
            {/* the date IN FRONT of the title row, the ⋯ beside it */}
            <div className="no-print flex shrink-0 items-center gap-2 pt-1 text-sm text-fg-muted">
              <span>{formatDate(call.started_at, locale)}</span>
              {call.duration_ms !== null ? (
                <span>· {formatDuration(call.duration_ms / 1000, locale)}</span>
              ) : null}
              <KebabMenu label={tCalls("moreActions")} items={menuItems} />
            </div>
          </div>

          {/* #19: a call still in the pipeline shows STAGES, not one word */}
          {stepIdx >= 0 && call.status !== "ready" ? (
            <ol className="no-print mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              {PIPELINE_LADDER.map((step, i) => (
                <Fragment key={step}>
                  {i > 0 ? <span aria-hidden className="text-fg-subtle">–</span> : null}
                  <li
                    className={
                      i < stepIdx
                        ? "text-fg-muted"
                        : i === stepIdx
                          ? "font-semibold text-accent"
                          : "text-fg-subtle"
                    }
                  >
                    {tStatus(step)}
                  </li>
                </Fragment>
              ))}
            </ol>
          ) : null}
          {call.status === "failed" ? (
            <p className="mt-3 text-xs text-danger">{tStatus("failed")}</p>
          ) : null}

          {/* inline tag editor, opened from ⋯ */}
          {tagsOpen && call.tags !== undefined ? (
            <div className="no-print mt-3 flex items-center gap-2">
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
        </div>

        {/* ── the player — sticky UNDER the app chrome (z below every menu) */}
        <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-t border-border bg-surface px-5 py-2.5">
          <audio
            ref={audioEl}
            className="hidden"
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              const part = audioParts?.find((p) => p.idx === loadedIdx.current);
              if (part) setPlayheadMs(part.offset_ms + el.currentTime * 1000);
            }}
            onEnded={() => {
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
          {/* seek + the timeline map (#11) + chapter ticks (#5) */}
          <div className="relative min-w-0 flex-1" dir="ltr">
            <input
              type="range"
              className="w-full accent-accent"
              min={0}
              max={Math.max(durMs, playheadMs, 1)}
              value={playheadMs}
              disabled={audioParts === null || audioParts.length === 0}
              aria-label={t("seek")}
              onChange={(e) => {
                const ms = Number(e.target.value);
                setPlayheadMs(ms);
                void playFrom(ms);
              }}
            />
            {durMs > 0 ? (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-full h-1">
                {rows.map((r) => (
                  <span
                    key={r.id}
                    className="absolute top-0 h-1 rounded-full bg-accent/25"
                    style={{
                      left: `${(r.start_ms / durMs) * 100}%`,
                      width: `${Math.max(0.4, ((r.end_ms - r.start_ms) / durMs) * 100)}%`,
                    }}
                  />
                ))}
                {notes.filter((n) => n.at_ms !== null && n.kind === "chapter").map((n) => (
                  <span
                    key={n.id}
                    className="absolute -top-0.5 h-2 w-0.5 rounded bg-warning"
                    style={{ left: `${((n.at_ms ?? 0) / durMs) * 100}%` }}
                  />
                ))}
              </div>
            ) : null}
          </div>
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
          {/* a CHAPTER minted at the playhead — it joins the seekbar's marks
              and the notes list; native prompt is the honest v1 name box */}
          <IconAction
            label={t("chapterAdd")}
            onClick={() => {
              const name = window.prompt(t("chapterPrompt"))?.trim();
              if (!name) return;
              void api
                .addCallNote(id, { kind: "chapter", at_ms: Math.floor(playheadMs), body: name })
                .then(() => api.callNotes(id)).then(setNotes)
                .then(() => notify(t("noteAdded")))
                .catch(() => notify(tCommon("actionFailed"), "warn"));
            }}
          >
            <IconTag width={14} height={14} />
          </IconAction>
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

        {/* ── the summary document (its own SECTION since 2026-08-25) ──── */}
        {section === "summary" ? (
        <section className="border-t border-border px-5 py-4">
          <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">{t("summary")}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {versions.length > 0 ? (
                <select
                  className="input h-8 min-h-0 w-auto py-0 text-xs"
                  value={shownVersion ?? ""}
                  aria-label={t("versions")}
                  onChange={(e) => {
                    setShownVersion(Number(e.target.value));
                    setCompareOpen(false);
                  }}
                >
                  {/* named by TEMPLATE (user directive) with provenance:
                      «صورت‌جلسه · ۳ شهریور · gemini» — the first is Original */}
                  {[...versions].reverse().map((v) => (
                    <option key={v.version} value={v.version}>
                      {versionName(v)}
                      {` · ${formatDate(v.created_at, locale)}`}
                      {v.model !== "human" ? ` · ${v.model.split("/").pop()}` : " ✎"}
                    </option>
                  ))}
                </select>
              ) : null}
              {/* #6: what changed against the previous version */}
              {prevVersion ? (
                <button
                  type="button"
                  aria-pressed={compareOpen}
                  onClick={() => setCompareOpen((v) => !v)}
                  className={`h-8 rounded-full px-2.5 text-xs transition-colors ${
                    compareOpen
                      ? "bg-accent-soft font-semibold text-accent"
                      : "bg-surface-2 text-fg-muted hover:text-fg"
                  }`}
                >
                  {t("compare")}
                </button>
              ) : null}
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
            </div>
          </div>

          {summary ? (
            <>
              {editingSummary ? (
                <div className="space-y-2">
                  {/* the WORD-like editor bar (user directive): size + shape */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      className="input h-8 min-h-0 w-auto py-0 text-xs"
                      value={editFontSize}
                      aria-label={t("editorSize")}
                      onChange={(e) => setEditFontSize(Number(e.target.value))}
                    >
                      <option value={0.875}>{t("sizeSmall")}</option>
                      <option value={1}>{t("sizeNormal")}</option>
                      <option value={1.2}>{t("sizeLarge")}</option>
                    </select>
                    <IconAction label={t("editorBold")} onClick={() => wrapDraftSelection("**", "**")}>
                      <span className="text-xs font-black">B</span>
                    </IconAction>
                    <IconAction label={t("editorHeading")} onClick={() => wrapDraftSelection("", "", "### ")}>
                      <span className="text-xs font-bold">H</span>
                    </IconAction>
                    <IconAction label={t("editorBullet")} onClick={() => wrapDraftSelection("", "", "- ")}>
                      <span className="text-xs font-bold">•</span>
                    </IconAction>
                  </div>
                  <textarea
                    ref={draftRef}
                    className="input min-h-64 w-full py-2 leading-7"
                    style={{ fontSize: `${0.875 * editFontSize}rem` }}
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
              ) : compareOpen && prevVersion ? (
                /* #6: the diff view — removed struck, added tinted */
                <div className="space-y-0.5 text-sm leading-7">
                  {lineDiff(prevVersion.body, summary.body).map((line, i) => (
                    <p
                      key={i}
                      className={
                        line.kind === "added"
                          ? "rounded bg-success/10 px-1 text-fg"
                          : line.kind === "removed"
                            ? "rounded bg-danger/10 px-1 text-fg-muted line-through"
                            : "px-1 text-fg-muted"
                      }
                    >
                      {faDisplay(line.text) || " "}
                    </p>
                  ))}
                </div>
              ) : showSummaryEn && summaryEn === "loading" ? (
                <p className="text-sm text-fg-muted">{t("translating")}</p>
              ) : showSummaryEn && typeof summaryEn === "string" ? (
                /* SIDE-BY-SIDE: the Persian summary stays beside the English */
                <div className="grid gap-6 md:grid-cols-2">
                  <SummaryBody text={summary.body} />
                  <p className="ltr whitespace-pre-wrap border-t border-border pt-4 text-start text-sm leading-8 text-fg md:border-s md:border-t-0 md:ps-6 md:pt-0">
                    {summaryEn}
                  </p>
                </div>
              ) : outlineMode && headings.length >= 2 ? (
                /* #18: the document as its chapter list */
                <ul className="space-y-1.5">
                  {headings.map((h, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="text-sm font-semibold text-accent underline-offset-2 hover:underline"
                        onClick={() => setOutlineMode(false)}
                      >
                        {faDisplay(h.text ?? "")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <SummaryBody text={summary.body} />
              )}
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
              {showSummaryEn && typeof summaryEn === "string" ? (
                <div className="no-print mt-3 flex justify-end">
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

          {/* ── REGENERATE (user directive, 2026-08-25): template CARDS under
              the summary — each press = one new version, named by its card;
              previews are editable prompts; «+» authors a new template ──── */}
          {call.status === "ready" ? (
            <div className="no-print mt-6 border-t border-border pt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg">{t("regenTitle")}</h3>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={regenFigures}
                    onChange={(e) => setRegenFigures(e.target.checked)}
                  />
                  {t("regenFigures")}
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {SUMMARY_TEMPLATES.map((k) => {
                  const fallback = t(TEMPLATE_PREVIEW_KEY[k]);
                  const value = previews[k] ?? fallback;
                  return (
                    <div key={k} className="flex flex-col rounded-xl border border-border bg-surface-2/40 p-3">
                      <p className="mb-2 text-sm font-semibold text-fg">{t(TEMPLATE_LABEL_KEY[k])}</p>
                      <textarea
                        className="input min-h-20 flex-1 resize-none py-1.5 text-xs leading-6"
                        aria-label={t("templatePromptLabel")}
                        value={value}
                        onChange={(e) => setPreviews((p) => ({ ...p, [k]: e.target.value }))}
                      />
                      <button
                        className="btn-primary mt-2 h-9 min-h-0 text-xs"
                        disabled={regenBusy}
                        onClick={() => void regenerate({
                          template: k,
                          // an edited preview rides as the instruction; the
                          // untouched default stays the template's own shape
                          ...(value.trim() !== fallback.trim()
                            ? { instruction: value }
                            : {}),
                          label: k,
                        })}
                      >
                        {t("regenGo")}
                      </button>
                    </div>
                  );
                })}
                {customs.map((c) => {
                  const key = `custom:${c.name}`;
                  const value = previews[key] ?? c.prompt;
                  return (
                    <div key={key} className="flex flex-col rounded-xl border border-accent/40 bg-surface-2/40 p-3">
                      <p className="mb-2 flex items-center justify-between text-sm font-semibold text-fg">
                        <span className="truncate">{c.name}</span>
                        <button
                          className="text-xs font-normal text-fg-muted hover:text-danger"
                          aria-label={t("templateDelete")}
                          title={t("templateDelete")}
                          onClick={() => setCustoms(deleteCustomTemplate(c.name))}
                        >
                          ✕
                        </button>
                      </p>
                      <textarea
                        className="input min-h-20 flex-1 resize-none py-1.5 text-xs leading-6"
                        aria-label={t("templatePromptLabel")}
                        value={value}
                        onChange={(e) => setPreviews((p) => ({ ...p, [key]: e.target.value }))}
                        onBlur={() => {
                          if (value.trim() && value !== c.prompt) {
                            setCustoms(saveCustomTemplate({ name: c.name, prompt: value }));
                          }
                        }}
                      />
                      <button
                        className="btn-primary mt-2 h-9 min-h-0 text-xs"
                        disabled={regenBusy || value.trim() === ""}
                        onClick={() => void regenerate({ instruction: value, label: c.name })}
                      >
                        {t("regenGo")}
                      </button>
                    </div>
                  );
                })}
                {newTpl ? (
                  <div className="flex flex-col rounded-xl border border-dashed border-border-strong p-3">
                    <input
                      className="input mb-2 h-8 min-h-0 py-0 text-xs"
                      maxLength={60}
                      placeholder={t("templateNameHint")}
                      value={newTpl.name}
                      autoFocus
                      onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })}
                    />
                    <textarea
                      className="input min-h-20 flex-1 resize-none py-1.5 text-xs leading-6"
                      maxLength={500}
                      placeholder={t("templatePromptHint")}
                      value={newTpl.prompt}
                      onChange={(e) => setNewTpl({ ...newTpl, prompt: e.target.value })}
                    />
                    <span className="mt-2 flex items-center gap-2">
                      <button
                        className="btn-primary h-9 min-h-0 flex-1 text-xs"
                        disabled={!newTpl.name.trim() || !newTpl.prompt.trim()}
                        onClick={() => {
                          setCustoms(saveCustomTemplate(newTpl));
                          setNewTpl(null);
                        }}
                      >
                        {t("templateSave")}
                      </button>
                      <button
                        className="text-xs text-fg-muted underline-offset-2 hover:underline"
                        onClick={() => setNewTpl(null)}
                      >
                        {t("regenCancel")}
                      </button>
                    </span>
                  </div>
                ) : (
                  <button
                    className="tap flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border-strong text-fg-muted transition-colors hover:border-accent hover:text-fg"
                    onClick={() => setNewTpl({ name: "", prompt: "" })}
                  >
                    <span className="text-2xl leading-none" aria-hidden>＋</span>
                    <span className="mt-1 text-xs">{t("templateAdd")}</span>
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </section>
        ) : null}

        {/* ── the transcript (the menu's second section) ────────────────── */}
        {section === "transcript" ? (
        <section className="border-t border-border">
          <div className="no-print border-b border-border px-5 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-fg">{t("transcript")}</h2>
              {/* #2: find in this record */}
              {rows.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  <input
                    className="input h-7 min-h-0 w-40 py-0 text-xs"
                    placeholder={t("findPlaceholder")}
                    value={findQ}
                    onChange={(e) => {
                      setFindQ(e.target.value);
                      setFindIdx(0);
                    }}
                    onKeyDown={(e) => {
                      // Enter cycles forward, Shift+Enter backward
                      if (e.key === "Enter") setFindIdx((i) => i + (e.shiftKey ? -1 : 1));
                      if (e.key === "Escape") setFindQ("");
                    }}
                  />
                  {findQ.trim() !== "" ? (
                    <span className="ltr text-xs tabular-nums text-fg-muted">
                      {findMatches.length === 0
                        ? "0"
                        : `${(((findIdx % findMatches.length) + findMatches.length) % findMatches.length) + 1}/${findMatches.length}`}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span className="flex-1" />
              {showTranscriptEn && typeof transcriptEn === "string" ? (
                <button
                  className="text-xs text-fg-muted underline-offset-2 hover:underline"
                  onClick={() => setShowTranscriptEn(false)}
                >
                  {t("showOriginal")}
                </button>
              ) : null}
              <span className="hidden text-xs text-fg-muted md:inline">
                {call.transcript_timing === "full"
                  ? t("seekHint")
                  : call.transcript_timing === "mixed"
                    ? t("seekHintMixed")
                    : t("seekHintLine")}
              </span>
            </div>
            {/* speaker chips + the talk-time bar (#10) */}
            {rows.length > 0 && !showTranscriptEn && speakers.length > 1 ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
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
                      {sp.person_name ?? sp.label}
                    </button>
                  ))}
                </div>
                <div className="flex h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  {shares.map((share) => (
                    <span
                      key={share.speaker_id ?? "none"}
                      className={`${["bg-accent", "bg-info", "bg-success", "bg-warning"][speakerIndex(share.speaker_id) % 4]}`}
                      style={{ width: `${share.share * 100}%` }}
                      title={`${speakerName(share.speaker_id)} — ${formatClock(share.ms / 1000, locale)}`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {showTranscriptEn && transcriptEn === "loading" ? (
            <p className="p-4 text-sm text-fg-muted">{t("translating")}</p>
          ) : showTranscriptEn && typeof transcriptEn === "string" ? (
            /* SIDE-BY-SIDE (user directive): the Persian record stays on
               screen beside its English rendering — a translation is a lens,
               not a replacement */
            <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="max-h-[24rem] overflow-y-auto p-4">
                {rows.slice(0, 200).map((r) => (
                  <p key={r.id} dir="auto" className="mb-2 text-sm leading-8 text-fg">
                    <span className="me-2 text-xs text-fg-muted ltr">
                      {formatClock(r.start_ms / 1000, locale)}
                    </span>
                    {r.text}
                  </p>
                ))}
              </div>
              <p className="ltr max-h-[24rem] overflow-y-auto whitespace-pre-wrap p-4 text-start text-sm leading-8 text-fg">
                {transcriptEn}
              </p>
            </div>
          ) : rows.length === 0
            && !call.provisional_transcript
            && transcriptionComplete(call.status) ? (
            /* WHICH nothing: transcription finished and found no speech */
            <p className="p-4 text-sm text-fg-muted">{t("noTranscriptRows")}</p>
          ) : rows.length === 0
            && call.provisional_transcript
            && !transcriptionComplete(call.status) ? (
            <div className="p-4">
              <Chip tone="warning">{t("provisionalChip")}</Chip>
              <p dir="auto" className="mt-3 whitespace-pre-wrap text-sm leading-8 text-fg">
                {faDisplay(call.provisional_transcript)}
              </p>
              <p className="mt-3 text-xs text-fg-muted">{t("provisionalHint")}</p>
            </div>
          ) : (
          /* #the 5-line window (user directive): the transcript scrolls in
             its own box instead of stretching the page to infinity */
          <div
            ref={listRef}
            className="max-h-[24rem] overflow-y-auto"
            onMouseUp={onListMouseUp}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 200
                  && rowLimit < visibleRows.length) {
                setRowLimit((n) => n + 30);
              }
            }}
          >
          {paragraphMode ? (
            /* #8: consecutive same-speaker lines flow as paragraphs */
            <ul className="divide-y divide-border">
              {mergeParagraphs(shownRows).map((block) => (
                <li
                  key={block.ids[0]}
                  data-row={block.ids[0]}
                  data-start={block.start_ms}
                  className="flex cursor-pointer gap-3 px-5 py-3 hover:bg-surface-2"
                  onClick={() => seekWithReturn(block.start_ms)}
                >
                  <span className="w-14 shrink-0 pt-0.5 text-xs text-fg-muted ltr">
                    {formatClock(block.start_ms / 1000, locale)}
                  </span>
                  <div className="min-w-0">
                    <span className={`text-xs font-semibold ${SPEAKER_TEXT[speakerIndex(block.speaker_id) % 4]}`}>
                      {speakerName(block.speaker_id)}
                    </span>
                    <p className="mt-0.5 text-sm leading-7 text-fg">
                      {faDisplay(
                        block.texts
                          .map((x) => (cleanRead ? stripFillers(x) : x))
                          .join(" "),
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
          <ul className="divide-y divide-border">
            {shownRows.map((row) => (
              <Fragment key={row.id}>
              {(chaptersBefore.get(row.id) ?? []).map((chapter) => (
                <li key={`ch-${chapter.id}`} className="bg-surface-2/60 px-5 py-2">
                  <span className="text-xs font-bold text-fg">
                    {chapter.body.split("\n")[0]}
                  </span>
                  <span className="ms-2 text-[11px] text-fg-subtle ltr">
                    {formatClock((chapter.at_ms ?? 0) / 1000, locale)}
                  </span>
                </li>
              ))}
              <li
                data-row={row.id}
                data-start={row.start_ms}
                className={`group flex gap-3 border-s-2 px-5 py-3 transition-colors ${
                  speakers.length > 1 && row.speaker_id !== null
                    ? SPEAKER_BORDER[speakerIndex(row.speaker_id) % 4]
                    : "border-transparent"
                } ${
                  findCurrent === row.id
                    ? "bg-warning/10"
                    : findMatches.includes(row.id)
                      ? "bg-warning/5" // every match marked; the current one darker
                      : activeRowId === row.id
                        ? "bg-accent-soft"
                        : ""
                } ${rowSeekable(row) ? "cursor-pointer hover:bg-surface-2" : "cursor-default"}`}
                onClick={() => {
                  if (!rowSeekable(row) || editRowId === row.id) return;
                  seekWithReturn(row.start_ms);
                }}
              >
                <span className="w-14 shrink-0 pt-0.5 text-xs text-fg-muted ltr">
                  {formatClock(row.start_ms / 1000, locale)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span
                      data-speaker-pop
                      className="relative flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className={`text-xs font-semibold ${
                        speakers.length > 1 ? SPEAKER_TEXT[speakerIndex(row.speaker_id) % 4] : "text-accent"
                      }`}>
                        {speakerName(row.speaker_id)}
                      </span>
                      {row.speaker_id !== null && mayEditCall ? (
                        <IconAction
                          label={t("editSpeaker")}
                          className="h-5 w-5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => {
                            setEditSpeakerRow((prev) => (prev === row.id ? null : row.id));
                            setSpeakerDraft(
                              speakers.find((s) => s.id === row.speaker_id)?.label ?? "");
                          }}
                        >
                          <IconPencil width={12} height={12} />
                        </IconAction>
                      ) : null}
                      {/* ONE row's popover — keyed by the row, never the
                          speaker (user report: they all opened together) */}
                      {editSpeakerRow === row.id && row.speaker_id !== null ? (
                        <span
                          data-speaker-pop
                          className="absolute start-0 top-6 z-40 block w-64 rounded-lg border border-border bg-surface p-3 shadow-xl"
                        >
                          <input
                            className="input h-8 min-h-0 w-full py-0 text-xs"
                            aria-label={t("speakerLabel")}
                            placeholder={t("speakerLabel")}
                            value={speakerDraft}
                            autoFocus
                            onChange={(e) => setSpeakerDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                void saveSpeakerEdit(row.speaker_id!, undefined)
                                  .then((ok) => { if (ok) setEditSpeakerRow(null); });
                              }
                              if (e.key === "Escape") setEditSpeakerRow(null);
                            }}
                          />
                          {ownsCall ? (
                            <select
                              className="input mt-2 h-8 min-h-0 w-full py-0 text-xs"
                              aria-label={t("linkSpeaker")}
                              value={speakers.find((s) => s.id === row.speaker_id)?.person_id ?? ""}
                              onChange={(e) =>
                                void saveSpeakerEdit(row.speaker_id!, e.target.value || null)
                                  .then((ok) => { if (ok) setEditSpeakerRow(null); })
                              }
                            >
                              <option value="">{t("noPerson")}</option>
                              {directory.map((person) => (
                                <option key={person.id} value={person.id}>
                                  {person.display_name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            /* the directory link is the OWNER's act (M11 +
                               0093) — say so instead of rendering a select
                               the wall would refuse */
                            <span className="mt-2 block text-[11px] leading-5 text-fg-muted">
                              {t("linkOwnerOnly")}
                            </span>
                          )}
                          <span className="mt-2 flex items-center justify-between">
                            <button
                              className="text-xs text-accent underline-offset-2 hover:underline"
                              onClick={() => {
                                void saveSpeakerEdit(row.speaker_id!, undefined)
                                  .then((ok) => { if (ok) setEditSpeakerRow(null); });
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
                    <span
                      className="ms-auto flex items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* #3 copy the line · #15 copy a timestamp link · 0092 edit */}
                      <IconAction
                        label={t("copyLine")}
                        className="h-5 w-5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          void navigator.clipboard.writeText(row.text).then(() => notify(t("copied")));
                        }}
                      >
                        <IconFileText width={12} height={12} />
                      </IconAction>
                      <IconAction
                        label={t("copyLink")}
                        className="h-5 w-5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          const url = `${window.location.origin}${window.location.pathname}?t=${Math.floor(row.start_ms / 1000)}`;
                          void navigator.clipboard.writeText(url).then(() => notify(t("copied")));
                        }}
                      >
                        <IconShare width={12} height={12} />
                      </IconAction>
                      <IconAction
                        label={t("editLine")}
                        className="h-5 w-5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          setEditRowId(row.id);
                          setRowDraft(row.text);
                        }}
                      >
                        <IconPencil width={12} height={12} />
                      </IconAction>
                      {/* comment on a LINE: a note anchored at its moment,
                          quoting it — lands in the notes section below */}
                      <IconAction
                        label={t("noteLine")}
                        className="h-5 w-5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          void api
                            .addCallNote(id, {
                              kind: "note",
                              at_ms: row.start_ms,
                              body: `«${row.text.slice(0, 120)}»`,
                            })
                            .then(() => api.callNotes(id)).then(setNotes)
                            .then(() => notify(t("noteAdded")))
                            .catch(() => notify(tCommon("actionFailed"), "warn"));
                        }}
                      >
                        <IconTag width={12} height={12} />
                      </IconAction>
                    </span>
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
                          /* #20: the transcriber's own uncertainty, visible —
                             dimmed only when a confidence EXISTS and is low */
                          className={`cursor-pointer rounded px-0.5 hover:bg-accent/20 ${
                            word.confidence !== undefined && word.confidence < 0.6
                              ? "opacity-60"
                              : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            seekWithReturn(word.start_ms);
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
          </div>
          )}
        </section>
        ) : null}

        {/* ── notes & chapters (the summary page carries the extras) ───── */}
        {section === "summary" && notes.length > 0 ? (
          <section className="border-t border-border px-5 py-4">
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
                      className="tap no-print shrink-0 rounded px-1.5 text-xs text-fg-muted hover:text-danger"
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
          </section>
        ) : null}

        {/* ── #16 related records (shared tags) ────────────────────────── */}
        {section === "summary" && related.length > 0 ? (
          <section className="no-print border-t border-border px-5 py-4">
            <h2 className="mb-2 text-sm font-semibold text-fg">{t("relatedHeading")}</h2>
            <ul className="flex flex-wrap items-center gap-2">
              {related.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/calls/${c.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs text-fg-muted hover:text-fg"
                  >
                    <span className="max-w-40 truncate">{c.title || tCalls("untitled")}</span>
                    <span className="text-fg-subtle">{formatDate(c.started_at, locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </Card>

      {/* #17: the way back after a far seek */}
      {jumpBack ? (
        <button
          type="button"
          className="no-print fixed bottom-6 start-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-fg shadow-xl rtl:translate-x-1/2"
          onClick={() => {
            if (listRef.current) listRef.current.scrollTop = jumpBack.scroll;
            setJumpBack(null);
          }}
        >
          {t("jumpBack")}
        </button>
      ) : null}

      {/* #13: keep a selected passage as a note */}
      {selNote ? (
        <button
          type="button"
          className="no-print fixed z-40 -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-xl"
          style={{ left: selNote.x, top: Math.max(8, selNote.y - 36) }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void saveSelectionNote()}
        >
          {t("addSelectionNote")}
        </button>
      ) : null}
    </EchoAppShell>
  );
}

/**
 * The degradation ladder (M20): word → line → span, never "nothing". Only a
 * zero-length row refuses a seek (core rejects those at its boundary).
 */
function rowSeekable(row: TranscriptSegment): boolean {
  return row.end_ms > row.start_ms;
}
