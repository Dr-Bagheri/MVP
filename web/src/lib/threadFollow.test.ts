import { describe, expect, it } from "vitest";
import { shouldStick } from "./threadFollow";

/**
 * The auto-follow decision, held where it can actually be held: jsdom lays
 * nothing out, so the scrolling COMPONENT can only be smoke-checked — the
 * DECISION is the part a unit test can pin. The case that must answer NO is
 * the scrolled-up reader: following them down is the "fighting" half of the
 * follow-vs-fight rule, and it is the half with no visual symptom in a test
 * that only ever asserts the happy path.
 */
describe("shouldStick — the thread's follow decision", () => {
  it("sticks at the exact bottom", () => {
    expect(shouldStick({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });

  it("sticks within the streaming threshold — a delta just grew the thread under the reader", () => {
    // 1000 - 400 - 590 = 10px from the bottom: the reader WAS at the bottom
    // a delta ago. Exact equality here would unpin on the first delta and
    // the thread would follow nothing.
    expect(shouldStick({ scrollTop: 590, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });

  it("does NOT stick when the reader has scrolled up — following must not become fighting", () => {
    // 500px above the bottom: the person is re-reading something older.
    // Yanking them down on the next delta is the bug this helper exists to
    // make impossible — the one case that must answer NO.
    expect(shouldStick({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  it("sticks when there is nowhere to scroll — content shorter than the box", () => {
    expect(shouldStick({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toBe(true);
  });

  it("honours a caller-supplied threshold", () => {
    // the same 10px-from-bottom reading, judged against a tighter bar
    expect(shouldStick({ scrollTop: 590, scrollHeight: 1000, clientHeight: 400 }, 5)).toBe(false);
  });
});
