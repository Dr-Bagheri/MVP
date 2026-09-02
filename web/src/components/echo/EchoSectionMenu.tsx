"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  IconPlus, IconUpload,
  } from "@/components/icons";
import { startRecording } from "@/lib/recordingEngine";
import { Link } from "@/i18n/routing";
import { digits } from "@/lib/format";
import { notify } from "@/lib/notify";
import { uploadAudioFile } from "@/lib/uploadFile";

/**
 * Echo's section menu, extracted (2026-08-25) so the SEARCH page can wear
 * it too — search searches the records, so it lives with them (user
 * directive, moving it out of the assistant's menu).
 *
 * Two doors ride the rows as trailing icons rather than as rows of their
 * own (user directive): ARCHIVE at the end of Records, and UPLOAD at the
 * end of New meeting. Upload opens the file picker RIGHT HERE and the file
 * travels without a page in between — the record appears in the table when
 * the pipeline has it (the api client announces the change; the table
 * refetches itself).
 */
export type EchoMenuSlug = "new-meeting" | "records" | "archive" | "speakers" | "search";

export function EchoSectionMenu({ activeSlug }: { activeSlug: EchoMenuSlug }) {
  const t = useTranslations("platform");
  const tEcho = useTranslations("echo");
  const tCapture = useTranslations("capture");
  const locale = useLocale();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * QUICK VOICE MEMO (user directive, 2026-08-26): the ＋ beside the
   * upload door on New meeting — both are ways a recording BEGINS, so they
   * share the row where recordings begin (it sat beside the archive first;
   * corrected the same day). Same engine call the page made: self-naming
   * title, mic only, both-languages hint. The row's href then lands the
   * person on the recording page, watching the take they just started.
   */
  function quickMemo(): void {
    const at = new Intl.DateTimeFormat(
      locale === "fa" ? "fa-IR" : "en-GB",
      { hour: "2-digit", minute: "2-digit" },
    ).format(new Date());
    void startRecording({
      micId: "",
      language: "mixed",
      source: "mic",
      title: `${tCapture("memoTitle")} ${at}`,
      locale,
      resume: null,
      noiseSuppression: true, // no UI on this door — the default (on) applies
    });
    notify(tCapture("memoStarted"));
  }

  /**
   * THE THREE LESSONS (user directive, 2026-08-26): menu rows that teach by
   * doing — dim the screen, ring one real control at a time, say what to
   * press. Text is resolved HERE so the tour store stays render-free.
   */

  /** the picker's answer: a toast per outcome, in the person's language */
  async function takeFile(file: File): Promise<void> {
    setBusy(true);
    notify(tCapture("uploading"));
    const result = await uploadAudioFile(file);
    setBusy(false);
    if (result.ok) {
      notify(tCapture("uploadedBody"));
      return;
    }
    notify(
      result.reason === "notAudio"
        ? tCapture("notAudio", { name: file.name })
        : result.reason === "tooBig"
          ? tCapture("tooBig", { size: digits(result.megabytes, locale) })
          : result.reason === "tooLong"
            ? tCapture("tooLong")
            : tCapture("uploadFileFailed"),
      "warn",
    );
  }

  return (
    <>
      {/* the picker itself — hidden, opened by the menu's trailing icon */}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void takeFile(file);
        }}
      />
      {/*
        ECHO'S TOOLBAR — two destinations, on top (user directive, 2026-09-02).
        What left, and why each one left rather than being hidden:
          SEARCH   the top bar already has a search field on every screen; two
                   doors to one room is how a person wonders which is real.
          SPEAKERS moved to Management, where the people of an organisation
                   already live — a voice print is a fact about a colleague,
                   not about a recording.
          LEARN    the three guided walks were a menu group inside one app;
                   they are not a place you navigate to.
        Echo is being folded into the meeting surface. This is the shape it
        keeps until then, and it is the platform's shape rather than its own.
      */}
      <nav aria-label={t("echo")} className="flex flex-wrap items-center gap-1">
        {[
          { slug: "new-meeting", href: "/echo", label: tEcho("section.new-meeting") },
          { slug: "records", href: "/echo/records", label: tEcho("section.records") },
          { slug: "archive", href: "/echo/archive", label: tEcho("section.archive") },
        ].map((item) => {
          const active = activeSlug === item.slug;
          return (
            <Link
              key={item.slug}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`btn btn-sm gap-1.5 font-medium ${
                active ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {/* the two ways to START one, kept beside the destinations because
            they are what this app is for */}
        <button
          type="button"
          onClick={quickMemo}
          className="btn btn-sm gap-1.5 border border-border font-medium text-fg-muted hover:text-fg"
        >
          <IconPlus width={12} height={12} />
          {tCapture("quickMemo")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { if (!busy) fileRef.current?.click(); }}
          className="btn btn-sm gap-1.5 border border-border font-medium text-fg-muted hover:text-fg"
        >
          <IconUpload width={12} height={12} />
          {tEcho("uploadHere")}
        </button>
      </nav>
    </>
  );
}
