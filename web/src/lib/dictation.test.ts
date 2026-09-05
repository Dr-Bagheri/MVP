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

  it("keeps saying LISTENING through the pause error Chrome sends", async () => {
    /*
     * The regression the restart introduced, reported 2026-09-04 as "the voice
     * hotkey does not work now".
     *
     * `no-speech` is what Chrome sends when somebody pauses — most of the
     * time. The handler reported `idle` for it and `onend` then reopened the
     * session, so the microphone was open while every caller believed it was
     * closed. Push-to-talk asks `status !== "listening"` before starting, so
     * the next press called toggle on a live recogniser and STOPPED it: the
     * hotkey did nothing, and kept doing nothing.
     *
     * The status is what callers steer by, so it has to be about the
     * microphone rather than about the last event.
     */
    install();
    const heard: string[] = [];
    const { result } = renderHook(() => useDictation("fa-IR", (t) => heard.push(t)));
    act(() => result.current.toggle());
    const rec = only();

    act(() => rec.onerror?.({ error: "no-speech" }));
    act(() => rec.endsByItself());

    expect(result.current.status, "it reported idle while the mic was open").toBe("listening");
    expect(rec.starts, "the session was not reopened").toBe(2);

    /* and it is really the same live session: what is said next still lands */
    act(() => rec.says("ادامهٔ جمله"));
    expect(heard).toEqual(["ادامهٔ جمله"]);

    /* the control — the press after the pause STOPS it, because it was
       listening all along and the caller can now see that */
    act(() => result.current.toggle());
    expect(result.current.status).toBe("idle");
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


describe("press and release (2026-09-05)", () => {
  it("stop follows the RECOGNISER, not the rendered status — a release inside the no-speech moment still stops", () => {
    /*
     * User: "make it push to talk, not push to activate — you need to hold it
     * while you are talking." The hotkey used to call `toggle` guarded by
     * `status`; Chrome's pause error sets `status` to idle for a moment while
     * the session is being reopened, and a release landing there saw "idle",
     * did nothing, and left the microphone open.
     */
    install();
    const { result } = renderHook(() => useDictation("fa-IR", () => undefined));
    act(() => result.current.start());
    act(() => result.current.start());
    expect(FakeRecognition.live.length, "a second press on a live recogniser made a second one").toBe(1);
    const rec = only();
    act(() => rec.onerror?.({ error: "no-speech" }));
    expect(result.current.status).toBe("idle");
    act(() => result.current.stop());
    expect(rec.stopped, "the release read 'idle' and left the microphone open").toBe(true);
  });
});
