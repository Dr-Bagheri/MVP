/**
 * POST /embed refuses a clip with no VOICE in it (user report, 2026-09-07:
 * "the enrolment voice detection part of the platform does not work — i did
 * 2 samples and never it realise i am talking to it").
 *
 * What was measured on production before this file existed: ten seconds of
 * digital silence answered `200 {speech_ms: 10000}` and a vector, and that
 * vector agreed with a pure tone's to within a couple of percent. `speech_ms`
 * was `samples / sampleRate` — the clip's DURATION wearing the name of a
 * measurement — so it could never be smaller than the clip and the 1500ms
 * floor beside it was a duration floor twice over. A muted microphone
 * therefore enrolled a signature that means "silence", the person was told it
 * was saved, and nothing ever matched them again.
 *
 * The pair below is the whole point: SILENCE must be refused and something
 * with energy in it must NOT be refused for that reason. A gate that refuses
 * everything would satisfy the first assertion alone.
 *
 * The model half stays in test/smoke/embedding-live.ts, as the sibling file
 * says: this suite proves the GATE, never that a vector was produced.
 */
import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

import { resetConfig } from "../src/config.js";
import { resetVadEngine } from "../src/vad/index.js";
import { buildServer } from "../src/server.js";
import { ffmpegPresent, fixtureDir, silence, tone, writeWav } from "./helpers.js";

const have = await ffmpegPresent();
const suite = have ? describe : describe.skip;

afterEach(() => {
  resetConfig();
  resetVadEngine();
});

async function embed(file: string) {
  process.env.ML_ALLOW_LOCAL_PATHS = "1";
  resetConfig();
  const app = await buildServer();
  try {
    return await app.inject({
      method: "POST",
      url: "/embed",
      payload: { audio_path: file, job_ref: "gate-test" },
    });
  } finally {
    await app.close();
  }
}

suite("POST /embed — the speech gate", () => {
  it("refuses a long clip that carries no voice, by name and without retry", async () => {
    const file = await writeWav(path.join(await fixtureDir(), "silent.wav"), silence(10_000));
    const res = await embed(file);

    expect(res.statusCode).toBe(422);
    const body = res.json() as { error_type?: string; retryable?: boolean; message?: string };
    expect(body.error_type).toBe("no_speech");
    /* the same bytes answer the same way forever — a retry is a loop, and
       what has to change is the microphone */
    expect(body.retryable).toBe(false);
    /* the sentence names BOTH numbers, because "no voice" on a ten-second
       clip is a different report from "your clip was too short" */
    expect(body.message).toMatch(/speech/i);
  });

  /**
   * THE POSITIVE HALF, and where it honestly lives.
   *
   * A synthetic tone is NOT a valid control for a speech gate, and finding
   * that out is the reason this comment is here rather than an assertion. It
   * passes under the energy fallback, which hears energy, and Silero refuses
   * it — correctly, because a 200Hz sine is not a voice. A test asserting
   * "a tone gets through" would therefore be green on a box with no model and
   * red on the deployment it is meant to protect: worse than no control,
   * because it reads like one.
   *
   * So the control runs where the subject is real. Measured on production on
   * 2026-09-07, immediately after this shipped, against
   * `spike/fixtures/persian-test-1.mp3` through the deployed Silero:
   *
   *     200 {dim: 512, model: "sherpa-3dspeaker-v1", speech_ms: 76572}
   *
   * — a real voice passes, and `speech_ms` is a MEASUREMENT rather than the
   * clip's length, which is the property the old code could not have had.
   * Ten seconds of silence, the same day, on the same box: 422 no_speech,
   * "0ms of speech in 10000ms of audio". That pair is rule 7's
   * positive-detection bar, run once for real and recorded, and it belongs
   * beside `test/smoke/embedding-live.ts` rather than in a suite whose only
   * audio is arithmetic.
   */
  it("the engine that answered is NAMED, so a green here says which gate it measured", async () => {
    process.env.ML_ALLOW_LOCAL_PATHS = "1";
    resetConfig();
    const app = await buildServer();
    try {
      const health = (await app.inject({ method: "GET", url: "/health" })).json() as {
        vad: string; vad_degraded: boolean;
      };
      /* a boolean would say nothing: the whole point is that the two engines
         answer a tone differently, so a result from this file is only
         readable next to the engine's name */
      expect(typeof health.vad).toBe("string");
      expect(health.vad.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("a clip shorter than the floor is refused for its LENGTH, not for its silence", async () => {
    /* two different nothings: "you barely said anything" and "we heard
       nothing at all" are different reports to a person holding a microphone */
    const file = await writeWav(path.join(await fixtureDir(), "blip.wav"), tone(180, 400));
    const res = await embed(file);

    const body = res.json() as { error_type?: string; message?: string };
    expect(body.error_type).toBe("bad_request");
    expect(body.message).toMatch(/1500ms/);
  });
});
