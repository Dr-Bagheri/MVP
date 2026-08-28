// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NOISE SUPPRESSION (user directive, 2026-08-28: «حذف نویز» in the mic
 * panel). The choice is a CONSTRAINT handed to getUserMedia at acquisition —
 * nothing rendered afterwards can prove which way it went, so the wire to
 * the browser is the only honest thing to assert (rule 12: prefer the
 * measurement that fails when the user would fail).
 *
 * Two claims, each with its own test:
 *  1. the take's choice reaches the FIRST acquisition (off means off, on
 *     means on — the pair is what discriminates; a fake that ignores the
 *     option entirely fails one of the two);
 *  2. the REACQUIRE path (mic unplugged mid-take → resume) reuses the
 *     take's own setting — a mic that comes back with different processing
 *     than it left with is a silent quality change inside one recording.
 *     This test stays red against a reacquire that hard-codes the default
 *     while test 1 stays green: it distinguishes the path, not the option.
 */

const getUserMedia = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    // the caption lane refusing to start is the SHORTEST honest path
    // through startRecording — its absence is handled, not fatal
    liveSttStart: vi.fn(async () => {
      throw new Error("no caption lane in this test");
    }),
    deleteCall: vi.fn(async () => undefined),
  },
}));

// takeBuffer talks to IndexedDB, which jsdom does not have
vi.mock("@/lib/takeBuffer", () => ({
  bufferChunk: vi.fn(),
  clearPart: vi.fn(),
  clearTake: vi.fn(),
  markPart: vi.fn(),
}));

const { startRecording, resume, discardRecording } = await import("./recordingEngine");
type StartOptions = import("./recordingEngine").StartOptions;

/** a track whose cable the test can pull */
function fakeTrack() {
  const handlers = new Map<string, (() => void)[]>();
  return {
    kind: "audio",
    readyState: "live" as "live" | "ended",
    stop() {
      this.readyState = "ended";
    },
    addEventListener(type: string, fn: () => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    removeEventListener() {
      /* the engine never detaches; nothing to do */
    },
    /** unplug: readyState flips BEFORE the event, as the browser does it */
    end() {
      this.readyState = "ended";
      for (const fn of handlers.get("ended") ?? []) fn();
    },
  };
}
type FakeTrack = ReturnType<typeof fakeTrack>;

function fakeStream(tracks: FakeTrack[]) {
  const list = [...tracks];
  return {
    getTracks: () => [...list],
    getAudioTracks: () => [...list],
    addTrack: (t: FakeTrack) => {
      list.push(t);
    },
    removeTrack: (t: FakeTrack) => {
      const i = list.indexOf(t);
      if (i >= 0) list.splice(i, 1);
    },
  };
}

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    // synchronous onstop keeps discardRecording's flush barrier honest
    this.onstop?.();
  }
}

/** connect() returns its argument so `proc.connect(mute).connect(dest)` chains */
class FakeAudioContext {
  sampleRate = 48_000;
  destination = {};
  createMediaStreamSource() {
    return { connect: <T>(x: T) => x };
  }
  createAnalyser() {
    return { fftSize: 1024, getByteTimeDomainData: () => undefined };
  }
  createScriptProcessor() {
    return { connect: <T>(x: T) => x, disconnect: () => undefined, onaudioprocess: null };
  }
  createGain() {
    return { gain: { value: 0 }, connect: <T>(x: T) => x };
  }
  createMediaStreamDestination() {
    return { stream: fakeStream([]) };
  }
  close() {
    return Promise.resolve();
  }
}

/** resume-shaped on purpose: no createCall/listCalls, the shortest real path */
function opts(over: Partial<StartOptions>): StartOptions {
  return {
    micId: "",
    language: "fa",
    source: "mic",
    title: "",
    locale: "fa",
    resume: { callId: "c-1", title: "آزمون", nextIdx: 1, offsetMs: 5000 },
    noiseSuppression: true,
    ...over,
  };
}

function audioConstraintsOfCall(n: number): Record<string, unknown> {
  const arg = getUserMedia.mock.calls[n]?.[0] as
    | { audio: Record<string, unknown> }
    | undefined;
  expect(arg, `getUserMedia call #${n} was never made`).toBeDefined();
  return arg!.audio;
}

beforeEach(() => {
  getUserMedia.mockReset();
  getUserMedia.mockImplementation(async () => fakeStream([fakeTrack()]));
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  // never let the meter loop: one frame is scheduled, none run
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(async () => {
  // the engine is MODULE state — tear the take down so the next test starts idle
  await discardRecording();
  vi.unstubAllGlobals();
});

describe("the take's noise-suppression choice reaches the browser", () => {
  it("off means off: getUserMedia receives noiseSuppression:false", async () => {
    await startRecording(opts({ noiseSuppression: false }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const audio = audioConstraintsOfCall(0);
    expect(audio.noiseSuppression).toBe(false);
    // the sibling constraint is untouched — this option turns exactly one knob
    expect(audio.echoCancellation).toBe(true);
  });

  it("on means on: the default path still asks for suppression", async () => {
    await startRecording(opts({ noiseSuppression: true }));
    expect(audioConstraintsOfCall(0).noiseSuppression).toBe(true);
  });

  it("reacquire after mic loss reuses the take's own setting, not a fresh default", async () => {
    const first = fakeTrack();
    getUserMedia.mockImplementationOnce(async () => fakeStream([first]));
    await startRecording(opts({ noiseSuppression: false }));

    // unplug: the engine auto-pauses and marks the mic lost
    first.end();
    // resume must reacquire BEFORE the take rolls again
    resume();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));

    expect(audioConstraintsOfCall(1).noiseSuppression).toBe(false);
  });
});
