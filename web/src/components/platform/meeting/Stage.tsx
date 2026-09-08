"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import type { MeetingAttachment, MeetingRecord } from "@/api/types";
import { Whiteboard } from "./Whiteboard";
import { RecallCards } from "./RecallCards";
import { useLiveRecall } from "@/lib/liveRecall";
import { MeetingRoom } from "./Room";
import { IconPencil, IconResize, IconUpload, IconVideo } from "@/components/icons";

/**
 * THE LIVE STAGE — the reference's برگزاری media area, walked in their own
 * product (2026-09-02): a header carrying the three modes on one side and
 * the recording state plus the fullscreen grip on the other, and the
 * surface itself below.
 *
 *   ویدیو    the meeting's video ROOM, rendered IN the box. See Room.tsx
 *            for why it is not a Google Meet: Google refuses to be framed,
 *            so a Meet link could only ever open a window.
 *   وایت‌برد  the canvas.
 *   ارائه     a PDF, presented. The file is read in the browser and shown
 *            here; it is not uploaded anywhere, which the footer says
 *            plainly rather than implying the room can see it.
 */
type Mode = "video" | "board" | "slides";

export function MeetingStage({ meeting, isHost, onMeeting, recordingLive, liveText = "" }: {
  meeting: MeetingRecord;
  /** the HOST drives the stage (db/0206): the board, and what is presented.
      Everybody else watches — which is the point of the stage being shared
      at all, and is why this is a prop rather than a read of the viewer. */
  isHost: boolean;
  onMeeting: (m: MeetingRecord) => void;
  recordingLive: boolean;
  /**
   * What has been said so far, for live recall (item 7).
   *
   * Handed down rather than read here, for the same reason `isHost` is: the
   * page owns the recording engine, and a component that reached for the
   * engine itself would be a second opinion about whether a take is running.
   */
  liveText?: string;
}) {
  const t = useTranslations("meetings");
  /*
   * THE VIDEO MODE BELONGS TO AN ONLINE MEETING AND NOWHERE ELSE (user
   * directive): a meeting held in the room, recorded through a microphone,
   * has no video room and never will — offering the tab there is offering a
   * button whose only possible outcome is an empty state. The mode list is
   * derived rather than filtered at render, so nothing can select a mode
   * that has no chip.
   */
  const video = meeting.mode === "online";
  /* the gate is stated once, here, so the hook and the cards cannot disagree
     about who sees them */
  const recall = useLiveRecall(meeting.id, liveText, isHost && recordingLive);
  const [mode, setMode] = useState<Mode>(video ? "video" : "board");
  const pdfInput = useRef<HTMLInputElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  /*
   * THE PRESENTATION IS SHARED NOW (user directive, 2026-09-07: "same for the
   * presentation").
   *
   * It used to be `URL.createObjectURL(file)` — the document read into ONE
   * browser's memory, with a footer that said so honestly. A presentation
   * nobody else can see is a slide deck held up to a mirror. The file goes to
   * the meeting's own attachments (0159) and the host says which one is on
   * screen (0206's `presenting_attachment_id`); every reader is handed a
   * short-lived signed URL for the same bytes.
   */
  const [files, setFiles] = useState<MeetingAttachment[] | null>(null);
  const [showing, setShowing] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const presentingId = meeting.presenting_attachment_id;

  const loadFiles = useCallback(() => {
    void api.meetingAttachments(meeting.id)
      .then((rows) => setFiles(rows.filter((f) => f.content_type.includes("pdf"))))
      .catch(() => setFiles([]));
  }, [meeting.id]);
  useEffect(loadFiles, [loadFiles]);

  /* the URL is a CREDENTIAL for those bytes, so it is minted per document and
     never kept: when the host shows a different one, the old one goes with it */
  useEffect(() => {
    if (presentingId === null) { setShowing(null); return; }
    let alive = true;
    void api.meetingAttachmentUrl(meeting.id, presentingId)
      .then((res) => { if (alive) setShowing({ id: presentingId, url: res.url }); })
      .catch(() => { if (alive) setShowing(null); });
    return () => { alive = false; };
  }, [meeting.id, presentingId]);

  const present = (attachmentId: string | null) => {
    void api.setMeetingPresenting(meeting.id, attachmentId)
      .then(onMeeting)
      .catch(() => notify(t("writeFailed"), "warn"));
  };

  const modeChip = (key: Mode, label: string, icon: React.ReactNode) => (
    <button
      key={key}
      type="button"
      aria-pressed={mode === key}
      onClick={() => setMode(key)}
      /* 2026-09-03: the theme's compact control. A segmented tab is what
         `.btn-sm` was measured off in the first place (the reference's own
         tabs: 34px, 8px corner, 12.5 semibold), so these chips had invented
         a shape the theme was already carrying — the same spelling Echo's
         section menu uses, which is the point of it being one class. */
      className={`btn btn-sm gap-1.5 font-medium ${
        mode === key ? "bg-accent text-on-accent" : "text-fg-muted hover:text-fg"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    /*
     * ONE BOX. The header and the surface share a border, so the recording
     * light belongs to the whiteboard rather than floating above it — which
     * is what "include the recording light in the whole box" was asking for,
     * and how the reference reads: the thing that is being recorded and the
     * lamp saying so are the same object.
     */
    /* `relative`: the recall cards are absolutely placed over this box's
       own corner, so a card arriving mid-stroke cannot reflow the board */
    <div ref={shell} className="card relative flex min-h-0 flex-col overflow-hidden p-0">
      {/* ── the stage header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-2">
        <div className="flex items-center gap-0.5 rounded-xl bg-surface-2 p-1">
          {video ? modeChip("video", t("modeVideo"), <IconVideo width={12} height={12} />) : null}
          {modeChip("board", t("modeBoard"), <IconPencil width={12} height={12} />)}
          {modeChip("slides", t("modeSlides"), <IconUpload width={12} height={12} />)}
        </div>

        <div className="flex items-center gap-2">
          {/* THE LIGHT, not a second clock (user directive: the page's own
              top bar already carries the running time and the end button, so
              a duplicate here was the same number in two places a hand's
              width apart). A dot and the mode is what this box owes: it says
              THIS surface is being recorded, which the top bar cannot. */}
          <span className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium ${
            recordingLive ? "bg-danger/10 text-danger" : "bg-surface-2 text-fg-muted"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${recordingLive ? "animate-pulse bg-danger" : "bg-fg-subtle"}`} aria-hidden />
            {recordingLive ? t(`mode_${meeting.mode}`) : t("statusReady")}
          </span>
          {recordingLive ? (
            <span className="text-[11px] text-fg-muted">{t("recordedHere")}</span>
          ) : null}
          <button
            type="button"
            aria-label={t("fullscreen")}
            title={t("fullscreen")}
            onClick={() => {
              const box = shell.current;
              if (box === null) return;
              if (document.fullscreenElement === null) void box.requestFullscreen?.().catch(() => undefined);
              else void document.exitFullscreen?.().catch(() => undefined);
            }}
            /* 2026-09-03: an icon-only control is `.btn btn-icon`, like the
               attachment row's trash and the items panel's. `.btn` draws no
               border of its own, so the outline this grip had is stated
               rather than assumed. */
            className="btn btn-icon border border-border text-fg-muted hover:text-fg"
          >
            <IconResize width={12} height={12} />
          </button>
        </div>
      </div>

      {/* ── the surface ──────────────────────────────────────────────── */}
      {mode === "board" ? (
        <div className="min-h-0 flex-1">
          <Whiteboard meetingId={meeting.id} canEdit={isHost} />
        </div>
      ) : null}

      {video ? (
        /*
         * THE ROOM IS MOUNTED FOR THE WHOLE STAGE, AND HIDDEN WHEN ANOTHER
         * MODE IS ON SCREEN (user report, 2026-09-07: "when you switch
         * between whiteboard and video mid recording it gets disconnected and
         * tries to connect again and sets everything again as well — this
         * will end up not recording some parts of the conversation").
         *
         * It used to render only in its own mode, so walking to the
         * whiteboard UNMOUNTED `LiveKitRoom`: the socket closed, every track
         * was unpublished, the audio tap cleared, and coming back minted a
         * fresh ticket and renegotiated from nothing. Everything said between
         * the two was gone from the room — and the camera and microphone came
         * back at whatever the props said rather than at what the person had
         * chosen.
         *
         * `hidden` is display:none on the wrapper: the connection, the
         * published tracks and the tap all carry on exactly as they were,
         * and only the pixels stop. `contents` while visible so the wrapper
         * adds no box of its own — the room's own `flex-1` still answers to
         * the stage.
         *
         * The room lives HERE, in the box — a Google Meet link could only
         * ever open a window, because Google refuses to be framed.
         */
        <div className={mode === "video" ? "contents" : "hidden"}>
          <MeetingRoom meetingId={meeting.id} />
        </div>
      ) : null}

      {mode === "slides" ? (
        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden">
          {/* the CONTROLS are the host's; a colleague gets the document and
              no row of buttons that would refuse them */}
          {isHost ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
              <button
                type="button"
                onClick={() => pdfInput.current?.click()}
                disabled={uploading}
                /* 2026-09-03: a toolbar control, so `.btn btn-sm` — this one
                   had a THIRD geometry (36px, 16px corner) inside a component
                   already carrying two, which is the user's ten-developers
                   complaint inside a single file. */
                className="btn btn-sm gap-1.5 border border-border font-medium text-fg hover:bg-border"
              >
                <IconUpload width={12} height={12} />
                {uploading ? t("uploading") : t("loadPdf")}
              </button>
              {(files ?? []).map((file) => (
                <button
                  key={file.id}
                  type="button"
                  aria-pressed={showing?.id === file.id}
                  onClick={() => present(showing?.id === file.id ? null : file.id)}
                  className={`btn btn-sm max-w-[16rem] font-medium ${
                    showing?.id === file.id
                      ? "bg-accent text-on-accent"
                      : "border border-border text-fg-muted hover:text-fg"
                  }`}
                >
                  <span className="truncate">{file.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file === undefined) return;
              setUploading(true);
              void api.uploadMeetingAttachment(meeting.id, file)
                .then(() => api.meetingAttachments(meeting.id))
                .then((rows) => {
                  const pdfs = rows.filter((f) => f.content_type.includes("pdf"));
                  setFiles(pdfs);
                  /* uploading a deck IS asking to show it — a file that
                     lands and then waits for a second press is a step
                     nobody wanted in the middle of a meeting */
                  const fresh = pdfs[pdfs.length - 1];
                  if (fresh !== undefined) present(fresh.id);
                })
                .catch(() => notify(t("uploadFailed"), "warn"))
                .finally(() => setUploading(false));
            }}
          />
          {showing === null ? (
            <p className="grid flex-1 place-items-center p-6 text-center text-sm text-fg-muted">
              {isHost ? t("noSlides") : t("noSlidesViewer")}
            </p>
          ) : (
            <object data={showing.url} type="application/pdf" className="min-h-0 flex-1">
              <p className="p-6 text-center text-sm text-fg-muted">{t("pdfUnsupported")}</p>
            </object>
          )}
        </div>
      ) : null}

      {/* ── the second brain (item 7) ──────────────────────────────────
          Only for the host, only while a take is rolling: a card on ten
          screens is a broadcast, and a card with no meeting under way is
          recall of a room that is not talking. */}
      <RecallCards cards={recall.cards} onDismiss={recall.dismiss} />
    </div>
  );
}
