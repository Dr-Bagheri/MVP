"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { MeetingRecord } from "@/api/types";
import { Whiteboard } from "./Whiteboard";
import {
  IconCopy, IconOpen, IconPencil, IconPlus, IconResize, IconUpload, IconVideo,
} from "@/components/icons";
import { formatClock } from "@/lib/format";

/**
 * THE LIVE STAGE — the reference's برگزاری media area, walked in their own
 * product (2026-09-02): a header carrying the three modes on one side and
 * the recording state plus the fullscreen grip on the other, and the
 * surface itself below.
 *
 *   ویدیو    the meeting's video ROOM. They run their own; we mint a real
 *            Google Meet through the org's existing calendar grant and
 *            store it on the row. Meet refuses to be framed (that is
 *            Google's header, not our choice), so the room is a join card
 *            in the middle of the stage rather than an inline picture —
 *            the honest maximum, and it is a working room.
 *   وایت‌برد  the canvas.
 *   ارائه     a PDF, presented. The file is read in the browser and shown
 *            here; it is not uploaded anywhere, which the footer says
 *            plainly rather than implying the room can see it.
 */
type Mode = "video" | "board" | "slides";

export function MeetingStage({ meeting, recordingLive, recordedMs, onChanged }: {
  meeting: MeetingRecord;
  recordingLive: boolean;
  recordedMs: number;
  onChanged: (m: MeetingRecord) => void;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const [mode, setMode] = useState<Mode>(meeting.mode === "online" ? "video" : "board");
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);
  const pdfInput = useRef<HTMLInputElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);

  /* the object URL is a handle on memory: it goes when the file does */
  useEffect(() => () => { if (pdf !== null) URL.revokeObjectURL(pdf.url); }, [pdf]);

  const mintRoom = () => {
    setMinting(true);
    setError(null);
    void api.createMeetingRoom(meeting.id)
      .then((m) => { setMinting(false); onChanged(m); })
      .catch(() => { setMinting(false); setError(t("roomFailed")); });
  };

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
    <div ref={shell} className="flex min-h-0 flex-col gap-2">
      {/* ── the stage header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1">
          {modeChip("video", t("modeVideo"), <IconVideo width={12} height={12} />)}
          {modeChip("board", t("modeBoard"), <IconPencil width={12} height={12} />)}
          {modeChip("slides", t("modeSlides"), <IconUpload width={12} height={12} />)}
        </div>

        <div className="flex items-center gap-2">
          <span className={`badge-num flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium ${
            recordingLive ? "bg-danger/10 text-danger" : "bg-surface-2 text-fg-muted"
          }`} dir="ltr">
            <span className={`h-1.5 w-1.5 rounded-full ${recordingLive ? "animate-pulse bg-danger" : "bg-fg-subtle"}`} aria-hidden />
            {recordingLive ? formatClock(Math.floor(recordedMs / 1000), locale) : t("statusReady")}
          </span>
          {recordingLive ? (
            <span className="text-[11px] text-fg-muted">
              {t(`mode_${meeting.mode}`)} · {t("recordedHere")}
            </span>
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

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/* ── the surface ──────────────────────────────────────────────── */}
      {mode === "board" ? <Whiteboard meetingId={meeting.id} /> : null}

      {mode === "video" ? (
        <div className="grid min-h-[420px] flex-1 place-items-center overflow-hidden rounded-2xl border border-border bg-fg/95 p-6">
          {meeting.video_url === null ? (
            <div className="max-w-sm text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-bg/10 text-bg" aria-hidden>
                <IconVideo width={24} height={24} />
              </span>
              <p className="mt-3 text-sm leading-6 text-bg/80">{t("noRoomYet")}</p>
              <button
                type="button"
                onClick={mintRoom}
                disabled={minting}
                className="tap mx-auto mt-4 flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-60"
              >
                <IconPlus width={14} height={14} />
                {minting ? t("roomMinting") : t("createRoom")}
              </button>
              <p className="mt-2 text-[11px] leading-5 text-bg/50">{t("roomNote")}</p>
            </div>
          ) : (
            <div className="w-full max-w-md text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent text-on-accent" aria-hidden>
                <IconVideo width={24} height={24} />
              </span>
              <p className="mt-3 text-sm font-semibold text-bg">{t("roomReady")}</p>
              <p className="mt-1 break-all rounded-xl bg-bg/10 px-3 py-2 text-[11px] text-bg/70" dir="ltr">
                {meeting.video_url}
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <a
                  href={meeting.video_url}
                  target="_blank"
                  rel="noreferrer"
                  className="tap flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent"
                >
                  <IconOpen width={14} height={14} />
                  {t("joinRoom")}
                </a>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(meeting.video_url ?? "").catch(() => undefined)}
                  className="tap flex h-10 items-center gap-2 rounded-xl border border-bg/20 px-4 text-sm font-medium text-bg"
                >
                  <IconCopy width={14} height={14} />
                  {t("copyRoom")}
                </button>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-bg/50">{t("roomRecordNote")}</p>
            </div>
          )}
        </div>
      ) : null}

      {mode === "slides" ? (
        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface">
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
