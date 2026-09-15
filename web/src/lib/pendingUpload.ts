"use client";

/**
 * THE FILE THAT TRAVELS WITH THE NAVIGATION.
 *
 * The new-call wizard used to send the bytes and then navigate, so a long
 * recording held a modal open with a disabled button for as long as the
 * upload took. The order is reversed now: the meeting row is written, the
 * dialog closes, and the meeting's own page does the sending under the
 * processing card — which is the screen that already knows how to show a
 * pipeline running.
 *
 * A MODULE VARIABLE rather than a store, a context or a query parameter,
 * and each alternative is rejected for a different reason:
 *
 *   · a `File` is a handle to bytes on disk — it cannot be serialised into
 *     a URL, and putting an id there would mean uploading from a second
 *     place that reads it back;
 *   · a React context would have to live above the router to survive the
 *     navigation, which is the whole app for one hand-off;
 *   · `sessionStorage` would keep the handle across a RELOAD, where the
 *     bytes are gone and the promise cannot be kept.
 *
 * This is exactly as durable as the hand-off is: the push is client-side,
 * so the module survives it, and a reload correctly loses the file — the
 * page then shows the meeting with no record and its own upload button,
 * which is a true picture rather than a spinner waiting on nothing.
 *
 * TAKEN ONCE. The page's effect re-runs on a remount, and handing the same
 * file back twice would upload it twice — two records for one meeting, the
 * second of which would replace the first's link.
 */
let pending: { meetingId: string; file: File } | null = null;

export function stashUpload(meetingId: string, file: File): void {
  pending = { meetingId, file };
}

/** the file waiting for this meeting, removed as it is handed over */
export function takeUpload(meetingId: string): File | null {
  if (pending === null || pending.meetingId !== meetingId) return null;
  const { file } = pending;
  pending = null;
  return file;
}

/** for tests, and for a navigation that never arrived */
export function clearPendingUpload(): void {
  pending = null;
}
