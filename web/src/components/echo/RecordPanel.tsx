"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card, Chip, Field, Progress } from "@/components/ui";
import { formatClock, digits } from "@/lib/format";

const PART_SECONDS = 30 * 60; // M7: 30-minute parts
const MAX_MB = 500;
const MAX_MINUTES = 240;

/**
 * The upload limits, as a decision rather than a branch inside an event
 * handler — so the rule can be tested without a browser, a file, or a decoder.
 *
 * It exists because the limits line promises «پیش از بارگذاری بررسی می‌شود»
 * (*checked before upload*) and only the size ever was. The `tooLong` string
 * was fully translated and unreachable: a four-hour file was accepted under a
 * message saying it had been examined.
 *
 * An unusable duration ACCEPTS. Refusing on "unknown" would reject valid audio
 * in any format this particular browser cannot read, and the server checks
 * anyway — "we could not look" must not be reported as "we looked and it was
 * too long".
 *
 * **"Unusable" is decided HERE, not by the caller.** `null` is the obvious
 * case, but `HTMLMediaElement.duration` reports **`Infinity`** for media with
 * no seekable metadata — a live stream, some webm without a duration element —
 * and `Infinity > 14400` is true, so an undecodable file would be refused as
 * "too long": precisely the lie this repair exists to prevent, wearing a
 * number instead of a null. `NaN` folds the same way.
 *
 * The call site already filters both. This function repeats the check rather
 * than trusting it, because the guarantee lived one level away from the
 * decision that depends on it — fine with one caller, a landmine for the
 * second (a server check, another upload surface, a test), and it would read
 * as defensive rigour the whole time. Found by FE2 reviewing the repair.
 */
export function uploadRejection(
  sizeBytes: number,
  durationSeconds: number | null,
): { reason: "tooBig"; megabytes: number } | { reason: "tooLong" } | null {
  const megabytes = sizeBytes / (1024 * 1024);
  if (megabytes > MAX_MB) return { reason: "tooBig", megabytes: Math.round(megabytes) };
  const usable =
    durationSeconds !== null && Number.isFinite(durationSeconds) ? durationSeconds : null;
  // strictly greater: a file exactly at the limit is within it, and an
  // off-by-one here refuses the boundary case the number was chosen to allow
  if (usable !== null && usable > MAX_MINUTES * 60) return { reason: "tooLong" };
  return null;
}

/**
 * Record-or-upload, lifted out of `/capture` so the merged Echo surface and
 * the old route are the SAME implementation rather than two that agree today.
 *
 * Extraction, not rewrite: the recorder, the level meter and the 30-minute
 * part indicator are carried over verbatim. The one behavioural change is
 * described on `checkFile` below, and it is a claim being made true rather
 * than a feature being added.
 */
export function RecordPanel() {
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

  /**
   * Reads a media file's duration without uploading it.
   *
   * Resolves `null` when the browser cannot decode enough to say — a codec it
   * does not support, or a truncated file. `null` is "unknown", never "fine":
   * the difference decides whether the check below is allowed to refuse.
   */
  function readDurationSeconds(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      const finish = (value: number | null) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      audio.onloadedmetadata = () =>
        finish(Number.isFinite(audio.duration) ? audio.duration : null);
      audio.onerror = () => finish(null);
      audio.src = url;
    });
  }

  /**
   * Reads the duration, then applies `uploadRejection` — the decision lives in
   * that pure function so the RULE is tested and this only wires it up.
   *
   * The size is checked before the decode is even attempted: a 900 MB file is
   * refused for its size without waiting on metadata it does not need.
   */
  async function checkFile(file: File) {
    setAccepted(null);
    const oversize = uploadRejection(file.size, null);
    const rejection =
      oversize ?? uploadRejection(file.size, await readDurationSeconds(file));
    if (rejection?.reason === "tooBig") {
      setFileError(t("tooBig", { size: digits(rejection.megabytes, locale) }));
      return;
    }
    if (rejection?.reason === "tooLong") {
      setFileError(t("tooLong"));
      return;
    }
    setFileError(null);
    setAccepted(file.name);
  }

  return (
    <>
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
              if (file) void checkFile(file);
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
                  if (file) void checkFile(file);
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
          {fileError ? <p className="mt-2 text-sm text-danger">{fileError}</p> : null}
          {accepted ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-success">
              <Chip tone="success">{t("accepted")}</Chip>
              <span className="ltr text-fg-muted">{accepted}</span>
            </p>
          ) : null}
        </Card>
      )}
    </>
  );
}
