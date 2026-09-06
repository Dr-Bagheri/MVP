import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REOPEN_DELAY_MS, useDictation } from "./dictation";

/**
 * THE MICROPHONE STAYS OPEN WHILE SOMEBODY IS STILL TALKING, AND KEEPS EVERY
 * WORD IT HEARD.
 *
 * User reports: 2026-09-04 "it will be cut mid command"; 2026-09-06 "after a
 * couple of seconds it does not hear me any more, and it gave me less than
 * half the sentences I talked."
 *
 * The browser's recogniser ENDS THE SESSION on its own — on a pause, on a
 * network hiccup — whatever `continuous` says, and whatever it had heard but
 * not yet finalised goes with it unless somebody catches it.
 *
 * The fake below is the load-bearing part: it ends the session by itself the
 * way Chrome does, it sends INTERIM words before finals the way Chrome does,
 * and its `abort()` raises `aborted` before `end` the way Chrome does. A fake
 * that only ended when told to, or only ever spoke in finals, would agree
 * with the belief the old code was written on and could not have shown any
 * of this.
 */
class FakeRecognition {
  static live: FakeRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stopped = false;
  aborted = false;
  /** what Chrome sends when `stop()` catches a phrase still in flight */
  finalOnStop: string | null = null;

  constructor() {
    FakeRecognition.live.push(this);
  }
  start(): void { this.starts += 1; }
  stop(): void {
    this.stopped = true;
    if (this.finalOnStop !== null) this.says(this.finalOnStop);
    this.onend?.();
  }
  abort(): void {
    this.aborted = true;
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
  /** what the browser does by itself after a pause or a network hiccup */
  endsByItself(): void { this.onend?.(); }
  /** a finalised phrase */
  says(text: string): void {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }
  /** the phrase so far, not yet final — Chrome resends the whole of it each time */
  hears(text: string): void {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: text } }] });
  }
}

function install() {
  FakeRecognition.live = [];
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
}
/** sessions opened so far, across every object the hook made */
const opened = (): number => FakeRecognition.live.reduce((n, r) => n + r.starts, 0);
const latest = (): FakeRecognition => FakeRecognition.live[FakeRecognition.live.length - 1]!;
const reopen = () => act(() => { vi.advanceTimersByTime(REOPEN_DELAY_MS + 1); });

beforeEach(() => { vi.useFakeTimers(); install(); });
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
});

describe("dictation across a pause", () => {
  it("reopens a FRESH session when the browser ends one on its own", () => {
    const heard: string[] = [];
    const { result } = renderHook(() => useDictation("fa-IR", (t) => heard.push(t)));

    act(() => result.current.toggle());
    expect(result.current.status).toBe("listening");
    expect(opened()).toBe(1);
    expect(latest().interimResults, "interim words are the ones a dying session would lose").toBe(true);

    act(() => latest().says("سلام"));
    /* the pause in the middle of the sentence — the reported bug */
    act(() => latest().endsByItself());
    expect(result.current.status, "the mic closed while the person was mid-sentence").toBe("listening");
    reopen();
    expect(opened(), "the session was not reopened").toBe(2);
    expect(FakeRecognition.live.length, "the object that just died was restarted instead of replaced").toBe(2);

    act(() => latest().says("جلسه را بگذار"));
    expect(heard).toEqual(["سلام", "جلسه را بگذار"]);
  });

  it("the words a dying session had heard but not finalised land in the box — the half sentences", () => {
    const heard: string[] = [];
    const { result } = renderHook(() => useDictation("fa-IR", (t) => heard.push(t)));
    act(() => result.current.toggle());
    act(() => latest().hears("جمع‌آوری صدای"));
    act(() => latest().endsByItself());
    expect(heard, "the interim words died with the session").toEqual(["جمع‌آوری صدای"]);

    /* and NOT twice: a phrase that became final is delivered as the final
       alone, the interim it replaced is forgotten */
    reopen();
    act(() => latest().hears("سلام"));
    act(() => latest().says("سلام دنیا"));
    act(() => latest().endsByItself());
    expect(heard).toEqual(["جمع‌آوری صدای", "سلام دنیا"]);
  });

  it("keeps saying LISTENING through the pause error Chrome sends", () => {
    /*
     * `no-speech` is what Chrome sends when somebody pauses — most of the
     * time. The status is what callers steer by, so it has to be about the
     * microphone rather than about the last event.
     */
    const heard: string[] = [];
    const { result } = renderHook(() => useDictation("fa-IR", (t) => heard.push(t)));
    act(() => result.current.toggle());
    act(() => latest().onerror?.({ error: "no-speech" }));
    expect(result.current.status, "a transient error reported idle").toBe("listening");
    act(() => latest().endsByItself());
    expect(result.current.status).toBe("listening");
    reopen();
    expect(opened()).toBe(2);
    act(() => latest().says("ادامهٔ جمله"));
    expect(heard).toEqual(["ادامهٔ جمله"]);

    /* the control — the press after the pause STOPS it, because it was
       listening all along and the caller can see that */
    act(() => result.current.toggle());
    expect(result.current.status).toBe("idle");
    reopen();
    expect(opened(), "it reopened after the person stopped it").toBe(2);
  });

  it("stops for good when the person stops it", () => {
    /* the control. Without it, "always reopen" passes the tests above and
       makes the mic impossible to turn off — a worse bug than the one fixed. */
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    expect(result.current.status).toBe("idle");
    expect(latest().stopped).toBe(true);
    reopen();
    expect(opened(), "the mic reopened after the person closed it").toBe(1);
  });

  it("a release inside the reopen gap still stops, and nothing reopens", () => {
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.start());
    act(() => latest().endsByItself());
    /* the gap: no session, the wish still standing */
    act(() => result.current.stop());
    expect(result.current.status).toBe("idle");
    reopen();
    expect(opened(), "the reopen fired under a finger that had let go").toBe(1);
  });

  it("does not reopen a microphone that was refused", () => {
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    act(() => latest().onerror?.({ error: "not-allowed" }));
    act(() => latest().endsByItself());
    expect(result.current.status, "a refusal must survive the end event").toBe("denied");
    reopen();
    expect(opened(), "it asked for a refused microphone again").toBe(1);
  });

  it("does not reopen after `aborted` — that end is not a pause", () => {
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    act(() => latest().onerror?.({ error: "aborted" }));
    act(() => latest().endsByItself());
    reopen();
    expect(opened()).toBe(1);
  });

  it("does not reopen while the component is going away, and drops what was pending", () => {
    /* unmount aborts, abort fires `aborted` then `end` — a teardown that
       reopened the microphone on its way out is the worst possible restart,
       and the box the pending words were for is gone */
    const heard: string[] = [];
    const { result, unmount } = renderHook(() => useDictation("fa-IR", (t) => heard.push(t)));
    act(() => result.current.toggle());
    act(() => latest().hears("نیمه"));
    unmount();
    reopen();
    expect(opened()).toBe(1);
    expect(heard).toEqual([]);
  });
});

describe("press and release (2026-09-05)", () => {
  it("a second press on a live session opens nothing; the release stops the session that is running", () => {
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.start());
    act(() => result.current.start());
    expect(opened(), "a second press on a live recogniser made a second one").toBe(1);
    /* inside Chrome's pause moment the status used to read idle and a release
       did nothing; the status is about the wish now and the release stops */
    act(() => latest().onerror?.({ error: "no-speech" }));
    expect(result.current.status).toBe("listening");
    act(() => result.current.stop());
    expect(latest().stopped, "the release left the microphone open").toBe(true);
    expect(result.current.status).toBe("idle");
  });

  it("the release lets the last phrase finalise, and it lands exactly once", () => {
    const heard: string[] = [];
    const { result } = renderHook(() => useDictation("fa-IR", (t) => heard.push(t)));
    act(() => result.current.start());
    act(() => latest().hears("سلام"));
    latest().finalOnStop = "سلام دنیا";
    act(() => result.current.stop());
    expect(heard).toEqual(["سلام دنیا"]);
  });
});

describe("a fast re-press (2026-09-06)", () => {
  it("does not open a second recogniser while the first is still winding down — that session's end reopens", () => {
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    expect(opened()).toBe(1);
    const first = latest();
    /* release: stop() is asked, but Chrome has not fired `end` yet */
    first.onend = null; // hold the end back, as Chrome does for up to ~800 ms
    act(() => result.current.toggle());
    expect(first.stopped).toBe(true);
    /* press again inside that gap */
    act(() => result.current.toggle());
    /* the old code opened a second recogniser here; Chrome then aborted the
       first, whose `aborted` switched the wish off under the new one */
    expect(opened(), "no second session while the first is alive").toBe(1);
    expect(result.current.status).toBe("listening");
  });

  it("THE CONTROL: after the wound-down session actually ends, the wish reopens a fresh one", () => {
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    const first = latest();
    const held = first.onend;
    first.onend = null;
    act(() => result.current.toggle());   // release
    act(() => result.current.toggle());   // re-press inside the gap
    first.onend = held;
    act(() => first.onend?.());           // Chrome's late `end`
    reopen();
    expect(opened()).toBe(2);
    expect(result.current.status).toBe("listening");
  });

  it("five transient errors in a row stop the wish — a mic nothing can hear stops pulsing", () => {
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    for (let i = 0; i < 5; i += 1) {
      const live = latest();
      act(() => { live.onerror?.({ error: "network" }); live.endsByItself(); });
      reopen();
    }
    expect(result.current.status).toBe("idle");
  });
});
