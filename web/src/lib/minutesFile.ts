import type { Org } from "@/api/types";
import { minutesDocument, minutesWordFile, type SheetForDocument } from "@/components/platform/meeting/minutesDocument";
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
  /* the language the person is READING, taken from the rendered document
     rather than guessed: this code runs with no React context around it, and
     `<html lang>` is what the shell actually set */
  const locale = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "fa";
  const args = {
    t: catalogueFor(locale),
    locale,
    meeting,
    attendees: meetingPeople(meeting, locale).map((p) => p.name),
    summaryBlocks: parseSummary(versions[versions.length - 1]?.body ?? ""),
    decisions: items.filter((i) => i.kind === "decision").map((i) => i.body),
    actions: items.filter((i) => i.kind === "action"),
    sheet: await letterheadForDocument(org),
  };
  return target === "word" ? minutesWordFile(args) : minutesDocument(args);
}
