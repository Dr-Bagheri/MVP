"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Recorder } from "./Recorder";
import { UploadPanel } from "./UploadPanel";

/**
 * Echo · New meeting (user directive, 2026-08-22): "Record in browser"
 * and "Upload a file" merged into ONE place with two tabs — the two ways
 * a meeting enters the platform are one decision, not two destinations.
 * The old /echo/record and /echo/upload addresses alias here (the page
 * picks the opening tab from them), so nothing bookmarked breaks and the
 * agent's start_recording path lands on the recorder exactly as before.
 */
export function NewMeetingSection({
  initialTab = "record",
  onFinished,
}: {
  initialTab?: "record" | "upload";
  onFinished?: () => void;
}) {
  const t = useTranslations("echo");
  const [tab, setTab] = useState<"record" | "upload">(initialTab);

  return (
    <div className="space-y-5">
      <div className="flex w-fit overflow-hidden rounded-lg border border-border" role="tablist">
        {(["record", "upload"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`h-10 px-4 text-sm transition-colors ${
              tab === key
                ? "bg-accent-soft font-semibold text-accent"
                : "bg-surface text-fg-muted hover:text-fg"
            }`}
            onClick={() => setTab(key)}
          >
            {t(`section.${key}`)}
          </button>
        ))}
      </div>

      {tab === "record"
        ? <Recorder {...(onFinished ? { onFinished } : {})} />
        : <UploadPanel {...(onFinished ? { onFinished } : {})} />}
    </div>
  );
}
