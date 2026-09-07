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
const { publishRoomAudio } = await import("./roomAudio");
type StartOptions = import("./recordingEngine").StartOptions;

/** a track whose cable the test can pull */
function fakeTrack(id = "mic") {
  const handlers = new Map<string, (() => void)[]>();
  return {
    id,
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
/** every track that reached the mix, in order — the online lane's subject */
const mixed: string[] = [];

class FakeAudioContext {
  sampleRate = 48_000;
  destination = {};
  createMediaStreamSource(stream: { getTracks?: () => Array<{ id?: string }> }) {
    for (const t of stream.getTracks?.() ?? []) mixed.push(t.id ?? "?");
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
  mixed.length = 0;
  publishRoomAudio([]);
  getUserMedia.mockReset();
  getUserMedia.mockImplementation(async () => fakeStream([fakeTrack()]));
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  /* jsdom has no MediaStream, and the engine wraps each room track in one to
     hand it to the mix — without this the online lane throws before it has
     connected anything, which reads as "the track never arrived" */
  vi.stubGlobal("MediaStream", class {
    #tracks: Array<{ id?: string }>;
    constructor(tracks: Array<{ id?: string }> = []) { this.#tracks = tracks; }
    getTracks() { return this.#tracks; }
    getAudioTracks() { return this.#tracks; }
  });
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


/**
 * THE ONLINE LANE CARRIES THE ROOM (user report, 2026-09-07: "his voice was
 * completely not added to the transcription, the voice didnt go through at
 * all").
 *
 * The lane recorded the microphone plus WHATEVER SURFACE was shared, so
 * whether the other half of a conversation reached the recording depended on
 * which tab the person picked in a browser dialog. Read against the database
 * afterwards: a two-person meeting came back with ONE speaker, and the voice
 * matcher scored it 0.45 against a 0.55 bar — a blend of two people is not
 * anybody's voice.
 *
 * A colleague in the platform's own room is a live track in this page. What
 * is asserted here is that those tracks reach the mix, and that the tab is
 * dropped exactly when it would be a second, worse copy of them.
 */
describe("the online take carries the room's own voices", () => {
  function shareStream(handle: string | null) {
    const video = {
      kind: "video", id: "share-video", readyState: "live",
      stop() { this.readyState = "ended"; },
      addEventListener() { /* the engine listens for `ended` on audio */ },
      getCaptureHandle: () => (handle === null ? null : { handle }),
    };
    const audio = fakeTrack("share-audio");
    return {
      getTracks: () => [video, audio],
      getVideoTracks: () => [video],
      getAudioTracks: () => [audio],
    };
  }

  function shareWith(handle: string | null) {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia, getDisplayMedia: async () => shareStream(handle) },
    });
  }

  it("a colleague's track reaches the recording, wherever the share came from", async () => {
    shareWith(null);
    publishRoomAudio([{ id: "sina", readyState: "live" } as unknown as MediaStreamTrack]);

    await startRecording(opts({ source: "system" }));

    expect(mixed, "the far end never reached the take").toContain("sina");
  });

  it("sharing OUR OWN meeting tab drops the tab audio — it would be a second copy", async () => {
    shareWith("neurai-meeting");
    publishRoomAudio([{ id: "sina", readyState: "live" } as unknown as MediaStreamTrack]);

    await startRecording(opts({ source: "system" }));

    expect(mixed).toContain("sina");
    /* two copies of one voice, a few milliseconds apart, sound like a bad
       room and split into two speakers */
    expect(mixed, "the room was recorded twice").not.toContain("share-audio");
  });

  it("…and any OTHER surface is still mixed — the control", async () => {
    /*
     * THE DISCRIMINATING HALF. A lane that simply stopped mixing the share
     * would pass the test above and would lose every meeting held in software
     * we do not host, which is the case this lane exists for.
     */
    shareWith(null);
    publishRoomAudio([{ id: "sina", readyState: "live" } as unknown as MediaStreamTrack]);

    await startRecording(opts({ source: "system" }));

    expect(mixed).toContain("share-audio");
    expect(mixed).toContain("sina");
  });

  it("somebody who joins LATE is on the recording too", async () => {
    shareWith(null);
    await startRecording(opts({ source: "system" }));
    expect(mixed).not.toContain("late");

    /* subscribed, not sampled: a room read once at the start records an
       outdated cast */
    publishRoomAudio([{ id: "late", readyState: "live" } as unknown as MediaStreamTrack]);
    expect(mixed).toContain("late");
  });
});
