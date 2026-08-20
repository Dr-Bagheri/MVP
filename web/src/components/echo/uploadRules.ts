/**
 * The upload limits, as a decision rather than a branch inside an event
 * handler — so the rule can be tested without a browser, a file, or a
 * decoder. (Lifted out of the retired RecordPanel; the reasoning below is
 * carried with it.)
 *
 * `MAX_MB` is 50 because that is what the storage tier ACCEPTS per object —
 * the earlier 500 was a screen-side number from the mock era that storage
 * would have refused at byte 52,428,801, after minutes of upload. The limit
 * line under the drop zone promises «پیش از بارگذاری بررسی می‌شود» (*checked
 * before upload*), and a promise checked against the wrong number is the
 * same lie with better manners.
 *
 * An unusable duration ACCEPTS. Refusing on "unknown" would reject valid
 * audio in any format this browser cannot decode, and the server checks
 * anyway — "we could not look" must not be reported as "we looked and it
 * was too long". `HTMLMediaElement.duration` reports **`Infinity`** for
 * media with no seekable metadata and `NaN` on failure; both fold to
 * "unknown" HERE, where the decision lives, not at the call site.
 */

export const MAX_MB = 50;
export const MAX_MINUTES = 240;
export const PART_MS = 30 * 60 * 1000; // M2/M7: the 30-minute part ceiling

/** Container types the recorder/uploader can hand the pipeline (mirror of core's FORMATS). */
export const AUDIO_TYPES: Readonly<Record<string, string>> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
};

/** The wire content-type for a file, from its own type or its extension. */
export function audioContentType(file: { name: string; type: string }): string | null {
  const base = file.type.split(";")[0]!.trim();
  if (Object.values(AUDIO_TYPES).includes(base)) return base;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_TYPES[ext] ?? null;
}

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
 * Reads a media file's duration without uploading it.
 *
 * Resolves `null` when the browser cannot decode enough to say — a codec it
 * does not support, or a truncated file. `null` is "unknown", never "fine":
 * the difference decides whether `uploadRejection` is allowed to refuse.
 */
export function readDurationSeconds(file: File): Promise<number | null> {
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
 * Where a paused (unfinished) call continues from — the resume feature's one
 * calculation, kept pure so it can be verified against the two ways it is
 * easy to get wrong:
 *  - `nextIdx` is max(idx)+1, NEVER parts.length: a failed part leaves a GAP
 *    in the indices, and reusing an index collides with the worker's
 *    deterministic seq ranging (idx × 100_000 — a duplicate trips UNIQUE).
 *  - `offsetMs` is the furthest part END (max of offset+duration), NEVER the
 *    sum of durations: the duration_ms lesson — with a gap, sum under-reports
 *    and the resumed audio would overlap the tail of what exists.
 */
export function resumePoint(
  parts: readonly { idx: number; offset_ms: number; duration_ms: number | null }[],
): { nextIdx: number; offsetMs: number } {
  let nextIdx = 0;
  let offsetMs = 0;
  for (const part of parts) {
    if (part.idx + 1 > nextIdx) nextIdx = part.idx + 1;
    const end = part.offset_ms + (part.duration_ms ?? 0);
    if (end > offsetMs) offsetMs = end;
  }
  return { nextIdx, offsetMs };
}
