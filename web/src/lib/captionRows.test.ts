import { describe, expect, it } from "vitest";
import { appendCaptionRow, type CaptionRow } from "./captionRows";

/**
 * The transcript-tab row rule. The stamp assertions are the point: a row's
 * time must be when it OPENED, not when its latest fragment arrived —
 * otherwise every row drifts toward the end of its own sentence.
 */
describe("appendCaptionRow", () => {
  it("a fragment joins the open row, keeping the OPENING stamp", () => {
    let rows: CaptionRow[] = [];
    rows = appendCaptionRow(rows, "خب، امروز دربارهٔ بودجه ", 3_000);
    rows = appendCaptionRow(rows, "صحبت می‌کنیم", 6_500);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("خب، امروز دربارهٔ بودجه صحبت می‌کنیم");
    expect(rows[0]!.atMs).toBe(3_000);
  });

  it("a finished sentence closes its row — the next fragment opens a new one", () => {
    let rows: CaptionRow[] = [];
    rows = appendCaptionRow(rows, "جلسه شروع شد.", 1_000);
    rows = appendCaptionRow(rows, "مورد اول بودجه است", 4_000);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.atMs).toBe(4_000);
  });

  it("Persian sentence enders count as enders", () => {
    let rows: CaptionRow[] = [];
    rows = appendCaptionRow(rows, "شروع کنیم؟", 1_000);
    rows = appendCaptionRow(rows, "بله", 2_000);
    expect(rows).toHaveLength(2);
  });

  it("a breath-length row breaks even without punctuation", () => {
    let rows: CaptionRow[] = [];
    rows = appendCaptionRow(rows, "کلمه ".repeat(40), 1_000); // > 160 chars
    rows = appendCaptionRow(rows, "ادامه", 9_000);
    expect(rows).toHaveLength(2);
  });

  it("never mutates its input", () => {
    const first = appendCaptionRow([], "سلام ", 0);
    const before = JSON.stringify(first);
    appendCaptionRow(first, "دوباره", 500);
    expect(JSON.stringify(first)).toBe(before);
  });
});
