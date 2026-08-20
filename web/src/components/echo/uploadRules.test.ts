import { describe, expect, it } from "vitest";
import { audioContentType, resumePoint, uploadRejection } from "./uploadRules";

const MB = 1024 * 1024;
const minutes = (n: number) => n * 60;

/**
 * The upload limits, tested because the SCREEN CLAIMS THEY ARE CHECKED.
 *
 * The limits line under the drop zone promises «پیش از بارگذاری بررسی
 * می‌شود» (*checked before upload*), and in the mock era only half of it was
 * kept: `tooLong` was fully translated and unreachable, so a four-hour file
 * was accepted under a message saying it had been examined. The rule now
 * lives in `uploadRules.ts` where vitest reaches it without a browser, a
 * file, or a decoder — a test that is hard to write correctly against the
 * DOM is an argument for extracting the decision, not for trusting it.
 *
 * Since Part 5 went live the size ceiling is 50MB: what the storage tier
 * accepts per object, not the mock era's 500 — a screen-side check against
 * the wrong number is the same broken promise with better manners.
 */
describe("what the limits line promises", () => {
  it("refuses a file over the size limit", () => {
    expect(uploadRejection(51 * MB, null)).toEqual({ reason: "tooBig", megabytes: 51 });
  });

  it("refuses a file over the duration limit — the half that once did nothing", () => {
    expect(uploadRejection(10 * MB, minutes(300))).toEqual({ reason: "tooLong" });
  });

  it("accepts a file exactly AT each limit — the boundary the numbers were chosen to allow", () => {
    expect(uploadRejection(50 * MB, minutes(240))).toBeNull();
  });

  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", NaN],
  ])("accepts an unusable duration of %s — it is unknown, not long", (_label, value) => {
    /*
     * `HTMLMediaElement.duration` reports `Infinity` for media with no
     * seekable metadata, and `Infinity > 14400` is true — so without this the
     * function refuses an undecodable file as "too long", which is exactly the
     * lie the whole repair exists to prevent, wearing a number instead of a
     * null. (FE2's find, carried forward from the RecordPanel suite.)
     */
    expect(uploadRejection(10 * MB, value)).toBeNull();
  });

  it("accepts when the duration is UNKNOWN rather than refusing", () => {
    // `null` is "the browser could not decode enough to say" — not "fine" and
    // not "too long"; "we could not look" must never be reported as "we
    // looked and it was too long".
    expect(uploadRejection(10 * MB, null)).toBeNull();
  });

  it("reports SIZE first when a file breaks both limits", () => {
    // Size is knowable without decoding anything, so it is the honest answer;
    // naming the duration instead would send someone off to trim a recording
    // that would still be too large afterwards.
    expect(uploadRejection(900 * MB, minutes(300))).toEqual({ reason: "tooBig", megabytes: 900 });
  });

  it("accepts an ordinary meeting", () => {
    expect(uploadRejection(48 * MB, minutes(49))).toBeNull();
  });
});

describe("audioContentType", () => {
  it("takes the file's own audio type when it is one the pipeline accepts", () => {
    expect(audioContentType({ name: "x.bin", type: "audio/mpeg" })).toBe("audio/mpeg");
  });

  it("falls back to the extension when the type is blank — Windows leaves it blank routinely", () => {
    expect(audioContentType({ name: "meeting.m4a", type: "" })).toBe("audio/mp4");
  });

  it("answers null for something that is not audio, so the screen can refuse by NAME", () => {
    expect(audioContentType({ name: "notes.pdf", type: "application/pdf" })).toBeNull();
  });
});

describe("resumePoint", () => {
  it("continues after the furthest part END — max, never sum (the duration_ms lesson)", () => {
    // a gap: part 1 failed and is absent; sum of durations would say 120000
    const parts = [
      { idx: 0, offset_ms: 0, duration_ms: 60_000 },
      { idx: 2, offset_ms: 600_000, duration_ms: 60_000 },
    ];
    expect(resumePoint(parts)).toEqual({ nextIdx: 3, offsetMs: 660_000 });
  });

  it("never reuses a gapped index — the worker's seq ranging would collide", () => {
    // parts.length here is 2, but idx 2 exists: length-based nextIdx would be 2 — a duplicate
    const parts = [
      { idx: 0, offset_ms: 0, duration_ms: 10_000 },
      { idx: 2, offset_ms: 20_000, duration_ms: 10_000 },
    ];
    expect(resumePoint(parts).nextIdx).toBe(3);
  });

  it("an unfinished call with no parts yet resumes from zero", () => {
    expect(resumePoint([])).toEqual({ nextIdx: 0, offsetMs: 0 });
  });

  it("a null duration counts as zero length, not as unknown-forever", () => {
    const parts = [{ idx: 0, offset_ms: 5_000, duration_ms: null }];
    expect(resumePoint(parts)).toEqual({ nextIdx: 1, offsetMs: 5_000 });
  });
});
