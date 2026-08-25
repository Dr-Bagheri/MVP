"use client";

import { useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  IconArchive, IconMic, IconRows, IconSearch, IconUpload, IconVoice,
} from "@/components/icons";
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
  const locale = useLocale();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const ICONS: Record<string, ReactNode> = {
    "new-meeting": <IconMic />,
    records: <IconRows />,
    speakers: <IconVoice />,
    search: <IconSearch />,
  };

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
            key: "capture",
            title: tEcho("group.capture"),
            items: [{
              slug: "new-meeting",
              href: "/echo",
              label: tEcho("section.new-meeting"),
              icon: ICONS["new-meeting"],
              trailing: {
                label: tEcho("uploadHere"),
                icon: <IconUpload width={15} height={15} />,
                onSelect: () => { if (!busy) fileRef.current?.click(); },
              },
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
                trailing: {
                  href: "/echo/archive",
                  label: tEcho("section.archive"),
                  icon: <IconArchive width={15} height={15} />,
                },
              },
              {
                slug: "speakers",
                href: "/echo/speakers",
                label: tEcho("section.speakers"),
                icon: ICONS.speakers,
              },
              {
                slug: "search",
                href: "/search",
                label: t("search"),
                icon: ICONS.search,
              },
            ],
          },
        ]}
      />
    </>
  );
}
