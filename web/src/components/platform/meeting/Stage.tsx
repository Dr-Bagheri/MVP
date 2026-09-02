"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { MeetingRecord } from "@/api/types";
import { Whiteboard } from "./Whiteboard";
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

export function MeetingStage({ meeting, recordingLive }: {
  meeting: MeetingRecord;
  recordingLive: boolean;
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
  const [mode, setMode] = useState<Mode>(video ? "video" : "board");
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);
  const pdfInput = useRef<HTMLInputElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);

  /* the object URL is a handle on memory: it goes when the file does */
  useEffect(() => () => { if (pdf !== null) URL.revokeObjectURL(pdf.url); }, [pdf]);

  const modeChip = (key: Mode, label: string, icon: React.ReactNode) => (
    <button
      key={key}
      type="button"
      aria-pressed={mode === key}
      onClick={() => setMode(key)}
      className={`tap flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
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
    <div ref={shell} className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface">
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
            className="tap grid h-8 w-8 place-items-center rounded-lg border border-border text-fg-muted hover:text-fg"
          >
            <IconResize width={12} height={12} />
          </button>
        </div>
      </div>

      {/* ── the surface ──────────────────────────────────────────────── */}
      {mode === "board" ? <div className="min-h-0 flex-1"><Whiteboard meetingId={meeting.id} /></div> : null}

      {mode === "video" && video ? (
        /* the room lives HERE, in the box — a Google Meet link could only
           ever open a window, because Google refuses to be framed */
        <MeetingRoom meetingId={meeting.id} />
      ) : null}

      {mode === "slides" ? (
        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border p-2">
            <button
              type="button"
              onClick={() => pdfInput.current?.click()}
              className="tap flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium text-fg hover:bg-border"
            >
              <IconUpload width={12} height={12} />
              {t("loadPdf")}
            </button>
            <span className="truncate text-[11px] text-fg-subtle">
              {pdf === null ? t("slidesLocalNote") : pdf.name}
            </span>
          </div>
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file === undefined) return;
              if (pdf !== null) URL.revokeObjectURL(pdf.url);
              setPdf({ url: URL.createObjectURL(file), name: file.name });
            }}
          />
          {pdf === null ? (
            <p className="grid flex-1 place-items-center p-6 text-center text-sm text-fg-muted">
              {t("noSlides")}
            </p>
          ) : (
            <object data={pdf.url} type="application/pdf" className="min-h-0 flex-1">
              <p className="p-6 text-center text-sm text-fg-muted">{t("pdfUnsupported")}</p>
            </object>
          )}
        </div>
      ) : null}
    </div>
  );
}
