/**
 * Scripted voice enrollment (user directive, 2026-08-23): the panel shows
 * the PLATFORM's passage, offers both languages, and gates Finish on the
 * minimum. The passage assertions quote the real scripts from
 * enrollmentScript.ts (the producer), not hand-written stand-ins — and the
 * cancel test is the negative control: a discarded take must never reach
 * the api.
 */
import { fireEvent, render, screen, act } from "@testing-library/react";
import { openRowMenu } from "@/test/rowMenu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enrollVoice = vi.fn(async (_id: string, _clip: Blob) => undefined);
const directory = vi.fn(async () => [
  { id: "p-1", display_name: "سینا", title: "", voice_enrolled_at: null },
]);
vi.mock("@/api/client", () => ({
  api: {
    directory: () => directory(),
    me: async () => ({ role: "owner" }),
    enrollVoice: (id: string, clip: Blob) => enrollVoice(id, clip),
    /* the members read (2026-09-08, the account column): this suite is about
       enrollment, but a mock that omits a method the component calls does not
       fake "no colleagues" — it throws, and the failure arrives as whatever
       rendered last. It answers with the empty case on purpose.
       (`listCalls`/`getSpeakers` left with the presence bar and the cards
       view they fed — a stub for a call nobody makes is scaffolding.) */
    members: async () => [],
  },
}));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/lib/refreshBus", () => ({ useRefreshEpoch: () => 0 }));
vi.mock("next-intl", () => ({
  useLocale: () => "fa",
  useTranslations: () => (key: string) => key,
}));

import { SpeakersDirectory } from "./SpeakersDirectory";
import { ENROLLMENT_SCRIPTS, MIN_ENROLL_SECONDS } from "@/lib/enrollmentScript";

/**
 * THE MICROPHONE, FAKED AT THE ANALYSER (user report, 2026-09-07: "the
 * enrolment voice detection part of the platform does not work — i did 2
 * samples in it and never it realise i am talking to it").
 *
 * jsdom has no WebAudio, and `startMicMeter` treats its absence as "cannot
 * measure" rather than "heard nothing" — deliberately, so the refusal never
 * fires on a browser that simply has no analyser. That is also why the
 * silent case is UNREACHABLE without this: the fake is what makes the two
 * outcomes representable at all.
 */
let LEVEL = 24; // offset from the centre line; 0 is digital silence
class FakeAnalyser {
  fftSize = 1024;
  getByteTimeDomainData(data: Uint8Array) { data.fill(128 + LEVEL); }
}
class FakeAudioContext {
  createMediaStreamSource() { return { connect: () => undefined, disconnect: () => undefined }; }
  createAnalyser() { return new FakeAnalyser(); }
  close() { return Promise.resolve(); }
}

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["aa"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  LEVEL = 24;
  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
  (window as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
  /* the meter runs on frames; under fake timers the clock is the test's, so
     the frames are too */
  (globalThis as Record<string, unknown>).requestAnimationFrame =
    (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  (globalThis as Record<string, unknown>).cancelAnimationFrame =
    (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  enrollVoice.mockClear();
  FakeRecorder.last = null;
  (globalThis as Record<string, unknown>).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: () => undefined }],
      })),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function openPanel() {
  render(<SpeakersDirectory />);
  await act(async () => {
    await Promise.resolve();
  });
  /* the voice actions live in the ROW MENU: open it at the row's ⋯ and pick
     Enroll. Going through the real control is the point — a test that reached
     past it would keep passing after the only way in disappeared. */
  await openRowMenu("سینا");
  fireEvent.click(screen.getByText("voiceEnroll"));
  return screen.getByText("voiceStart");
}

describe("scripted voice enrollment", () => {
  it("opens with the UI locale's script and offers BOTH languages", async () => {
    await openPanel();
    // fa locale → the Persian passage, quoted from the producer
    expect(screen.getByText(ENROLLMENT_SCRIPTS.fa)).toBeInTheDocument();
    expect(screen.getByText("فارسی")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("the small toggle swaps the passage — one language is enough to save", async () => {
    await openPanel();
    fireEvent.click(screen.getByText("English"));
    expect(screen.getByText(ENROLLMENT_SCRIPTS.en)).toBeInTheDocument();
    expect(screen.queryByText(ENROLLMENT_SCRIPTS.fa)).toBeNull();
    // the passage direction follows ITS language, not the UI locale
    expect(screen.getByText(ENROLLMENT_SCRIPTS.en).getAttribute("dir")).toBe("ltr");
  });

  it("Finish stays disabled until the minimum, then saves the take", async () => {
    const start = await openPanel();
    await act(async () => {
      fireEvent.click(start);
      await Promise.resolve();
    });
    const finish = () => screen.getByText("voiceFinish") as HTMLButtonElement;
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(finish().disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime((MIN_ENROLL_SECONDS - 3) * 1000);
    });
    expect(finish().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(finish());
      await Promise.resolve();
    });
    expect(enrollVoice).toHaveBeenCalledWith("p-1", expect.any(Blob));
  });

  /*
   * A TAKE NOTHING WAS HEARD IN IS NOT SENT, and the pair is the point: a
   * panel that never sent anything would satisfy the first of these on its
   * own. Before 2026-09-07 the silent take was uploaded, embedded into a
   * near-constant "silence" vector and stored as that person's signature,
   * with nothing on screen at any point saying the microphone was dead.
   */
  it("a silent take is refused where the person is standing, not a round trip later", async () => {
    LEVEL = 0; // the microphone is delivering nothing
    const start = await openPanel();
    await act(async () => {
      fireEvent.click(start);
      await Promise.resolve();
    });
    act(() => { vi.advanceTimersByTime(12_000); });

    await act(async () => {
      fireEvent.click(screen.getByText("voiceFinish"));
      await Promise.resolve();
    });

    expect(enrollVoice, "a clip with no voice in it became a voiceprint").not.toHaveBeenCalled();
    /* and the panel stays open at the start, because the answer is "read it
       again", not "we are done" */
    expect(screen.getByText("voiceStart")).toBeInTheDocument();
  });

  it("…and a take it DID hear is sent — the control", async () => {
    LEVEL = 24;
    const start = await openPanel();
    await act(async () => {
      fireEvent.click(start);
      await Promise.resolve();
    });
    act(() => { vi.advanceTimersByTime(12_000); });

    await act(async () => {
      fireEvent.click(screen.getByText("voiceFinish"));
      await Promise.resolve();
    });

    expect(enrollVoice).toHaveBeenCalledWith("p-1", expect.any(Blob));
  });

  it("cancel DISCARDS — the take never reaches the api", async () => {
    const start = await openPanel();
    await act(async () => {
      fireEvent.click(start);
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByText("voiceCancel"));
      await Promise.resolve();
    });
    expect(enrollVoice).not.toHaveBeenCalled();
    expect(screen.queryByText("voiceFinish")).toBeNull();
    // the mic is released too — the recorder was stopped
    expect(FakeRecorder.last?.state).toBe("inactive");
  });
});
