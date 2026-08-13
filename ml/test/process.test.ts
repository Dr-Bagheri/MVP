// The contract itself, exercised through the real HTTP surface with real
// ffmpeg and a stubbed STT lane. What is asserted here is what core/worker is
// entitled to rely on.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { resetConfig } from "../src/config.js";
import { resetLanes, setLanes } from "../src/stt/registry.js";
import { resetVadEngine } from "../src/vad/index.js";
import { resetDiarizer } from "../src/diarize/index.js";
import { buildServer } from "../src/server.js";
import { HealthSchema, ProcessResponseSchema } from "../src/schema.js";
import type { SttInput, SttLane, SttResult, TimestampGranularity } from "../src/stt/types.js";
import { concat, convert, fixtureDir, ffmpegPresent, interleave, silence, tone, writeWav } from "./helpers.js";

const have = await ffmpegPresent();
const suite = have ? describe : describe.skip;

/**
 * A lane that transcribes nothing but behaves exactly like one that does:
 * four evenly spaced words across whatever audio it is handed, timed on THAT
 * file's timeline — which is precisely the timeline the pipeline has to undo.
 */
class StubLane implements SttLane {
  readonly name = "stub";
  lastInput: SttInput | undefined;

  constructor(
    private readonly timestamps: TimestampGranularity = "word",
    private readonly diarized = false,
  ) {}

  configured(): boolean {
    return true;
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    this.lastInput = input;
    const texts = ["سلام", "حال", "شما", "چطور"];
    const step = Math.max(1, Math.floor(input.durationMs / texts.length));

    return {
      words: texts.map((text, i) => ({
        text,
        start_ms: i * step,
        end_ms: i * step + Math.floor(step / 2),
        confidence: 0.9,
        speaker: this.diarized ? `S${(i % 2) + 1}` : null,
        language: "fa",
      })),
      timestamps: this.timestamps,
      model: "stub-model",
      language: "fa",
      diarized: this.diarized,
    };
  }
}

let dir: string;
let monoWav: string;
let stereoWav: string;
let monoMp3: string;

beforeAll(async () => {
  if (!have) return;
  dir = await fixtureDir();
  monoWav = await writeWav(
    path.join(dir, "mono.wav"),
    concat(tone(220, 2000), silence(6000), tone(330, 2000)),
    1,
  );
  stereoWav = await writeWav(
    path.join(dir, "stereo.wav"),
    interleave(concat(tone(220, 2000), silence(2000)), concat(silence(2000), tone(660, 2000))),
    2,
  );
  monoMp3 = await convert(monoWav, path.join(dir, "mono.mp3"), ["-b:a", "128k"]);
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  for (const k of ["ML_ALLOW_LOCAL_PATHS", "ML_LANE_ORDER", "ML_REQUIRE_WORD_TIMESTAMPS", "ML_URL_ALLOWLIST"]) {
    delete process.env[k];
  }
  resetConfig();
  resetLanes();
  resetVadEngine();
  resetDiarizer();
});

function configure(lane: SttLane | null, env: Record<string, string> = {}) {
  process.env.ML_ALLOW_LOCAL_PATHS = "1";
  process.env.ML_LANE_ORDER = "stub";
  Object.assign(process.env, env);
  resetConfig();
  setLanes(lane ? new Map([["stub", lane]]) : new Map());
}

async function post(body: unknown) {
  const app = await buildServer();
  try {
    return await app.inject({ method: "POST", url: "/process", payload: body as object });
  } finally {
    await app.close();
  }
}

suite("GET /health", () => {
  it("answers with the declared shape and no secrets", async () => {
    configure(new StubLane());
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = HealthSchema.parse(res.json());
      expect(body.ffmpeg).toBe(true);
      expect(body.lanes["stub"]).toBe("configured");
      expect(res.body).not.toMatch(/[A-Za-z0-9_-]{32,}/); // nothing key-shaped
    } finally {
      await app.close();
    }
  });

  it("NAMES the vad engine, and says so when the fallback is what is running", async () => {
    // `vad` was a boolean meaning "vadEngine() resolved" — and it always
    // resolves, because the energy gate is an unconditional fallback. The
    // field could not be false under any deployment, so a box with no Silero
    // model reported a healthy VAD while every job ran the degraded gate.
    // A field that can only take one value is not a check.
    //
    // This test runs with ML_SILERO_MODEL unset, which is exactly that box.
    configure(new StubLane());
    const app = await buildServer();
    try {
      const body = HealthSchema.parse((await app.inject({ method: "GET", url: "/health" })).json());
      expect(body.vad).toBe("energy-rms");
      expect(body.vad_degraded).toBe(true);
    } finally {
      await app.close();
    }
  });
});

suite("POST /process — mono", () => {
  it("returns a body that satisfies the contract schema exactly", async () => {
    configure(new StubLane());
    const res = await post({ audio_path: monoWav, job_ref: "job-1" });

    expect(res.statusCode).toBe(200);
    const body = ProcessResponseSchema.parse(res.json()); // .strict() — extra keys fail
    expect(body.job_ref).toBe("job-1");
    expect(body.words.length).toBeGreaterThan(0);
    expect(body.media.channels).toBe(1);
    expect(body.degraded).toBe(false);
  });

  it("puts every timestamp back on the ORIGINAL timeline", async () => {
    configure(new StubLane());
    const body = ProcessResponseSchema.parse((await post({ audio_path: monoWav })).json());

    // 10s file: speech at 0–2s and 8–10s, six seconds of silence between.
    expect(body.speech.silence_trimmed_ms).toBeGreaterThan(3000);

    // The trimmed file is ~4s long, so a raw (unmapped) timestamp could never
    // exceed 4000. Some word must land in the second speech region.
    const last = body.words[body.words.length - 1]!;
    expect(last.start_ms).toBeGreaterThan(4000);

    // And no word may sit inside silence we removed.
    for (const w of body.words) {
      const inside = body.speech.segments.some((s) => w.start_ms >= s.start_ms - 1 && w.start_ms <= s.end_ms + 1);
      expect(inside, `word at ${w.start_ms}ms fell outside every speech segment`).toBe(true);
    }
  });

  it("orders words by time", async () => {
    configure(new StubLane());
    const body = ProcessResponseSchema.parse((await post({ audio_path: monoWav })).json());
    const starts = body.words.map((w) => w.start_ms);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("records complete provenance", async () => {
    configure(new StubLane());
    const { provenance } = ProcessResponseSchema.parse((await post({ audio_path: monoWav })).json());

    expect(provenance.stt).toMatchObject({ lane: "stub", model: "stub-model", timestamps: "word" });
    expect(provenance.stt.attempts).toHaveLength(1);
    expect(provenance.transcode.version).not.toBe("unavailable");
    expect(provenance.vad?.engine).toBeTruthy();
    expect(provenance.ml_version).toBeTruthy();
  });

  it("accepts a compressed format the same way", async () => {
    configure(new StubLane());
    const body = ProcessResponseSchema.parse((await post({ audio_path: monoMp3 })).json());
    expect(body.words.length).toBeGreaterThan(0);
    expect(body.media.codec).toContain("mp3");
  });

  it("keeps the lane's speakers when the lane diarized", async () => {
    configure(new StubLane("word", true));
    const body = ProcessResponseSchema.parse((await post({ audio_path: monoWav })).json());

    expect(body.provenance.diarization.source).toBe("stt");
    expect(new Set(body.words.map((w) => w.speaker))).toEqual(new Set(["S1", "S2"]));
    expect(body.speakers.map((s) => s.label).sort()).toEqual(["S1", "S2"]);
  });

  it("returns no speakers at all when diarization is off", async () => {
    configure(new StubLane("word", true));
    const body = ProcessResponseSchema.parse(
      (await post({ audio_path: monoWav, options: { diarize: "off" } })).json(),
    );
    expect(body.words.every((w) => w.speaker === null)).toBe(true);
  });

  it("skips the VAD when asked, and then trims nothing", async () => {
    const lane = new StubLane();
    configure(lane);
    const body = ProcessResponseSchema.parse(
      (await post({ audio_path: monoWav, options: { vad: false } })).json(),
    );

    expect(body.provenance.vad).toBeNull();
    expect(body.speech.silence_trimmed_ms).toBe(0);
    // The lane saw the whole file, silence included.
    expect(lane.lastInput!.durationMs).toBeGreaterThan(9000);
  });
});

suite("POST /process — two channels", () => {
  it("takes speakers from the channels and does not diarize", async () => {
    configure(new StubLane());
    const body = ProcessResponseSchema.parse((await post({ audio_path: stereoWav })).json());

    expect(body.media.channels).toBe(2);
    expect(body.provenance.diarization.source).toBe("channels");
    expect(body.provenance.diarization.engine).toBeNull();
    expect(new Set(body.words.map((w) => w.channel))).toEqual(new Set([0, 1]));
    expect(new Set(body.words.map((w) => w.speaker))).toEqual(new Set(["S1", "S2"]));
  });

  it("asks the lane NOT to diarize, since the microphones already did", async () => {
    const lane = new StubLane();
    configure(lane);
    await post({ audio_path: stereoWav });
    expect(lane.lastInput!.diarize).toBe(false);
  });

  it("keeps one attempt per channel in provenance", async () => {
    configure(new StubLane());
    const body = ProcessResponseSchema.parse((await post({ audio_path: stereoWav })).json());
    expect(body.provenance.stt.attempts).toHaveLength(2);
  });
});

suite("POST /process — the word-timestamp rule (CONTRACT §3)", () => {
  // Steward ruling, M6 (locked): degrade-and-flag. A call is never lost
  // because the only reachable lane cannot carry timings.
  it("degrades rather than failing, by default", async () => {
    configure(new StubLane("none"));
    const res = await post({ audio_path: monoWav });

    expect(res.statusCode).toBe(200);
    const body = ProcessResponseSchema.parse(res.json());
    expect(body.words.length).toBeGreaterThan(0); // the transcript survives
    expect(body.degraded).toBe(true);
    expect(body.warnings).toContain("stt_no_word_timestamps");
    expect(body.provenance.stt.timestamps).toBe("none");
  });

  it("degrades VISIBLY — the flag rides in provenance, not just in a log", async () => {
    // core/worker stores this and the UI disables seeking on such parts. If
    // the flag ever stops riding through, degradation becomes silent, which is
    // the one thing M6 forbids.
    configure(new StubLane("none"));
    const body = ProcessResponseSchema.parse((await post({ audio_path: monoWav })).json());

    expect(body.provenance.stt.timestamps).not.toBe("word");
    expect(body.degraded).toBe(true);
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it("refuses instead, when the operator opts into the strict rule", async () => {
    configure(new StubLane("none"), { ML_REQUIRE_WORD_TIMESTAMPS: "1" });
    const res = await post({ audio_path: monoWav, job_ref: "j" });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error_type: "stt_no_word_timestamps",
      retryable: false, // retrying the same lane produces the same non-answer
      job_ref: "j",
    });
  });

  it("anchors timing-less words to the audio they came from, never to 0–0", async () => {
    // core/worker stores these in NOT NULL start_ms/end_ms columns, so zeros
    // would satisfy the constraint while meaning nothing and the database
    // could never report the problem. A coarse honest span degrades the UI to
    // click-a-line; zeros seek to the start of the recording and read as a bug
    // to the person listening to their own call.
    configure(new StubLane("none"));
    const body = ProcessResponseSchema.parse((await post({ audio_path: monoWav })).json());

    expect(body.words.length).toBeGreaterThan(0);
    for (const w of body.words) {
      expect(w.end_ms).toBeGreaterThan(w.start_ms);
      expect(w.end_ms).toBeLessThanOrEqual(body.media.duration_ms);
    }
    // Anchored to real speech, not to the head of the file.
    expect(body.words[0]!.end_ms).toBeGreaterThan(1000);
  });

  it("says so when a component finds nothing, instead of absorbing it (M19)", async () => {
    // A silent "found nothing" is the failure mode that cost this package two
    // bugs. The VAD case is reachable in a unit test because the energy gate
    // legitimately finds no speech in a synthetic tone-free file.
    configure(new StubLane("word"), { ML_SILERO_MODEL: "" });
    const silent = path.join(dir, "silent.wav");
    await writeWav(silent, silence(4000), 1);

    const body = ProcessResponseSchema.parse((await post({ audio_path: silent })).json());

    expect(body.warnings).toContain("vad_found_no_speech");
    // The job still succeeded — the whole file went to the STT rather than
    // the caller losing their recording to a VAD that was simply wrong.
    expect(body.speech.segments.length).toBeGreaterThan(0);
  });

  it("always reports a speech span for audio it actually transcribed", async () => {
    // An empty segment list downstream is indistinguishable from a broken one.
    configure(new StubLane("none"));
    const body = ProcessResponseSchema.parse((await post({ audio_path: monoWav })).json());

    expect(body.speech.segments.length).toBeGreaterThan(0);
    for (const s of body.speech.segments) expect(s.end_ms).toBeGreaterThan(s.start_ms);
  });

  it("never marks a word-timestamped result as degraded", async () => {
    configure(new StubLane("word"));
    const body = ProcessResponseSchema.parse((await post({ audio_path: monoWav })).json());
    expect(body.degraded).toBe(false);
    expect(body.warnings).not.toContain("stt_no_word_timestamps");
  });
});

suite("POST /process — refusals", () => {
  it("rejects a local path unless the dev profile allows it", async () => {
    configure(new StubLane());
    process.env.ML_ALLOW_LOCAL_PATHS = "0";
    resetConfig();

    const res = await post({ audio_path: monoWav });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_type: "audio_source_forbidden", retryable: false });
  });

  it("rejects a request that names two audio sources", async () => {
    configure(new StubLane());
    const res = await post({ audio_path: monoWav, audio_url: "https://example.com/a.wav" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_type).toBe("bad_request");
  });

  it("rejects a request that names none", async () => {
    configure(new StubLane());
    expect((await post({ job_ref: "x" })).statusCode).toBe(400);
  });

  it("rejects an unknown option instead of ignoring it", async () => {
    configure(new StubLane());
    // A typo'd option that is silently dropped is a bug the caller cannot see.
    const res = await post({ audio_path: monoWav, options: { diarise: "auto" } });
    expect(res.statusCode).toBe(400);
  });

  it("says stt_unavailable, retryably, when no lane is configured", async () => {
    configure(null);
    const res = await post({ audio_path: monoWav });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error_type: "stt_unavailable", retryable: true });
  });

  it("refuses a URL when no allow-list is configured in production mode", async () => {
    configure(new StubLane());
    process.env.ML_ALLOW_LOCAL_PATHS = "0";
    resetConfig();

    const res = await post({ audio_url: "https://storage.example.com/signed.wav" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error_type).toBe("audio_source_forbidden");
  });

  it("refuses a URL whose host is not on the allow-list", async () => {
    configure(new StubLane(), { ML_URL_ALLOWLIST: "storage.example.com" });
    process.env.ML_ALLOW_LOCAL_PATHS = "0";
    resetConfig();

    const res = await post({ audio_url: "https://evil.example.net/a.wav" });
    expect(res.statusCode).toBe(403);
  });

  it("never leaks the audio location back to the caller", async () => {
    configure(new StubLane());
    process.env.ML_ALLOW_LOCAL_PATHS = "0";
    resetConfig();

    const res = await post({ audio_path: "C:\\secret\\customer-call.wav" });
    expect(res.body).not.toContain("customer-call");
    expect(res.body).not.toContain("secret");
  });
});
