"use client";

import { api } from "@/api/client";
import { uploadOnePart } from "@/lib/callUpload";
import {
  audioContentType,
  readDurationSeconds,
  uploadRejection,
} from "@/components/echo/uploadRules";

/**
 * Upload ONE audio file as a record — extracted from the retired upload
 * PAGE (user directive, 2026-08-25: "add an icon in the sub menu … no need
 * for opening a new page, just get the file and add it to the records
 * table"). The whole flow, refusals included, in one callable:
 *
 *   create call → signed PUT straight to storage → register → finish
 *
 * The refusal is a CODE, never a sentence: the caller speaks the language
 * (the rule that survived the whole platform's error handling). One file =
 * one part at offset 0 — splitting is a recording concern (M2), an
 * uploaded file arrives whole.
 */
export type UploadOutcome =
  | { ok: true; callId: string }
  | { ok: false; reason: "notAudio" }
  | { ok: false; reason: "tooBig"; megabytes: number }
  | { ok: false; reason: "tooLong" }
  | { ok: false; reason: "failed" };

export async function uploadAudioFile(file: File): Promise<UploadOutcome> {
  const contentType = audioContentType(file);
  if (contentType === null) return { ok: false, reason: "notAudio" };

  // size first: a 900MB file is refused without waiting on a decode
  const oversize = uploadRejection(file.size, null);
  const rejection = oversize ?? uploadRejection(file.size, await readDurationSeconds(file));
  if (rejection?.reason === "tooBig") {
    return { ok: false, reason: "tooBig", megabytes: rejection.megabytes };
  }
  if (rejection?.reason === "tooLong") return { ok: false, reason: "tooLong" };

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
    return { ok: true, callId: created.id };
  } catch {
    // a half-made call row is left behind deliberately: retrying re-runs the
    // whole flow on a fresh row rather than resuming an unknown state
    return { ok: false, reason: "failed" };
  }
}
