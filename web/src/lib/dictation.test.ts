import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDictation } from "./dictation";

/**
 * THE MICROPHONE STAYS OPEN WHILE SOMEBODY IS STILL TALKING.
 *
 * User report, 2026-09-04: "when I am doing a voice command it will be cut
 * mid command — it seems it has a limit for writing down a paragraph and did
 * not get the full command."
 *
 * There is no length limit. The browser's recogniser ENDS THE SESSION after a
 * few seconds of quiet, whatever `continuous` says — `continuous` keeps a
 * session alive across pauses inside a phrase, and the engine still closes it.
 * `onend` went straight to idle, so thinking for a breath in the middle of a
 * sentence stopped the dictation, and the half already transcribed sat in the
 * box looking like the whole of it.
 *
 * The fake below is the load-bearing part: it ends the session on its own, the
 * way Chrome does. A fake that only ended when told to could not have shown
 * this, because it would have agreed with the belief the code was written on.
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

  constructor() {
    FakeRecognition.live.push(this);
  }
  start(): void { this.starts += 1; }
  stop(): void { this.stopped = true; this.onend?.(); }
  abort(): void { this.aborted = true; this.onend?.(); }
  /** what the browser does by itself after a pause */
  endsByItself(): void { this.onend?.(); }
  says(text: string): void {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }
}

function install() {
  FakeRecognition.live = [];
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
}
const only = (): FakeRecognition => {
  expect(FakeRecognition.live.length, "exactly one recogniser was made").toBe(1);
  return FakeRecognition.live[0]!;
};

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
});

describe("dictation across a pause", () => {
  it("reopens when the browser ends the session on its own", () => {
    install();
    const heard: string[] = [];
    const { result } = renderHook(() => useDictation("fa-IR", (t) => heard.push(t)));

    act(() => result.current.toggle());
    expect(result.current.status).toBe("listening");
    const rec = only();
    expect(rec.starts).toBe(1);

    act(() => rec.says("سلام"));
    /* the pause in the middle of the sentence — the reported bug */
    act(() => rec.endsByItself());
    expect(result.current.status, "the mic closed while the person was mid-sentence").toBe("listening");
    expect(rec.starts, "the session was not reopened").toBe(2);

    act(() => rec.says("جلسه را بگذار"));
    expect(heard).toEqual(["سلام", "جلسه را بگذار"]);
  });

  it("stops for good when the person stops it", () => {
    /* the control. Without it, "always restart" passes the test above and
       makes the mic impossible to turn off — a worse bug than the one fixed. */
    install();
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    const rec = only();
    act(() => result.current.toggle());
    expect(result.current.status).toBe("idle");
    expect(rec.starts, "the mic reopened after the person closed it").toBe(1);
  });

  it("does not reopen a microphone that was refused", () => {
    install();
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    const rec = only();
    act(() => rec.onerror?.({ error: "not-allowed" }));
    act(() => rec.endsByItself());
    expect(result.current.status, "a refusal must survive the end event").toBe("denied");
    expect(rec.starts, "it asked for a refused microphone again").toBe(1);
  });

  it("does not reopen after a transient error either — that end is not a pause", () => {
    install();
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    const rec = only();
    act(() => rec.onerror?.({ error: "aborted" }));
    act(() => rec.endsByItself());
    expect(rec.starts).toBe(1);
  });

  it("does not reopen while the component is going away", () => {
    /* unmount aborts, abort fires onend — a teardown that reopened the
       microphone on its way out is the worst possible restart */
    install();
    const { result, unmount } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.toggle());
    const rec = only();
    unmount();
    expect(rec.starts).toBe(1);
  });
});
