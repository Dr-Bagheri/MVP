/**
 * The EXPORT PACK, phase 1 (user backlog, 2026-08-23): SRT/VTT subtitles
 * and a Markdown minutes file, generated CLIENT-SIDE from data the call
 * page already holds — no new wire, no server render. Word/PDF letterhead
 * and .ics ride a later phase.
 *
 * Subtitles carry only rows with USABLE timing (M20's ladder means a
 * degraded row can span a whole part — a subtitle that sits on screen for
 * nine minutes is not a subtitle). The Markdown export carries everything;
 * prose does not need timestamps to be true.
 */
import type { TranscriptSegment } from "@/api/types";

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** 3661500 → "01:01:01,500" (SRT) or "01:01:01.500" (VTT). */
export function subtitleClock(ms: number, sep: "," | "."): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(clamped % 1000, 3)}`;
}

/** Rows a subtitle can honestly represent: a real span, bounded length. */
function timedRows(rows: TranscriptSegment[]): TranscriptSegment[] {
  const MAX_CUE_MS = 30_000;
  return rows.filter(
    (row) => row.end_ms > row.start_ms && row.end_ms - row.start_ms <= MAX_CUE_MS,
  );
}

export function canExportSubtitles(rows: TranscriptSegment[]): boolean {
  return timedRows(rows).length > 0;
}

export function srtFrom(
  rows: TranscriptSegment[],
  speakerName: (id: string | null) => string,
): string {
  return timedRows(rows)
    .map(
      (row, i) =>
        `${i + 1}\n${subtitleClock(row.start_ms, ",")} --> ${subtitleClock(row.end_ms, ",")}\n` +
        `${speakerName(row.speaker_id)}: ${row.text}\n`,
    )
    .join("\n");
}

export function vttFrom(
  rows: TranscriptSegment[],
  speakerName: (id: string | null) => string,
): string {
  const cues = timedRows(rows)
    .map(
      (row) =>
        `${subtitleClock(row.start_ms, ".")} --> ${subtitleClock(row.end_ms, ".")}\n` +
        `${speakerName(row.speaker_id)}: ${row.text}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${cues}`;
}

export function markdownFrom(opts: {
  title: string;
  date: string;
  summary: string | null;
  rows: TranscriptSegment[];
  speakerName: (id: string | null) => string;
  labels: { summary: string; transcript: string };
}): string {
  const lines: string[] = [`# ${opts.title}`, "", opts.date, ""];
  if (opts.summary) {
    lines.push(`## ${opts.labels.summary}`, "", opts.summary, "");
  }
  lines.push(`## ${opts.labels.transcript}`, "");
  for (const row of opts.rows) {
    lines.push(`**${opts.speakerName(row.speaker_id)}:** ${row.text}`, "");
  }
  return lines.join("\n");
}

/** Filename-safe title: keep letters (any script) and digits, dash the rest. */
export function exportFilename(title: string, ext: string): string {
  const safe = title.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${safe || "call"}.${ext}`;
}

/** Hand the browser a file. UTF-8 with BOM for SRT — legacy players read
    Persian as mojibake without it; VTT/MD stay bare (the VTT magic must be
    the first bytes, and nothing modern needs the BOM). */
export function downloadText(name: string, text: string, mime: string): void {
  const bom = name.endsWith(".srt") ? "\uFEFF" : "";
  const blob = new Blob([bom + text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
