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

  it("a SPEAKER CHANGE opens a row, mid-sentence and all", () => {
    // the rule that outranks every other: the fragment continues a
    // sentence and is far under the length cap, and it still must not
    // join — two people inside one stamped row is the one mistake a
    // transcript cannot make
    let rows: CaptionRow[] = [];
    rows = appendCaptionRow(rows, "من فکر می‌کنم بودجه ", 1_000, "1");
    rows = appendCaptionRow(rows, "نه، من مخالفم", 4_000, "2");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.speaker).toBe("1");
    expect(rows[1]!.speaker).toBe("2");
    expect(rows[1]!.atMs).toBe(4_000);
  });

  it("the SAME speaker still joins the open row", () => {
    // the discriminating half: if the speaker were compared wrongly (say
    // by identity of a fresh object) every fragment would open a row and
    // the transcript would become one line per token
    let rows: CaptionRow[] = [];
    rows = appendCaptionRow(rows, "بخش اول ", 1_000, "1");
    rows = appendCaptionRow(rows, "و بخش دوم", 2_000, "1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("بخش اول و بخش دوم");
  });

  it("an undiarized lane keeps rows with NO speaker field", () => {
    // absent must stay absent all the way to the row: a defaulted label
    // would let the UI render a speaker badge nobody detected
    const rows = appendCaptionRow([], "سلام", 0);
    expect(rows[0]!).not.toHaveProperty("speaker");
  });

  it("never mutates its input", () => {
    const first = appendCaptionRow([], "سلام ", 0);
    const before = JSON.stringify(first);
    appendCaptionRow(first, "دوباره", 500);
    expect(JSON.stringify(first)).toBe(before);
  });
});
