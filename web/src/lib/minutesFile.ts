import type { MeetingSignaturesRecord, Org } from "@/api/types";
import {
  minutesDocument, minutesWordFile, type SheetForDocument, type SignatureForDocument,
} from "@/components/platform/meeting/minutesDocument";
import { parseSummary } from "@/components/echo/SummaryBody";
import { meetingPeople } from "@/lib/meetingPeople";
import fa from "@/messages/fa.json";
import en from "@/messages/en.json";

/**
 * THE MINUTES AS A FILE, composed outside React.
 *
 * Two doors reach the same document: the summary tab's ⋯ and the assistant's
 * `export_meeting_minutes`. This is the half they share — the letterhead, the
 * catalogue and (for the agent's door) the reads — so the two cannot produce
 * different-looking documents for the same meeting.
 */

/** the meetings catalogue as a plain function, for code with no React context
    around it. The interpolation is the one shape our own strings use. */
export function catalogueFor(locale: string): (key: string, vars?: Record<string, string | number>) => string {
  const dict = (locale === "en" ? en : fa) as unknown as { meetings: Record<string, string> };
  return (key, vars) => {
    const raw = dict.meetings[key] ?? key;
    return vars === undefined
      ? raw
      : Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), raw);
  };
}

/**
 * The organisation's letterhead as the document needs it: a DATA URI.
 *
 * It cannot be a URL. The document travels — into a .doc file Word opens from
 * disk, and into a print window with no session of its own — and in both
 * places an `/api/...` reference resolves to nothing. So the bytes come along.
 *
 * Cached for the life of the tab: a sheet is up to three megabytes, and a
 * second export should not pay for it again.
 *
 * A FAILURE IS NOT AN ERROR THE READER MUST ACT ON. A document on plain paper
 * is still the document; refusing to export because a decoration did not load
 * would trade the whole feature for the sheet.
 */
let cached: { key: string; sheet: SheetForDocument | null } | null = null;

export async function letterheadForDocument(org: Org | null): Promise<SheetForDocument | null> {
  const sheet = org?.sheet;
  if (sheet === undefined || sheet.mime === null) return null;
  /* keyed by the MARGINS and the mime, so a sheet replaced or a clear area
     nudged in another tab is not served from a stale copy */
  const key = `${sheet.mime}:${sheet.top_mm}:${sheet.bottom_mm}:${sheet.side_mm}`;
  if (cached?.key === key) return cached.sheet;
  try {
    const { api } = await import("@/api/client");
    const response = await fetch(api.orgSheetUrl());
    if (!response.ok) throw new Error(String(response.status));
    /* the BYTES, encoded here rather than through FileReader: a reader is an
       event-driven object that has to be wrapped in a promise, and it reads a
       Blob rather than the bytes — one more layer between the response and
       the string, in the one place where a failure is silent by design.
       Chunked, because `fromCharCode(...threeMillionBytes)` overflows the
       argument list. */
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let at = 0; at < bytes.length; at += 8192) {
      binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
    }
    const dataUrl = `data:${sheet.mime};base64,${btoa(binary)}`;
    cached = {
      key,
      sheet: { dataUrl, topMm: sheet.top_mm, bottomMm: sheet.bottom_mm, sideMm: sheet.side_mm },
    };
  } catch {
    cached = { key, sheet: null };
  }
  return cached.sheet;
}

/** forget the letterhead — called when one is uploaded or removed, so the
    next export is the sheet on screen rather than the one before it */
export function forgetLetterhead(): void {
  cached = null;
}

/** bytes → base64, chunked: `fromCharCode(...aMillionBytes)` overflows the
    argument list — the same helper the letterhead reads through */
async function base64OfResponse(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return btoa(binary);
}

/**
 * THE SIGNATURES PLACED ON A MEETING, as the document needs them: each
 * picture as a DATA URI (the letterhead's reason — the file travels), keyed
 * by the signer's account id, which is what `meetingPeople` keys a member
 * by, so the row and its signature meet in the table.
 *
 * Read fresh on every export, never cached: a colleague may have signed
 * since the tab was opened, and "the host printed it and my signature was
 * not on it" is the one report this feature must never produce.
 *
 * A picture that cannot be fetched is LEFT OUT and the rest still print —
 * one missing signature is a blank line somebody signs by hand, and refusing
 * the whole document for it would trade the record for a decoration.
 */
export async function signaturesForDocument(
  meetingId: string,
  placed: MeetingSignaturesRecord,
): Promise<SignatureForDocument[]> {
  const { api } = await import("@/api/client");
  const out: SignatureForDocument[] = [];
  for (const row of placed.signatures) {
    try {
      const response = await fetch(api.meetingSignatureImageUrl(meetingId, row.user_id));
      if (!response.ok) continue;
      out.push({
        key: row.user_id,
        dataUrl: `data:${row.mime};base64,${await base64OfResponse(response)}`,
        signedAt: row.signed_at,
      });
    } catch {
      /* left out, said above */
    }
  }
  return out;
}

/**
 * Everything one meeting's document needs, read under the caller's own
 * session. The assistant's door: the summary tab already holds this state and
 * passes it straight to `minutesDocument`.
 */
export async function minutesDocumentFor(
  meetingId: string,
  target: "browser" | "word" = "word",
): Promise<string> {
  const { api } = await import("@/api/client");
  const meeting = await api.meetingDetail(meetingId);
  const items = await api.meetingItems(meetingId).catch(() => []);
  const versions = meeting.call_id === null
    ? [] : await api.getSummaries(meeting.call_id).catch(() => []);
  const org = await api.org().catch(() => null);
  /* the signatures placed so far — an unreadable list prints as none rather
     than refusing the document (the same posture as the letterhead) */
  const placed = await api.meetingSignatures(meetingId)
    .catch((): MeetingSignaturesRecord => ({
      signatures: [], can_sign: false, has_signature_on_file: false, signed: false,
    }));
  /* the language the person is READING, taken from the rendered document
     rather than guessed: this code runs with no React context around it, and
     `<html lang>` is what the shell actually set */
  const locale = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "fa";
  const args = {
    t: catalogueFor(locale),
    locale,
    meeting,
    people: meetingPeople(meeting, locale).map((p) => ({ key: p.key, name: p.name })),
    signatures: await signaturesForDocument(meetingId, placed),
    summaryBlocks: parseSummary(versions[versions.length - 1]?.body ?? ""),
    decisions: items.filter((i) => i.kind === "decision").map((i) => i.body),
    actions: items.filter((i) => i.kind === "action"),
    sheet: await letterheadForDocument(org),
  };
  return target === "word" ? minutesWordFile(args) : minutesDocument(args);
}
