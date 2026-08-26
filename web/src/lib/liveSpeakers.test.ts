import { describe, expect, it } from "vitest";
import { establishedSpeakers } from "./liveSpeakers";
import type { CaptionRow } from "./captionRows";

const row = (speaker: string | undefined, text: string, atMs = 0): CaptionRow =>
  speaker === undefined ? { atMs, text } : { atMs, text, speaker };

/**
 * The reported case is the first test: one person, one stray "Uh." at the
 * top, and a screen that announced two participants. The rule has to kill
 * that WITHOUT killing a real second speaker who happens to start short —
 * hence the promotion test, which is the discriminating half.
 */
describe("establishedSpeakers", () => {
  it("a single throat-clear is not a participant", () => {
    const rows = [
      row("1", "Uh."),
      row("2", "هنوز توی تست صداییم، برای اینکه ببینیم که ما رو تشخیص می‌دهد یا نه."),
      row("2", "تعداد نفرات رو تشخیص می‌دهد؟"),
    ];
    expect(establishedSpeakers(["1", "2"], rows)).toEqual(["2"]);
  });

  it("but a short opener is promoted once that voice speaks again", () => {
    // the control: if the rule simply dropped short labels, a real second
    // speaker who starts with "بله" would never appear at all
    const rows = [
      row("1", "بله"),
      row("2", "خب بریم سراغ بودجه سال آینده و بعد گزارش تیم."),
      row("1", "موافقم"),
    ];
    expect(establishedSpeakers(["1", "2"], rows)).toEqual(["1", "2"]);
  });

  it("one long turn is enough on its own", () => {
    const rows = [row("1", "این یک جملهٔ کامل و به‌اندازهٔ کافی بلند است.")];
    expect(establishedSpeakers(["1"], rows)).toEqual(["1"]);
  });

  it("keeps the engine's first-heard order", () => {
    const rows = [row("2", "aaaaaaaaaaaaaaaaaaaaaaaa"), row("1", "bbbbbbbbbbbbbbbbbbbbbbbb")];
    expect(establishedSpeakers(["2", "1"], rows)).toEqual(["2", "1"]);
  });

  it("counts a label the engine list has not caught up with", () => {
    // the engine and the rows are two views of one stream; if they
    // disagree for a frame, a voice with evidence must not vanish
    const rows = [row("7", "cccccccccccccccccccccccc")];
    expect(establishedSpeakers([], rows)).toEqual(["7"]);
  });

  it("an undiarized take has no voices to show", () => {
    expect(establishedSpeakers([], [row(undefined, "سلام")])).toEqual([]);
  });
});
