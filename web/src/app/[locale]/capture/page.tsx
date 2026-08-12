"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/AppShell";
import { Card, Chip, Field, PageHeader, Progress } from "@/components/ui";
import { formatClock, digits } from "@/lib/format";

const PART_SECONDS = 30 * 60; // M7: 30-minute parts
const MAX_MB = 500;
const MAX_MINUTES = 240;

export default function CapturePage() {
  const t = useTranslations("capture");
  const locale = useLocale();
  const [tab, setTab] = useState<"record" | "upload">("record");

  // ---- browser recording (mock level meter + part splitting UX) ----
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [title, setTitle] = useState("");
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (recording) {
      tick.current = setInterval(() => {
        setElapsed((s) => s + 1);
        setLevel(0.15 + Math.random() * 0.7);
      }, 1000);
    } else if (tick.current) {
      clearInterval(tick.current);
      setLevel(0);
    }
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
  }, [recording]);

  const partIndex = Math.floor(elapsed / PART_SECONDS);
  const inPart = elapsed % PART_SECONDS;

  // ---- upload (limits checked BEFORE upload, per SPEC) ----
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string | null>(null);

  function checkFile(file: File) {
    setAccepted(null);
    const mb = file.size / (1024 * 1024);
    if (mb > MAX_MB) {
      setFileError(t("tooBig", { size: digits(Math.round(mb), locale) }));
      return;
    }
    setFileError(null);
    setAccepted(file.name);
  }

  return (
    <AppShell page={t("title")}>
      <PageHeader title={t("title")} />

      <div className="mb-4 flex gap-2">
        <button
          className={tab === "record" ? "btn-primary h-10 min-h-0" : "btn-secondary h-10 min-h-0"}
          onClick={() => setTab("record")}
        >
          {t("recordTab")}
        </button>
        <button
          className={tab === "upload" ? "btn-primary h-10 min-h-0" : "btn-secondary h-10 min-h-0"}
          onClick={() => setTab("upload")}
        >
          {t("uploadTab")}
        </button>
      </div>

      {tab === "record" ? (
        <Card className="max-w-2xl">
          <Field label={t("titleField")}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <div className="my-6 flex items-center gap-6">
            <button
              className={recording ? "btn-danger h-14 px-6" : "btn-primary h-14 px-6"}
              onClick={() => setRecording((r) => !r)}
            >
              {recording ? t("stop") : t("start")}
            </button>
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
                <span>{t("level")}</span>
                <span className="ltr">{formatClock(elapsed, locale)}</span>
              </div>
              {/* live input-level meter (SPEC) */}
              <div className="flex h-8 items-end gap-1" dir="ltr" aria-hidden>
                {Array.from({ length: 28 }).map((_, i) => {
                  const active = recording && level > i / 28;
                  return (
                    <span
                      key={i}
                      className={`w-full rounded-sm transition-all ${
                        active ? "bg-accent" : "bg-surface-2"
                      }`}
                      style={{ height: active ? `${30 + (i % 5) * 12}%` : "18%" }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* 30-minute part indicator (M7) */}
          <div className="rounded-md bg-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-fg">
                {t("currentPart", {
                  n: digits(partIndex + 1, locale),
                  time: formatClock(inPart, locale),
                })}
              </span>
              <Chip tone="info">{formatClock(PART_SECONDS - inPart, locale)}</Chip>
            </div>
            <Progress value={(inPart / PART_SECONDS) * 100} />
            <p className="mt-2 text-xs leading-6 text-fg-muted">{t("partNotice")}</p>
          </div>
        </Card>
      ) : (
        <Card className="max-w-2xl">
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
              if (file) checkFile(file);
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
                  if (file) checkFile(file);
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
          {fileError ? (
            <p className="mt-2 text-sm text-danger">{fileError}</p>
          ) : null}
          {accepted ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-success">
              <Chip tone="success">{t("accepted")}</Chip>
              <span className="ltr text-fg-muted">{accepted}</span>
            </p>
          ) : null}
        </Card>
      )}
    </AppShell>
  );
}
