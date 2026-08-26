"use client";

import { useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  IconArchive, IconAsk, IconMic, IconPlus, IconRows, IconSearch, IconUpload,
  IconVoice,
} from "@/components/icons";
import { startRecording } from "@/lib/recordingEngine";
import { startTour } from "@/lib/tour";
import { SectionMenu } from "@/components/scaffold";
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
  const tTour = useTranslations("tour");
  const locale = useLocale();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const ICONS: Record<string, ReactNode> = {
    "new-meeting": <IconMic />,
    records: <IconRows />,
    speakers: <IconVoice />,
    search: <IconSearch />,
  };

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
    });
    notify(tCapture("memoStarted"));
  }

  /**
   * THE THREE LESSONS (user directive, 2026-08-26): menu rows that teach by
   * doing — dim the screen, ring one real control at a time, say what to
   * press. Text is resolved HERE so the tour store stays render-free.
   */
  function lessonRecord(): void {
    startTour([
      { target: "tour-new-meeting", href: "/echo", text: tTour("rec1") },
      { target: "rec-devices", text: tTour("rec2") },
      { target: "rec-meeting", text: tTour("rec3") },
      { target: "rec-start", text: tTour("rec4") },
    ]);
  }
  function lessonUpload(): void {
    startTour([
      { target: "tour-upload", href: "/echo", text: tTour("up1") },
      { target: "tour-records", text: tTour("up2") },
    ]);
  }
  function lessonAsk(): void {
    startTour([
      { target: "tour-records", href: "/echo/records", text: tTour("ask1") },
      { target: "tour-search", text: tTour("ask2") },
      { target: "orb", text: tTour("ask3") },
    ]);
  }

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
      <SectionMenu
        navLabel={t("echo")}
        heading={t("echo")}
        /* the archive row highlights Records — it IS the records place */
        activeSlug={activeSlug === "archive" ? "records" : activeSlug}
        groups={[
          {
            /* SEARCH first, unlabelled (user directive, 2026-08-26): it is
               the way IN to everything below it, and a heading over one row
               that already says «جست‌وجو» is a word spent twice */
            key: "find",
            items: [{
              slug: "search",
              href: "/search",
              label: t("search"),
              icon: ICONS.search,
              tourId: "tour-search",
            }],
          },
          {
            key: "capture",
            title: tEcho("group.capture"),
            items: [{
              slug: "new-meeting",
              href: "/echo",
              label: tEcho("section.new-meeting"),
              icon: ICONS["new-meeting"],
              tourId: "tour-new-meeting",
              /* two doors on one row: upload keeps the very end (it was
                 there first — a door that moves is a door people reach for
                 and miss); the quick memo's ＋ sits beside it and BOTH
                 starts the take and opens this row's page */
              trailing: [
                {
                  label: tEcho("uploadHere"),
                  icon: <IconUpload width={16} height={16} />,
                  onSelect: () => { if (!busy) fileRef.current?.click(); },
                  tourId: "tour-upload",
                },
                {
                  href: "/echo",
                  label: tCapture("quickMemo"),
                  icon: <IconPlus width={16} height={16} />,
                  onSelect: quickMemo,
                },
              ],
            }],
          },
          {
            key: "review",
            title: tEcho("group.review"),
            items: [
              {
                slug: "records",
                href: "/echo/records",
                label: tEcho("section.records"),
                icon: ICONS.records,
                tourId: "tour-records",
                trailing: {
                  href: "/echo/archive",
                  label: tEcho("section.archive"),
                  icon: <IconArchive width={16} height={16} />,
                },
              },
              {
                slug: "speakers",
                href: "/echo/speakers",
                label: tEcho("section.speakers"),
                icon: ICONS.speakers,
              },
            ],
          },
          {
            /* the assistant TEACHES (user directive, 2026-08-26): three
               guided walks that highlight the real controls. Rows, not a
               chatbot prompt — a lesson should start with one press. */
            key: "learn",
            title: tTour("group"),
            items: [
              {
                slug: "learn-record",
                href: "/echo",
                label: tTour("lessonRecord"),
                icon: <IconAsk width={16} height={16} />,
                preventNavigation: true,
                onSelect: lessonRecord,
              },
              {
                slug: "learn-upload",
                href: "/echo",
                label: tTour("lessonUpload"),
                icon: <IconAsk width={16} height={16} />,
                preventNavigation: true,
                onSelect: lessonUpload,
              },
              {
                slug: "learn-ask",
                href: "/echo/records",
                label: tTour("lessonAsk"),
                icon: <IconAsk width={16} height={16} />,
                preventNavigation: true,
                onSelect: lessonAsk,
              },
            ],
          },
        ]}
      />
    </>
  );
}
