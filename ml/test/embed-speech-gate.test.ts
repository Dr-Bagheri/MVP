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
import { concat, ffmpegPresent, fixtureDir, silence, tone, writeWav } from "./helpers.js";

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

  it("does NOT refuse audio that has sound in it — the control", async () => {
    /* THE DISCRIMINATING HALF. A gate that answers no_speech to everything
       passes the assertion above and is completely wrong. This clip may still
       fail on a box with no extractor model (`embedding_unavailable`), which
       is a different refusal and exactly the one this test must tolerate:
       what it asserts is that the SPEECH GATE let it through. */
    const file = await writeWav(
      path.join(await fixtureDir(), "voiced.wav"),
      concat(silence(500), tone(180, 6000), silence(500)),
    );
    const res = await embed(file);

    const body = res.json() as { error_type?: string; speech_ms?: number };
    expect(body.error_type).not.toBe("no_speech");
    if (res.statusCode === 200) {
      /* and when it does answer, speech_ms is a MEASUREMENT: strictly less
         than the seven-second clip, because the silence at both ends is not
         speech and the old code could not have reported that */
      expect(body.speech_ms).toBeGreaterThan(0);
      expect(body.speech_ms).toBeLessThan(7000);
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
