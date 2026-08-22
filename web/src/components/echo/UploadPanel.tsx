"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { uploadOnePart } from "@/lib/callUpload";
import { Card, Chip } from "@/components/ui";
import { Link } from "@/i18n/routing";
import { digits } from "@/lib/format";
import {
  MAX_MB,
  MAX_MINUTES,
  audioContentType,
  readDurationSeconds,
  uploadRejection,
} from "./uploadRules";

/**
 * Upload a file — the second producer on the Part 5 wire. The drop zone the
 * mock drew is kept; what changes is that an accepted file now actually
 * TRAVELS: create call → signed PUT straight to storage → register →
 * finish, after which the pipeline owns it and the call shows up under
 * Calls as `processing`.
 *
 * One file = one part at offset 0. The 30-minute split is a RECORDING
 * concern (M2 splits at capture time); an uploaded file arrives whole and
 * the pipeline transcribes it as one part — the same shape Echo Mobile's
 * uploads have always had.
 */

type Phase = "idle" | "checking" | "uploading" | "done" | "failed";

export function UploadPanel({ onFinished }: { onFinished?: () => void }) {
  const t = useTranslations("capture");
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const lastFile = useRef<File | null>(null);

  async function accept(file: File): Promise<void> {
    setError(null);
    setFileName(file.name);
    setPhase("checking");

    const contentType = audioContentType(file);
    if (contentType === null) {
      setPhase("idle");
      setError(t("notAudio", { name: file.name }));
      return;
    }
    // size first: a 900MB file is refused without waiting on a decode
    const oversize = uploadRejection(file.size, null);
    const rejection = oversize ?? uploadRejection(file.size, await readDurationSeconds(file));
    if (rejection?.reason === "tooBig") {
      setPhase("idle");
      setError(t("tooBig", { size: digits(rejection.megabytes, locale) }));
      return;
    }
    if (rejection?.reason === "tooLong") {
      setPhase("idle");
      setError(t("tooLong"));
      return;
    }

    lastFile.current = file;
    setPhase("uploading");
    try {
      const created = await api.createCall({
        // the file's own name, extension dropped, is the only title we have
        title: file.name.replace(/\.[^.]+$/, ""),
        source: "upload",
      });
      await uploadOnePart(api, created.id, {
        idx: 0,
        offsetMs: 0,
        blob: file,
        contentType,
      });
      await api.finishCall(created.id);
    } catch {
      // the File object is kept — retry re-runs the whole flow on a fresh
      // call row rather than resuming a half-made one
      setPhase("failed");
      return;
    }
    setPhase("done");
    onFinished?.();
  }

  return (
    <Card>
      {phase === "idle" || phase === "checking" ? (
        <>
          <div
            className={`grid place-items-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-border"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void accept(file);
            }}
          >
            <p className="text-sm text-fg">{t("dropHere")}</p>
            <label className="btn-secondary mt-3 cursor-pointer">
              {t("browse")}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void accept(file);
                }}
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-fg-muted">
            {t("limits", {
              size: digits(MAX_MB, locale),
              minutes: digits(MAX_MINUTES, locale),
            })}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {phase === "uploading" ? (
        <p className="flex items-center gap-2 text-sm text-fg">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden />
          {t("uploading")}
          {fileName ? <span className="ltr text-fg-muted">{fileName}</span> : null}
        </p>
      ) : null}

      {phase === "done" ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-success">
            <Chip tone="success">{t("uploadedChip")}</Chip>
            {fileName ? <span className="ltr text-fg-muted">{fileName}</span> : null}
          </p>
          <p className="text-xs leading-6 text-fg-muted">{t("uploadedBody")}</p>
          <Link href="/echo/records" className="btn-secondary inline-flex">
            {t("goToCalls")}
          </Link>
          <button
            className="btn-primary ms-3 inline-flex"
            onClick={() => {
              setPhase("idle");
              setFileName(null);
            }}
          >
            {t("uploadAnother")}
          </button>
        </div>
      ) : null}

      {phase === "failed" ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-danger">
            {t("uploadFileFailed")}
            {fileName ? <span className="ltr ms-1 text-fg-muted">{fileName}</span> : null}
          </p>
          <button
            className="btn-primary"
            onClick={() => {
              if (lastFile.current) void accept(lastFile.current);
            }}
          >
            {t("retryUploads")}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
