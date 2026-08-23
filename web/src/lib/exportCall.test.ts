/**
 * Export pack, phase 1. The discriminating cases: a DEGRADED row (whole-
 * part span) must stay OUT of subtitles while staying IN the Markdown —
 * both directions asserted, because "export works" is true of a version
 * that silently drops prose or ships nine-minute cues.
 */
import { describe, expect, it } from "vitest";
import {
  canExportSubtitles,
  exportFilename,
  markdownFrom,
  srtFrom,
  subtitleClock,
  vttFrom,
} from "./exportCall";
import type { TranscriptSegment } from "@/api/types";

const row = (over: Partial<TranscriptSegment>): TranscriptSegment => ({
  id: "s-1", seq: 1, part_id: null, start_ms: 1500, end_ms: 4200,
  speaker_id: "sp-1", channel: null, edited: false, text: "سلام به همه",
  words: [], ...over,
});
const name = (id: string | null) => (id === "sp-1" ? "امیر" : "نامشخص");

describe("export pack", () => {
  it("subtitle clocks carry hours and the right separator", () => {
    expect(subtitleClock(3_661_500, ",")).toBe("01:01:01,500");
    expect(subtitleClock(3_661_500, ".")).toBe("01:01:01.500");
  });

  it("SRT numbers cues and quotes the speaker", () => {
    const srt = srtFrom([row({})], name);
    expect(srt).toContain("1\n00:00:01,500 --> 00:00:04,200\nامیر: سلام به همه");
  });

  it("VTT opens with its magic and uses dots", () => {
    const vtt = vttFrom([row({})], name);
    expect(vtt.startsWith("WEBVTT\n")).toBe(true);
    expect(vtt).toContain("00:00:01.500 --> 00:00:04.200");
  });

  it("a degraded whole-part span stays OUT of subtitles and IN the markdown", () => {
    const degraded = row({ id: "s-2", start_ms: 0, end_ms: 540_000, text: "متن بلند" });
    expect(srtFrom([degraded], name)).toBe("");
    expect(canExportSubtitles([degraded])).toBe(false);
    const md = markdownFrom({
      title: "جلسه", date: "1405", summary: "خلاصه", rows: [degraded],
      speakerName: name, labels: { summary: "خلاصه", transcript: "متن" },
    });
    expect(md).toContain("متن بلند");
    expect(md).toContain("## خلاصه");
  });

  it("filenames keep Persian letters and never the path-hostile rest", () => {
    expect(exportFilename("جلسه هفتگی: بودجه؟", "srt")).toBe("جلسه-هفتگی-بودجه.srt");
    expect(exportFilename("  ", "md")).toBe("call.md");
  });
});
