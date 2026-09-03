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
import {
  ConfirmDialog, IconAction, KebabMenu, SelectMenu, type KebabItem,
} from "@/components/rowActions";
import { RichTextEditor } from "@/components/RichTextEditor";
import {
  IconArchive, IconAsk, IconChip, IconCopy, IconDownload, IconEye, IconFileText, IconFilter, IconGavel, IconGlobe, IconMic, IconOutline, IconParagraph, IconPause, IconPencil, IconPeople3, IconPlay, IconPlus, IconPrint, IconRedact, IconRetry, IconRows, IconShare, IconSparkle, IconTag, IconTrash, IconUsers, IconWarn, IconZap,
} from "@/components/icons";
import { PageContainer, SectionScroller, Skeleton, SkeletonLines } from "@/components/scaffold";
import { SummaryBody, parseSummary } from "@/components/echo/SummaryBody";
import { appendLaneItem, summaryLanes, type Lane } from "@/lib/summaryLanes";
import { faDisplay } from "@/lib/faDisplay";
import { suggestSpeakerPeople } from "@/lib/speakerSuggest";
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

/** Each ruled card is an ICON + name (user directive, 2026-08-25) — the
    image names the meeting kind at a glance, typed against the union. */
const TEMPLATE_ICON: Record<SummaryTemplate, typeof IconGavel> = {
  board: IconGavel,
  group: IconPeople3,
  team: IconUsers,
  it_team: IconChip,
  interview: IconMic,
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

/**
 * THE SUMMARY'S WARNINGS (user directive, 2026-08-29: *"add a warning small
 * icon next to kebab menu icon and put these kind of warning that are related
 * to the summary there"*).
 *
 * The 0087 grounding verdict used to render as an amber box under the
 * document — a permanent block of apology standing between the reader and the
 * text it is about. It lives behind this icon now, and the icon exists ONLY
 * when there is something to read: no flags, no icon, and never an empty
 * panel. A marker that is always on screen is one nobody reads, which would
 * cost exactly the readers this check exists for.
 *
 * The whole "is there a warning" rule lives HERE, in one place. The caller
 * hands over the verdict as the wire gave it — absent (deployment not
 * migrated), null (never checked), clean, or flagged — and never decides for
 * itself which of those is a warning.
 */
function SummaryWarnings({
  label,
  heading,
  grounding,
}: {
  label: string;
  heading: string;
  grounding?: { clean: boolean; model: string; flags: { claim: string; note: string }[] } | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* absent, null and clean are three different nothings and none of them is
     a warning — only a checked-and-flagged verdict is */
  const flags = grounding && !grounding.clean ? grounding.flags : [];
  if (flags.length === 0) return null;

  return (
    <span ref={rootRef} className="relative inline-flex">
      <IconAction
        label={label}
        onClick={() => setOpen((v) => !v)}
        className="text-warning hover:bg-warning/10 hover:text-warning"
      >
        <IconWarn />
      </IconAction>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className="absolute end-0 top-8 z-30 w-72 rounded-lg border border-warning/30 bg-surface p-3 shadow-xl"
        >
          <p className="text-xs font-semibold text-warning">{heading}</p>
          <ul className="mt-1.5 space-y-1.5">
            {flags.map((flag, i) => (
              <li key={i} className="text-xs leading-5 text-fg-muted">
                «{flag.claim}»{flag.note ? ` — ${flag.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}

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
  /** the record's own side menu (user directive, 2026-08-25): Summary is
      the default page, Transcript the second — the same two-pane anatomy
      every other sub page has. Local state, not routing: both sections are
      one record, and the player keeps playing across the switch. */
  const [section, setSection] = useState<"summary" | "transcript" | "actions" | "notes">("summary");
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
  const [newTpl, setNewTpl] = useState<{ name: string; prompt: string } | null>(null);
  /** the version about to be deleted (0095) — armed by the picker's ✕ */
  const [confirmVersionDelete, setConfirmVersionDelete] = useState<number | null>(null);
  /** the custom template about to be deleted — armed by its card's ✕ */
  const [confirmTemplateDelete, setConfirmTemplateDelete] = useState<string | null>(null);
  /** the note about to be deleted — armed by the note row's «حذف» */
  /** the chapter composer: the playhead it was opened at, and the name */
  const [chapterAt, setChapterAt] = useState<number | null>(null);
  const [chapterName, setChapterName] = useState("");
  const [confirmNoteDelete, setConfirmNoteDelete] = useState<string | null>(null);
  /** the notes section's own ADD box (user directive, 2026-08-28: the two
      side-menu sections take data, not just show it) — multi-line, and
      optionally anchored at the playhead the sticky player is showing */
  const [noteDraft, setNoteDraft] = useState("");
  const [noteAtPlayhead, setNoteAtPlayhead] = useState(false);
  /** manual lane items (same directive) — each travels through the 0092
      human-edit door as ONE new line in the summary document */
  const [actionDraft, setActionDraft] = useState("");
  const [decisionDraft, setDecisionDraft] = useState("");
  /** one in-flight door write at a time — a double Enter must not mint two
      human versions carrying the same item */
  const [laneBusy, setLaneBusy] = useState(false);
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
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState("");
  /** speaker inline editor — keyed by the ROW (user report: keying by the
      speaker opened every popover of that speaker at once) */
  const [editSpeakerRow, setEditSpeakerRow] = useState<string | null>(null);
  /** the popover closes like every menu: Esc anywhere, click outside */
  useEffect(() => {
    if (editSpeakerRow === null) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      // the person-select's option panel PORTALS to <body> — a click in it
      // is inside the popover's conversation, not outside it
      if (!el?.closest?.("[data-speaker-pop]") && !el?.closest?.('[role="listbox"]')) {
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
  /**
   * BULK LINK (user directive, 2026-08-25): the whole roster in one panel.
   * Linking speakers one at a time means hunting the transcript for a turn
   * by each voice — the panel puts every speaker in the call side by side,
   * with the transcript's own suggestion pre-filled where there is one.
   * `bulkDraft` is speaker id → person id ("" = leave unlinked); only the
   * rows that actually CHANGED are sent.
   */
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<Record<string, string>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

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

  /**
   * Open the roster panel with every speaker's CURRENT link, plus the
   * transcript's suggestion where the speaker has none. Pre-filling a
   * suggestion is the point — but it is pre-filled, never saved: the person
   * pressing the button is the one making the claim.
   */
  function openBulkLink(): void {
    const suggested = suggestSpeakerPeople(
      rows.map((r) => ({ speaker_id: r.speaker_id, text: r.text, start_ms: r.start_ms })),
      speakers.map((s) => ({ id: s.id, label: s.label, person_id: s.person_id })),
      directory.map((p) => ({ id: p.id, display_name: p.display_name })),
    );
    const draft: Record<string, string> = {};
    for (const speaker of speakers) {
      draft[speaker.id] = speaker.person_id ?? suggested.get(speaker.id) ?? "";
    }
    setBulkDraft(draft);
    setBulkOpen(true);
  }

  /** Send only the rows that changed; one refusal does not undo the rest. */
  async function saveBulkLink(): Promise<void> {
    setBulkBusy(true);
    let changed = 0;
    let refused = 0;
    for (const speaker of speakers) {
      const next = bulkDraft[speaker.id] ?? "";
      if (next === (speaker.person_id ?? "")) continue;
      try {
        await api.linkSpeaker(id, speaker.id, next || null);
        changed += 1;
      } catch {
        refused += 1;
      }
    }
    setSpeakers(await api.getSpeakers(id).catch(() => speakers));
    setBulkBusy(false);
    setBulkOpen(false);
    /* the two counts are separate facts — "3 saved" while one was refused
       reads as a success that was not one */
    if (refused > 0) notify(t("bulkRefused", { n: digits(refused, locale) }), "warn");
    if (changed > 0) notify(t("bulkSaved", { n: digits(changed, locale) }));
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
  /** the section kebabs' «افزودن …» items land the cursor in these */
  const noteBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const actionBoxRef = useRef<HTMLInputElement | null>(null);

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

  /**
   * The whole call list, fetched ONLY when it can produce something.
   *
   * `allCalls` has exactly one consumer — the related-records sidebar (#16),
   * which matches on SHARED TAGS and returns `[]` the moment this record has
   * none. Fetching it in the mount effect meant every untagged record — the
   * common case — downloaded the org's entire list to render an empty aside.
   *
   * It waits for this record's own tags to arrive, which costs the sidebar one
   * round trip of latency on a tagged record and costs the request entirely on
   * an untagged one. `hasTags` is a boolean, so re-tagging inside the page
   * still fires it once and editing tags on an already-tagged record does not
   * refetch — the same as the mount-once behaviour it replaces.
   */
  const hasTags = (call?.tags?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasTags) return;
    void api.listCalls({ includeArchived: false }).then(setAllCalls).catch(() => setAllCalls([]));
  }, [hasTags]);

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

  /**
   * pipeline polling — the page re-reads while the worker moves the call.
   *
   * **Depends on the STATUS, not on the call.** With `call` in the deps this
   * effect tore down its interval and built a new one on every tick: the tick
   * calls `setCall(fresh)` with a freshly parsed object, a new object is never
   * `Object.is`-equal to the old one, so the deps changed every five seconds
   * even when nothing about the call had. A restarted interval also restarts
   * its clock, so the poll's real period drifted with however long the request
   * took. The status is the only thing the effect actually reads, and it is a
   * string — a tick that changes nothing now leaves the timer alone.
   */
  const pollStatus = call?.status;
  useEffect(() => {
    const WORKER_MOVED = new Set(["processing", "linking", "summarizing"]);
    if (!pollStatus || !WORKER_MOVED.has(pollStatus)) return;
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
  }, [pollStatus, id]);

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

  /**
   * The notes section's own composer (user directive, 2026-08-28). The list
   * ADOPTS the returned row — the server authored its id and stamp — and
   * the row is slotted where the wire's own ordering would put it, so the
   * screen and the next full load agree. No toast on success: the row
   * appearing in the list the person is looking at IS the feedback (the
   * line-note and selection-note toasts exist because those land in a
   * section the person is NOT looking at).
   */
  async function saveNoteDraft(): Promise<void> {
    const body = noteDraft.trim();
    if (body === "") return;
    try {
      const row = await api.addCallNote(id, {
        kind: "note",
        at_ms: noteAtPlayhead ? Math.floor(playheadMs) : null,
        body,
      });
      setNotes((prev) => [...prev, row].sort(noteOrder));
      setNoteDraft("");
      setNoteAtPlayhead(false);
    } catch {
      notify(tCommon("actionFailed"), "warn");
    }
  }

  /**
   * A manual action item / decision goes through the SAME door as every
   * human summary edit (echo.edit_summary, db/0092): the item is appended
   * into the shown summary's own structure (lib/summaryLanes writes with
   * the reader's rule) and comes back as a new 'human' version — one
   * writer, one document, never a parallel action-items store that could
   * disagree with it. With no summary yet the door writes version 1, so a
   * record whose summarizer never ran can still carry its owner's list.
   */
  async function addLaneItem(lane: Lane): Promise<void> {
    const item = (lane === "actions" ? actionDraft : decisionDraft).trim();
    if (item === "" || laneBusy) return;
    setLaneBusy(true);
    try {
      const { version } = await api.editSummary(
        id, appendLaneItem(summary?.body ?? "", lane, item),
      );
      (lane === "actions" ? setActionDraft : setDecisionDraft)("");
      const all = await api.getSummaries(id);
      setVersions(all);
      setShownVersion(version);
    } catch (cause) {
      editFailNotify(cause);
    } finally {
      setLaneBusy(false);
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

  /* THE TOOLBAR SHAPE (audit finding, 2026-09-02). EchoAppShell stacks its
     menu ABOVE the content now, and this page was still handing it the old
     vertical SectionMenu — so the record opened with a pane heading, a group
     label and a column of rows sitting on top of the document, while every
     other surface shows one row of pills. Four buttons, no heading, no group
     title; the section is picked in place, which is why these are buttons and
     not links.

     It is built HERE, above the loading branch, so the frame that stands
     while the record is fetched and the frame that stands after it are the
     same object — a second copy is the one that stops matching. */
  const sectionMenu = (
    <nav aria-label={t("docSections")} className="flex flex-wrap items-center gap-1">
      {([
        { slug: "summary", label: t("summary"), icon: <IconFileText width={14} height={14} /> },
        { slug: "transcript", label: t("transcript"), icon: <IconRows width={14} height={14} /> },
        { slug: "actions", label: t("sectionActions"), icon: <IconZap width={14} height={14} /> },
        { slug: "notes", label: t("sectionNotes"), icon: <IconTag width={14} height={14} /> },
      ] as const).map((item) => (
        <button
          key={item.slug}
          type="button"
          aria-current={section === item.slug ? "page" : undefined}
          onClick={() => setSection(item.slug)}
          className={`btn btn-sm gap-1.5 font-medium ${
            section === item.slug ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </nav>
  );

  /*
   * THE FRAME BEFORE THE DATA (audit finding, 2026-09-02). This branch used
   * to be `<EchoAppShell>{null}</EchoAppShell>`: until getCall answered, the
   * record page was an empty column with no menu, no card and no player, and
   * then the whole document appeared at once. The card, its header row and
   * the player bar are STRUCTURE — they do not depend on the network — so
   * they stand first and only their contents wait, in the space they are
   * about to fill (components/scaffold/Skeleton).
   */
  if (!call) {
    return (
      <EchoAppShell menu={sectionMenu}>
        <PageContainer fill>
          <Card className="flex min-h-0 flex-1 flex-col !p-0">
            <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-4 w-28" />
            </div>
            {/* the transport pair, the clock and the seek bar, at the sizes
                they will be — no radius stated: Skeleton already carries the
                control radius, and a second `rounded-*` beside it would be a
                bet on which utility Tailwind emits last */}
            <div className="flex items-center gap-3 border-t border-border px-5 py-2.5">
              <Skeleton className="h-7 w-7" />
              <Skeleton className="h-7 w-7" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-1.5 min-w-0 flex-1" />
            </div>
            <div className="border-t border-border px-5 py-4">
              <SkeletonLines lines={6} />
            </div>
          </Card>
        </PageContainer>
      </EchoAppShell>
    );
  }

  const durMs = call.duration_ms ?? 0;
  const stepIdx = PIPELINE_LADDER.indexOf(call.status);
  /** what the WALL actually allows (0093): rename = owner or admin;
      directory LINK = the owner alone. The UI renders exactly that —
      a pencil the database refuses is how this page's speaker bug felt. */
  const mayEditCall = me !== null
    && (call.owner_id === me.id || me.role === "admin" || me.role === "owner");
  const ownsCall = me !== null && call.owner_id === me.id;
  /**
   * The ACTIONS & DECISIONS lanes of the shown summary — read through the
   * ONE shared rule (lib/summaryLanes), which the dashboard's cross-record
   * lanes read too. Display-only over the record; the summary is the source.
   */
  const lanes = summary ? summaryLanes(summary.body) : { actions: [], decisions: [] };
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
      icon: <IconAsk />,
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
    /* regenerate is NOT here: it belongs to the summary, so it lives on the
       SUMMARY SECTION's own kebab (user directive, 2026-08-29 — reversing
       the 2026-08-25 template cards, which this comment used to describe).
       This menu is the record-wide one. */
    ...(call.status === "failed"
      ? [{
          key: "retry",
          label: tCalls("retry"),
          icon: <IconRetry />,
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
      icon: <IconDownload />,
      sub: [
        {
          key: "export-srt", label: "SRT", icon: null,
          disabled: !canExportSubtitles(rows),
          onSelect: () => exportSubtitles("srt"),
        },
        {
          key: "export-vtt", label: "VTT", icon: null,
          disabled: !canExportSubtitles(rows),
          onSelect: () => exportSubtitles("vtt"),
        },
        {
          key: "export-md", label: "Markdown", icon: null,
          disabled: rows.length === 0,
          onSelect: () => exportMarkdown(),
        },
        {
          /* minutes as a Word file: an HTML .doc — Word opens it natively,
             letterhead-light (title · date · summary · transcript), RTL */
          key: "export-doc", label: "Word (.doc)", icon: null,
          disabled: rows.length === 0 && !summary,
          onSelect: () => exportDoc(),
        },
        {
          key: "export-redact",
          label: `${t("redactToggle")}${redactExports ? " ✓" : ""}`,
          icon: <IconRedact />,
          keepOpen: true,
          onSelect: () => setRedactExports((v) => !v),
        },
      ],
    },
    {
      key: "copy-summary",
      label: t("copySummary"),
      icon: <IconCopy />,
      disabled: !summary,
      onSelect: () => {
        if (!summary) return;
        void navigator.clipboard.writeText(summary.body).then(() => notify(t("copied")));
      },
    },
    { key: "print", label: t("printLabel"), icon: <IconPrint />, onSelect: () => window.print() },
    /* the VIEW toggles left this menu (user directive, 2026-08-25) — they
       are transcript facts, so they live on the transcript's own header */
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

  /**
   * THE SECTION KEBABS (user directive, 2026-08-28: "kebab menu in the
   * action and note are not relevant — fix the items inside them"). On the
   * actions and notes sections the only ⋯ in view was the page header's,
   * whose items are about the whole record; each section now carries its
   * own menu whose items are about the SECTION, and the record-wide menu
   * keeps living on the page header alone.
   */
  function copyLanesText(): void {
    const parts: string[] = [];
    if (lanes.actions.length > 0) {
      parts.push(`${t("actionsHeading")}:`, ...lanes.actions.map((item) => `- ${item}`));
    }
    if (lanes.decisions.length > 0) {
      if (parts.length > 0) parts.push("");
      parts.push(`${t("decisionsHeading")}:`, ...lanes.decisions.map((item) => `- ${item}`));
    }
    void navigator.clipboard.writeText(parts.join("\n")).then(() => notify(t("copied")));
  }

  function copyNotesText(): void {
    const text = notes
      .map((note) => (note.at_ms !== null
        ? `[${formatClock(note.at_ms / 1000, locale)}] ${note.body}`
        : note.body))
      .join("\n");
    void navigator.clipboard.writeText(text).then(() => notify(t("copied")));
  }

  /**
   * THE REGENERATE OFFER (user directive, 2026-08-29: *"put the regenerate
   * summary into the kebab menu with sub menu in the kebab menu as well for
   * its options"*) — reversing the 2026-08-25 template CARDS, which took a
   * whole section of the page body to say what a menu says in one row.
   *
   * ONE list, built once and worn by both menus that offer it (the summary's
   * own and the actions section's, whose `actionsEmpty` sentence promises
   * exactly this move). Two hand-written copies of an offer is how one of
   * them quietly stops matching the other — the cards had the person's own
   * templates and the «+»; the actions menu had only the five ruled ones.
   *
   * `prefix` keeps the two menus' item keys distinct where they are read
   * together in a test; the LABELS are the same list by construction.
   */
  const regenBlocked = regenBusy || call.status !== "ready";
  function regenerateItems(prefix: string): KebabItem[] {
    return [
      ...SUMMARY_TEMPLATES.map((k) => {
        const Icon = TEMPLATE_ICON[k];
        return {
          key: `${prefix}-${k}`,
          label: t(TEMPLATE_LABEL_KEY[k]),
          icon: <Icon width={14} height={14} />,
          disabled: regenBlocked,
          onSelect: () => void regenerate({ template: k, label: k }),
        };
      }),
      /* the person's own templates — INTERIM browser-local store */
      ...customs.map((c) => ({
        key: `${prefix}-custom-${c.name}`,
        label: c.name,
        icon: <IconSparkle width={14} height={14} />,
        disabled: regenBlocked,
        onSelect: () => void regenerate({ instruction: c.prompt, label: c.name }),
      })),
      {
        /* authoring one is NOT a regeneration — it opens the composer and
           runs nothing, which is why it is never disabled with the rest */
        key: `${prefix}-new`,
        label: t("templateAdd"),
        icon: <IconPlus width={14} height={14} />,
        onSelect: () => setNewTpl({ name: "", prompt: "" }),
      },
    ];
  }

  /** the SUMMARY section's own menu — the regenerate offer's home since
      2026-08-29, as a parent item that opens the template list */
  const summaryMenuItems: KebabItem[] = [
    {
      key: "summary-regen",
      label: t("regenTitle"),
      icon: <IconRetry />,
      sub: regenerateItems("summary-regen"),
    },
  ];

  const actionsMenuItems = [
    {
      key: "actions-copy",
      label: t("copyActions"),
      icon: <IconCopy />,
      disabled: lanes.actions.length === 0 && lanes.decisions.length === 0,
      onSelect: copyLanesText,
    },
    {
      key: "actions-regen",
      label: t("regenTitle"),
      icon: <IconRetry />,
      sub: regenerateItems("actions-regen"),
    },
    {
      key: "actions-summary",
      label: t("goToSummary"),
      icon: <IconFileText />,
      onSelect: () => setSection("summary"),
    },
  ];

  const notesMenuItems = [
    {
      key: "notes-add",
      label: t("noteAdd"),
      icon: <IconPlus />,
      onSelect: () => noteBoxRef.current?.focus(),
    },
    {
      key: "notes-copy",
      label: t("copyNotes"),
      icon: <IconCopy />,
      disabled: notes.length === 0,
      onSelect: copyNotesText,
    },
  ];

  return (
    <EchoAppShell menu={sectionMenu}>
      {/* ONE document card (user directive, 2026-08-24): header, player,
          summary, transcript, notes — divisions inside one box, not a
          stack of separate cards. Since 2026-08-25 the summary and the
          transcript are SECTIONS picked in the side menu; the header and
          the player stay above both. */}
      {/*
        The record shares the platform's ONE content width (2026-08-25) AND
        its rhythm (2026-08-27). The gutter used to be faked with
        `w-[calc(100%-2.5rem)]` — a width that HAPPENED to leave 20px either
        side, so it could not follow the theme when the theme moved, and on
        a wide screen it was a different inset from every other page.
      */}
      {/*
        FILL, not grow (2026-08-29, user: "it still does the scroll mode in
        transcription page for the main page ... only the table of
        transcription should go to scroll mode as we agreed"). The card is
        the height the shell grants, its header and player are fixed, and
        the open section's body is the only thing that scrolls. Nothing here
        computes a height — see SectionScroller for why the arithmetic that
        used to went away.
      */}
      <PageContainer fill>
      <Card className="flex min-h-0 flex-1 flex-col !p-0">
        {/* ── header: title · date · ⋯ ─────────────────────────────────── */}
        <div className="px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {titleDraft !== null ? (
                <span className="flex items-center gap-2">
                  {/* audit finding, 2026-09-02: this re-answered `.input`'s own
                      height and type by hand (`h-10 min-h-0 … text-lg`). The
                      class owns both; only the WEIGHT is set here, so the box
                      reads as the title it is replacing. */}
                  <input
                    className="input w-full max-w-md font-semibold"
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
                  {/* audit finding, 2026-09-02: `h-9 min-h-0 px-3 text-xs` on
                      top of `.btn` drew a 36px control — neither .btn (38) nor
                      .btn-sm (34), a twelfth shape beside a 40px field. The
                      theme's form button, and nothing on top of it. */}
                  <button
                    className="btn-primary"
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
                /* audit finding, 2026-09-02: this was `text-2xl font-bold` —
                   a large page heading inside the content, and the SECOND
                   place the record's name appears, since useCrumbTitle already
                   puts it in the breadcrumb. The card title role instead; the
                   rename pencil and the suggestion sparkle stay on the row. */
                <h1 className="group flex items-center gap-2 text-pane-title font-semibold leading-tight text-fg">
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
              {/* audit finding, 2026-09-02: `h-8 min-h-0 py-0 text-xs` made
                  this the 32px member of four field heights on one screen.
                  `.input` owns height, padding and type — only the width is
                  this site's to say. */}
              <input
                className="input w-64"
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
          {/* audit finding, 2026-09-02: both transport buttons hand-rolled a
              36px square (`h-9 w-9 min-h-0 px-0`) — a size the theme does not
              offer — and drew Unicode glyphs instead of the icon set. The
              theme's square icon button, with the set's own play/pause marks.
              STOP keeps its glyph: @/components/icons has no stop mark, and
              minting one belongs in that file, not in this page. */}
          <button
            className="btn-primary btn-icon shrink-0"
            onClick={togglePlay}
            disabled={audioParts === null || audioParts.length === 0}
            title={audioParts === null ? t("noAudio") : undefined}
            aria-label={playing ? t("pause") : t("play")}
          >
            {playing ? <IconPause width={14} height={14} /> : <IconPlay width={14} height={14} />}
          </button>
          <button
            className="btn-secondary btn-icon shrink-0"
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
              and the notes list. Asked in the PLATFORM's dialog, never
              `window.prompt`: that one is the browser's, says
              "app.neurai.pt says", is unstyled in both themes and blocks the
              page while it is up (user directive, 2026-09-02). */}
          <IconAction
            label={t("chapterAdd")}
            onClick={() => { setChapterAt(Math.floor(playheadMs)); setChapterName(""); }}
          >
            <IconTag width={14} height={14} />
          </IconAction>
          {/* audit finding, 2026-09-02: the speed rode raw Latin digits on a
              Persian screen — digits follow the LANGUAGE (the axes ruling),
              on the trigger and on every row of the menu behind it. */}
          <KebabMenu
            label={t("speed")}
            trigger={<span className="ltr text-xs font-semibold">{digits(rate, locale)}×</span>}
            items={[1, 1.5, 2].map((r) => ({
              key: String(r),
              label: `${digits(r, locale)}×${rate === r ? " ✓" : ""}`,
              /* a playback SPEED is a value, not an action */
              icon: null,
              onSelect: () => setRateBoth(r),
            }))}
          />
        </div>

        {/* ── the summary document (its own SECTION since 2026-08-25) ──── */}
        {section === "summary" ? (
        <section className="flex min-h-0 flex-1 flex-col border-t border-border px-5 py-4">
          <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">{t("summary")}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {versions.length > 0 ? (
                /* named by TEMPLATE alone (user directive, 2026-08-25: no
                   date, no model) — the kebab-styled SelectMenu is the
                   platform's dropdown now */
                <SelectMenu
                  /* 2026-09-03: `.input-sm`, the theme's compact field. It was
                     `h-8 min-h-0 py-0 text-xs` — one of the exact shapes
                     globals.css measured the token for. It matters HERE
                     because this dropdown stands in the same flex row as the
                     compare button, which is `btn btn-sm` at 34: the field was
                     32 and the button 34, two heights in one toolbar, which is
                     the complaint in miniature. `.input-sm` is the same token
                     as `.btn-sm`, so they are level by construction. Only the
                     width stays — it is this site's. */
                  className="input-sm w-auto"
                  ariaLabel={t("versions")}
                  value={String(shownVersion ?? "")}
                  onChange={(next) => {
                    setShownVersion(Number(next));
                    setCompareOpen(false);
                  }}
                  options={[...versions].reverse().map((v) => ({
                    value: String(v.version),
                    label: versionName(v),
                    // deletion is the 0095 door's — offered only to whoever
                    // the door lets through, behind the are-you-sure popup
                    ...(mayEditCall
                      ? { onRemove: () => setConfirmVersionDelete(v.version) }
                      : {}),
                  }))}
                />
              ) : null}
              {/* #6: what changed against the previous version */}
              {prevVersion ? (
                /* audit finding, 2026-09-02: this was a hand-rolled 32px
                   `rounded-full` lozenge — a pill, which the theme keeps for
                   chips and badges and never for a button. The toolbar's own
                   idiom, and the pressed state is the toolbar's too. */
                <button
                  type="button"
                  aria-pressed={compareOpen}
                  onClick={() => setCompareOpen((v) => !v)}
                  className={`btn btn-sm font-medium ${
                    compareOpen
                      ? "bg-accent text-on-accent"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg"
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
              {/* the grounding flags, beside the ⋯ and only when there are
                  any (user directive, 2026-08-29) — the component owns the
                  rule, so nothing here decides what counts as a warning */}
              <SummaryWarnings
                label={t("summaryWarnings")}
                heading={t("groundingFlagged")}
                grounding={summary?.grounding}
              />
              {/* the SUMMARY's own menu: the regenerate offer, as a submenu */}
              <KebabMenu label={t("summaryMenu")} items={summaryMenuItems} />
            </div>
          </div>

          {/* the document SCROLLS ITSELF (user directive, 2026-08-29): the
              header above stays put — with the version picker, the warnings
              and the ⋯ always in reach — and only the summary moves. One
              mechanism, shared with the transcript and both list sections;
              the height is the scaffold's, never this page's. */}
          <SectionScroller>
          {summary ? (
            <>
              {editingSummary ? (
                <div className="space-y-2">
                  {/* the WORD-like editor (user directive, 2026-08-25):
                      formatted page, ribbon of honest operations — what the
                      ribbon writes, SummaryBody can render */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SelectMenu
                      /* 2026-09-03: `.input-sm` — the editor ribbon's size
                         picker, the same `h-8 min-h-0 py-0 text-xs` the
                         version dropdown wore. A ribbon is exactly the dense
                         row the compact token was measured for. */
                      className="input-sm w-auto"
                      ariaLabel={t("editorSize")}
                      value={String(editFontSize)}
                      onChange={(v) => setEditFontSize(Number(v))}
                      options={[
                        { value: "0.875", label: t("sizeSmall") },
                        { value: "1", label: t("sizeNormal") },
                        { value: "1.2", label: t("sizeLarge") },
                      ]}
                    />
                  </div>
                  <RichTextEditor
                    value={summaryDraft}
                    onChange={setSummaryDraft}
                    fontScale={editFontSize}
                  />
                  {/* audit finding, 2026-09-02: both wore `h-9 min-h-0 px-4
                      text-sm` over `.btn` — the 36px shape that exists nowhere
                      in the theme. A form's save/cancel pair is `.btn`. */}
                  <div className="flex items-center gap-2">
                    <button
                      className="btn-primary"
                      disabled={summaryDraft.trim() === ""}
                      onClick={() => void saveSummaryEdit()}
                    >
                      {tCommon("save")}
                    </button>
                    <button
                      className="btn-secondary"
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
              {/* the PASS still says so here, in one line: it is a fact
                  about the document, and it costs the reader nothing. The
                  FLAGS left this body for the header's warning icon
                  (2026-08-29) — an amber box under every checked summary is
                  a paragraph the eye has to cross to reach the text it is
                  about, and it was the only part of this block that could
                  grow without limit. */}
              {summary.grounding?.clean ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
                  <span aria-hidden>✓</span> {t("groundingClean")}
                </p>
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
          </SectionScroller>
          {/* a refusal stays OUTSIDE the scroller: an alert that can be
              scrolled out of sight is an alert nobody reads */}
          {translateError ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {translateError}
            </p>
          ) : null}
        </section>
        ) : null}

        {/* ── the transcript (the menu's second section) ────────────────── */}
        {section === "transcript" ? (
        <section className="flex min-h-0 flex-1 flex-col border-t border-border">
          <div className="no-print border-b border-border px-5 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-fg">{t("transcript")}</h2>
              {/* #2: find in this record */}
              {rows.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  {/* audit finding, 2026-09-02: `h-7 min-h-0 py-0 text-xs` made
                      this the 28px member of the same four-height set. */}
                  <input
                    className="input w-40"
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
                    /* audit finding, 2026-09-02: the one number on this screen
                       that did not follow the language. `ltr` fixes the reading
                       direction of "2/7"; it does not choose the digit script. */
                    <span className="ltr text-xs tabular-nums text-fg-muted">
                      {findMatches.length === 0
                        ? digits(0, locale)
                        : `${digits((((findIdx % findMatches.length) + findMatches.length) % findMatches.length) + 1, locale)}/${digits(findMatches.length, locale)}`}
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
              {/* the reading modes, HOME at last: transcript facts on the
                  transcript's header (moved out of the title kebab) */}
              <KebabMenu
                label={t("viewMenu")}
                items={[
                  {
                    key: "view-follow",
                    label: `${t("followPlayback")}${followPlayback ? " ✓" : ""}`,
                    icon: <IconEye />,
                    keepOpen: true,
                    onSelect: () => setFollowPlayback((v) => !v),
                  },
                  {
                    key: "view-paragraphs",
                    label: `${t("paragraphMode")}${paragraphMode ? " ✓" : ""}`,
                    icon: <IconParagraph />,
                    keepOpen: true,
                    onSelect: () => setParagraphMode((v) => !v),
                  },
                  {
                    key: "view-fillers",
                    label: `${t("cleanRead")}${cleanRead ? " ✓" : ""}`,
                    icon: <IconFilter />,
                    keepOpen: true,
                    onSelect: () => setCleanRead((v) => !v),
                  },
                  {
                    key: "view-outline",
                    label: `${t("outlineMode")}${outlineMode ? " ✓" : ""}`,
                    icon: <IconOutline />,
                    keepOpen: true,
                    disabled: headings.length < 2,
                    onSelect: () => setOutlineMode((v) => !v),
                  },
                ]}
              />
            </div>
            {/* speaker chips + the talk-time bar (#10) */}
            {rows.length > 0 && !showTranscriptEn && speakers.length > 1 ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {/* 2026-09-03: the theme's control, not a twelfth invented
                      size. These were 28px `rounded-full` lozenges standing in
                      the SAME flex row as the bulk-link button below, which is
                      already `btn btn-sm` at 34 — two heights, one row, which
                      is the whole complaint in miniature. `.btn-sm` is the
                      size globals.css measured FOR segmented filters like
                      these. Only the tone stays: the pressed state keeps its
                      accent-soft wash, and the `font-semibold` that used to
                      mark it is gone because `.btn` gives BOTH states that
                      weight — the pressed one is told apart by colour now,
                      exactly as the section pills above this card are. They
                      also gain `.tap`'s 44px hit area below md, which a
                      hand-drawn 28px pill never had. */}
                  <button
                    type="button"
                    aria-pressed={speakerFilter === null}
                    onClick={() => setSpeakerFilter(null)}
                    className={`btn btn-sm ${
                      speakerFilter === null
                        ? "bg-accent-soft text-accent"
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
                      className={`btn btn-sm ${
                        speakerFilter === sp.id
                          ? "bg-accent-soft text-accent"
                          : "bg-surface-2 text-fg-muted hover:text-fg"
                      }`}
                    >
                      {sp.person_name ?? sp.label}
                    </button>
                  ))}
                  {/* BULK LINK: the whole roster at once, for the owner —
                      offered only while there is still someone unlinked */}
                  {ownsCall && directory.length > 0
                    && speakers.some((s) => s.person_id === null) ? (
                    /* audit finding, 2026-09-02: another hand-rolled pill.
                       `.btn` draws no border of its own, so the dashed hairline
                       — the "this is an offer, not a state" reading the author
                       wanted — is stated explicitly beside it. */
                    <button
                      type="button"
                      className="btn btn-sm border border-dashed border-border font-medium text-fg-muted hover:border-accent hover:text-accent"
                      onClick={openBulkLink}
                    >
                      {t("bulkLink")}
                    </button>
                  ) : null}
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

          {/* the transcript's body, in the SAME scroller the summary uses
              (user directive, 2026-08-29): the header above — find box,
              speaker chips, view menu — holds still, and every branch below
              scrolls inside this one box rather than each picking a height.
              The ref reaches the scrolling element itself: follow-playback,
              find-and-centre and the jump-back all scroll it. */}
          <SectionScroller
            scrollRef={listRef}
            onMouseUp={onListMouseUp}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 200
                  && rowLimit < visibleRows.length) {
                setRowLimit((n) => n + 30);
              }
            }}
          >
          {showTranscriptEn && transcriptEn === "loading" ? (
            <p className="p-4 text-sm text-fg-muted">{t("translating")}</p>
          ) : showTranscriptEn && typeof transcriptEn === "string" ? (
            /* SIDE-BY-SIDE (user directive): the Persian record stays on
               screen beside its English rendering — a translation is a lens,
               not a replacement. The two columns share the SECTION's
               scroller now — they used to carry a 24rem box each, which was
               two more heights nobody had decided on. */
            <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="p-4">
                {rows.slice(0, 200).map((r) => (
                  <p key={r.id} dir="auto" className="mb-2 text-sm leading-8 text-fg">
                    <span className="me-2 text-xs text-fg-muted ltr">
                      {formatClock(r.start_ms / 1000, locale)}
                    </span>
                    {r.text}
                  </p>
                ))}
              </div>
              <p className="ltr whitespace-pre-wrap p-4 text-start text-sm leading-8 text-fg">
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
          <>
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
                          {/* audit finding, 2026-09-02: `h-8 min-h-0 py-0
                              text-xs` — the same re-answering of `.input`. */}
                          <input
                            className="input w-full"
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
                            <span className="mt-2 block">
                              <SelectMenu
                                /* 2026-09-03: the hand-set height goes, and it
                                   goes to `.input` rather than `.input-sm` —
                                   this is the one site in the file where the
                                   compact token would be the WRONG token. The
                                   text box directly above it in this same
                                   popover is a plain `.input` (the 2026-09-02
                                   audit put it there); a 34px select under a
                                   40px field is still two heights in one small
                                   panel, which is the defect this pass exists
                                   to remove. A field matches its own sibling
                                   first. `.input` already carries `w-full`. */
                                ariaLabel={t("linkSpeaker")}
                                value={speakers.find((s) => s.id === row.speaker_id)?.person_id ?? ""}
                                onChange={(next) =>
                                  void saveSpeakerEdit(row.speaker_id!, next || null)
                                    .then((ok) => { if (ok) setEditSpeakerRow(null); })
                                }
                                options={[
                                  { value: "", label: t("noPerson") },
                                  ...directory.map((person) => ({
                                    value: person.id,
                                    label: person.display_name,
                                  })),
                                ]}
                              />
                            </span>
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
                      /* audit finding, 2026-09-02: digits follow the language
                         here too — a channel number is still a number. */
                      <span className="text-[11px] text-fg-muted ltr">ch{digits(row.channel + 1, locale)}</span>
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
          </>
          )}
          </SectionScroller>
        </section>
        ) : null}

        {/* ── ACTIONS & DECISIONS — its own section (user directive,
            2026-08-25): the lanes the summary's own structure declares,
            read as checklists; ticking is a reading aid, not a write.
            Since 2026-08-28 each lane also TAKES items — through the 0092
            door, into the document the lanes are read from ──────────────── */}
        {section === "actions" ? (
          <section className="flex min-h-0 flex-1 flex-col border-t border-border px-5 py-4">
            <div className="no-print mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-fg">{t("sectionActions")}</h2>
              <KebabMenu label={t("actionsMenu")} items={actionsMenuItems} />
            </div>
            {/* same scroller as the summary and the transcript: long lanes
                scroll here, and the section's header stays where it was */}
            <SectionScroller>
            {lanes.actions.length === 0 && lanes.decisions.length === 0 ? (
              <p className="mb-4 text-sm leading-7 text-fg-muted">{t("actionsEmpty")}</p>
            ) : null}
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-fg">{t("actionsHeading")}</h3>
                {lanes.actions.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t("laneEmpty")}</p>
                ) : (
                  <ul className="space-y-2">
                    {lanes.actions.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-7 text-fg">
                        <input type="checkbox" className="mt-1.5" aria-label={item} />
                        <span dir="auto">{faDisplay(item)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* audit finding, 2026-09-02: the compose row wore the 36px
                    pair — `input h-9 min-h-0 py-0` beside `btn h-9 min-h-0
                    px-3 text-xs`. Both classes already answer that. */}
                <div className="no-print mt-3 flex items-center gap-2">
                  <input
                    ref={actionBoxRef}
                    className="input flex-1"
                    placeholder={t("actionPlaceholder")}
                    aria-label={t("actionAdd")}
                    value={actionDraft}
                    onChange={(e) => setActionDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addLaneItem("actions");
                    }}
                  />
                  <button
                    className="btn-secondary shrink-0"
                    disabled={actionDraft.trim() === "" || laneBusy}
                    onClick={() => void addLaneItem("actions")}
                  >
                    {t("actionAdd")}
                  </button>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-fg">{t("decisionsHeading")}</h3>
                {lanes.decisions.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t("laneEmpty")}</p>
                ) : (
                  /* audit finding, 2026-09-02: `list-decimal` prints the
                     BROWSER's markers, which are Western digits on the Persian
                     screen — and the `[dir=rtl] list-style: persian` rule in
                     globals.css is scoped to `.rte`, so it never reached here.
                     The number is rendered instead, through digits(), the way
                     the help page's steps already do it. */
                  <ol className="space-y-2">
                    {lanes.decisions.map((item, i) => (
                      <li key={i} className="flex gap-2 text-sm leading-7 text-fg">
                        <span
                          aria-hidden
                          className="badge-num mt-1 h-5 w-5 shrink-0 rounded-full bg-accent-soft text-[11px] font-semibold text-accent"
                        >
                          {digits(i + 1, locale)}
                        </span>
                        <span dir="auto">{faDisplay(item)}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {/* audit finding, 2026-09-02: the actions row's twin, same fix */}
                <div className="no-print mt-3 flex items-center gap-2">
                  <input
                    className="input flex-1"
                    placeholder={t("decisionPlaceholder")}
                    aria-label={t("decisionAdd")}
                    value={decisionDraft}
                    onChange={(e) => setDecisionDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addLaneItem("decisions");
                    }}
                  />
                  <button
                    className="btn-secondary shrink-0"
                    disabled={decisionDraft.trim() === "" || laneBusy}
                    onClick={() => void addLaneItem("decisions")}
                  >
                    {t("decisionAdd")}
                  </button>
                </div>
              </div>
            </div>
            </SectionScroller>
          </section>
        ) : null}

        {/* ── NOTES & ATTACHMENTS — its own section (user directive).
            One branch since 2026-08-28: the empty state and the list share
            the header, the kebab and the ADD box — an empty section that
            hides the composer would say "nothing here" while withholding
            the way to change that ─────────────────────────────────────── */}
        {section === "notes" ? (
          <section className="flex min-h-0 flex-1 flex-col border-t border-border px-5 py-4">
            <div className="no-print mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-fg">{t("notesHeading")}</h2>
              <KebabMenu label={t("notesMenu")} items={notesMenuItems} />
            </div>
            {/* the section's body — list, composer and the attachments note
                — scrolls as ONE box (2026-08-29). The composer travels with
                the list deliberately: a long list must not be able to push
                the way to add to it off the bottom of the page. */}
            <SectionScroller>
            {notes.length === 0 ? (
              <p className="text-sm leading-7 text-fg-muted">{t("notesEmpty")}</p>
            ) : (
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
                      onClick={() => setConfirmNoteDelete(note.id)}
                    >
                      {t("noteDelete")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            )}
            {/* the ADD box (user directive, 2026-08-28): multi-line, and the
                checkbox anchors it at the player's moment — unchecked writes
                at_ms null, a note about the CALL rather than an instant in it
                (the two are different nothings and the wire keeps them so) */}
            <div className="no-print mt-4">
              <textarea
                ref={noteBoxRef}
                className="input min-h-16 w-full py-1.5 text-sm leading-7"
                placeholder={t("notePlaceholder")}
                aria-label={t("noteAdd")}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {/* audit finding, 2026-09-02: the sixth 36px button on the
                    page — `.btn` is the form button and says so itself */}
                <button
                  className="btn-primary"
                  disabled={noteDraft.trim() === ""}
                  onClick={() => void saveNoteDraft()}
                >
                  {t("noteAdd")}
                </button>
                <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={noteAtPlayhead}
                    onChange={(e) => setNoteAtPlayhead(e.target.checked)}
                  />
                  {t("noteAtPlayhead", { clock: formatClock(playheadMs / 1000, locale) })}
                </label>
              </div>
            </div>
            <p className="mt-4 text-xs text-fg-muted">
              {/* named-but-not-yet (the Management honest-inactive pattern):
                  file/photo attachments arrive with the storage lane — the
                  blocker is the PURGE, which deletes only the objects
                  call_part rows enumerate; an attachment object would
                  outlive its purged call (see core/src/purge/purge.ts) */}
              <Chip tone="neutral">{t("attachmentsSoon")}</Chip>
            </p>
            </SectionScroller>
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
      </PageContainer>

      {/* deleting a NOTE. It looked like the small one on this screen and is
          not: a note is a person's own annotation, there is one copy, and
          nothing on the record can bring it back. Same dialog as everything
          else destructive on the platform (confirm.guard.test.ts). */}
      {/* the chapter's name box — the platform's own dialog, whose `body`
          takes a whole form precisely so a question needing an ANSWER does
          not have to invent a second kind of window */}
      {chapterAt !== null ? (
        <ConfirmDialog
          title={t("chapterAdd")}
          body={
            <input
              autoFocus
              className="input"
              value={chapterName}
              placeholder={t("chapterPrompt")}
              onChange={(e) => setChapterName(e.target.value)}
            />
          }
          confirmLabel={tCommon("add")}
          cancelLabel={tCommon("cancel")}
          danger={false}
          confirmDisabled={chapterName.trim() === ""}
          onCancel={() => setChapterAt(null)}
          onConfirm={() => {
            const at = chapterAt;
            const body = chapterName.trim();
            setChapterAt(null);
            void api
              .addCallNote(id, { kind: "chapter", at_ms: at, body })
              .then(() => api.callNotes(id)).then(setNotes)
              .then(() => notify(t("noteAdded")))
              .catch(() => notify(tCommon("actionFailed"), "warn"));
          }}
        />
      ) : null}

      {confirmNoteDelete !== null ? (
        <ConfirmDialog
          title={t("noteDeleteTitle")}
          body={t("noteDeleteBody")}
          confirmLabel={t("noteDelete")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setConfirmNoteDelete(null)}
          onConfirm={() => {
            const noteId = confirmNoteDelete;
            setConfirmNoteDelete(null);
            void api
              .deleteCallNote(noteId)
              .then(() => api.callNotes(id))
              .then(setNotes)
              .catch(() => undefined);
          }}
        />
      ) : null}

      {/* AUTHORING a summary template. The «+» card left the page body with
          the rest of the regenerate offer (2026-08-29), so the composer is
          the theme's own dialog now, opened from the submenu's «الگوی تازه».
          It also carries the SAVED list, because deleting one has to stay
          reachable from somewhere and the cards were that somewhere. */}
      {newTpl !== null ? (
        <ConfirmDialog
          danger={false}
          title={t("templateAdd")}
          confirmLabel={t("templateSave")}
          cancelLabel={tCommon("cancel")}
          confirmDisabled={newTpl.name.trim() === "" || newTpl.prompt.trim() === ""}
          onCancel={() => setNewTpl(null)}
          onConfirm={() => {
            setCustoms(saveCustomTemplate(newTpl));
            setNewTpl(null);
          }}
          body={
            <div className="space-y-3">
              {/* audit finding, 2026-09-02: `h-9 min-h-0 py-0 text-sm` — the
                  36px field, in a dialog whose other box is `.input`'s own */}
              <input
                className="input w-full"
                maxLength={60}
                autoFocus
                aria-label={t("templateNameHint")}
                placeholder={t("templateNameHint")}
                value={newTpl.name}
                onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })}
              />
              <textarea
                className="input min-h-20 w-full resize-none py-1.5 text-sm leading-6"
                maxLength={500}
                aria-label={t("templatePromptLabel")}
                placeholder={t("templatePromptHint")}
                value={newTpl.prompt}
                onChange={(e) => setNewTpl({ ...newTpl, prompt: e.target.value })}
              />
              {customs.length > 0 ? (
                <div className="border-t border-border pt-3">
                  <p className="text-group-label font-medium text-fg-subtle">
                    {t("templatesSaved")}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {customs.map((c) => (
                      <li key={c.name} className="flex items-center gap-2 text-sm text-fg-muted">
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {/* the prompt behind this name lives only in this
                            browser — so it asks first, like every other
                            destructive control (confirm.guard.test.ts) */}
                        <IconAction
                          danger
                          label={t("templateDelete")}
                          onClick={() => setConfirmTemplateDelete(c.name)}
                        >
                          <IconTrash width={14} height={14} />
                        </IconAction>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          }
        />
      ) : null}

      {/* deleting a saved EXPORT TEMPLATE (browser-local). The title names it,
          and the body says the part that is invisible from the card: this
          store is per-browser, so nobody else can hand the prompt back. */}
      {confirmTemplateDelete !== null ? (
        <ConfirmDialog
          title={t("templateDeleteTitle", { name: confirmTemplateDelete })}
          body={t("templateDeleteBody")}
          confirmLabel={tCalls("delete")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setConfirmTemplateDelete(null)}
          onConfirm={() => {
            const name = confirmTemplateDelete;
            setConfirmTemplateDelete(null);
            setCustoms(deleteCustomTemplate(name));
          }}
        />
      ) : null}

      {/* deleting a summary VERSION (0095) — the same are-you-sure shape
          every product delete wears */}
      {confirmVersionDelete !== null ? (
        <ConfirmDialog
          title={t("deleteVersionTitle", { n: digits(confirmVersionDelete, locale) })}
          body={t("deleteVersionBody")}
          confirmLabel={tCalls("delete")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setConfirmVersionDelete(null)}
          onConfirm={() => {
            const version = confirmVersionDelete;
            setConfirmVersionDelete(null);
            void api.deleteSummaryVersion(id, version)
              .then(() => api.getSummaries(id))
              .then((all) => {
                setVersions(all);
                setShownVersion(all.at(-1)?.version ?? null);
                notify(t("versionDeleted"));
              })
              .catch((cause) => {
                const detail = (cause as { detail?: string }).detail;
                notify(detail || tCommon("actionFailed"), "warn");
              });
          }}
        />
      ) : null}

      {/* BULK LINK — the record's whole roster in one panel, with the
          transcript's suggestions pre-filled and marked AS suggestions */}
      {bulkOpen ? (
        <ConfirmDialog
          wide
          danger={false}
          busy={bulkBusy}
          title={t("bulkTitle")}
          body={
            <div className="space-y-3">
              <p className="text-sm text-fg-muted">{t("bulkBody")}</p>
              <ul className="space-y-2">
                {speakers.map((speaker) => (
                  <li key={speaker.id} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm text-fg" title={speaker.label}>
                      {speaker.label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <SelectMenu
                        /* 2026-09-03: `.input-sm`. It was `h-9 min-h-0 py-0
                           text-sm` — the other exact shape globals.css names.
                           The compact token is right here for the reason the
                           token's own comment gives: this is one row per
                           speaker in a roster list, and a 44px control per row
                           would be the bigger harm. */
                        className="input-sm w-full"
                        ariaLabel={t("linkSpeaker")}
                        value={bulkDraft[speaker.id] ?? ""}
                        onChange={(next) =>
                          setBulkDraft((prev) => ({ ...prev, [speaker.id]: next }))
                        }
                        options={[
                          { value: "", label: t("noPerson") },
                          ...directory.map((person) => ({
                            value: person.id,
                            label: person.display_name,
                          })),
                        ]}
                      />
                    </span>
                    {/* the guess says it is a guess — an unmarked pre-fill
                        would read as something the record already knew */}
                    {speaker.person_id === null && (bulkDraft[speaker.id] ?? "") !== "" ? (
                      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                        {t("bulkSuggested")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          }
          confirmLabel={tCommon("save")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setBulkOpen(false)}
          onConfirm={() => void saveBulkLink()}
        />
      ) : null}

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

/**
 * The wire's own note ordering, mirrored (core listNotes: `order by at_ms
 * nulls last, created_at`) — an adopted row slotted by any OTHER rule would
 * jump to a different place on the next full load.
 */
function noteOrder(a: CallNote, b: CallNote): number {
  if (a.at_ms === null && b.at_ms === null) return a.created_at < b.created_at ? -1 : 1;
  if (a.at_ms === null) return 1;
  if (b.at_ms === null) return -1;
  return (a.at_ms - b.at_ms) || (a.created_at < b.created_at ? -1 : 1);
}
