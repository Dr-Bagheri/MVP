// Gated on the ONNX models being present (they are git-ignored, ~44 MB).
// Skips cleanly without them so a fresh checkout stays green.
//
// POSITIVE validation — does it find the right number of real voices? — lives
// in test/smoke/diarize-live.ts, for the same reason it does for the VAD: a
// model wired up wrong passes every negative assertion. What is asserted here
// is the wiring around the model.

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetConfig } from "../src/config.js";
import { SherpaDiarizer, normalize } from "../src/diarize/sherpa.js";
import { diarizer, resetDiarizer } from "../src/diarize/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEG = path.join(here, "..", "models", "segmentation.onnx");
const EMB = path.join(here, "..", "models", "embedding.onnx");

const suite = existsSync(SEG) && existsSync(EMB) ? describe : describe.skip;

function withModels() {
  process.env.ML_SEGMENTATION_MODEL = SEG;
  process.env.ML_EMBEDDING_MODEL = EMB;
  resetConfig();
  resetDiarizer();
}

function withoutModels() {
  delete process.env.ML_SEGMENTATION_MODEL;
  delete process.env.ML_EMBEDDING_MODEL;
  resetConfig();
  resetDiarizer();
}

suite("sherpa-onnx diarizer wiring", () => {
  it("reports itself available, having actually resolved the constructor", async () => {
    // Not merely "the package imported": sherpa-onnx-node is CommonJS, so
    // under `await import()` everything lands on `.default` and the namespace
    // looks fine until you construct from it. available() used to return true
    // and then explode mid-job; now it resolves the constructor to answer.
    withModels();
    expect(await new SherpaDiarizer().available()).toBe(true);
  });

  it("is selected as the diarizer when its models are configured", async () => {
    withModels();
    expect((await diarizer())?.name).toBe("sherpa-onnx");
  });

  it("reports unavailable — not broken — when the models are absent", async () => {
    // Absence is a normal state: two-channel audio needs no diarizer, and
    // Soniox diarizes for us. It must degrade one path, not fail startup.
    withoutModels();
    expect(await new SherpaDiarizer().available()).toBe(false);
    expect(await diarizer()).toBeNull();
  });

  it("stays off when the operator turns it off", async () => {
    withModels();
    process.env.ML_DIARIZER = "off";
    resetConfig();
    resetDiarizer();
    expect(await diarizer()).toBeNull();
    delete process.env.ML_DIARIZER;
    resetConfig();
    resetDiarizer();
  });
});

describe("sherpa output normalization", () => {
  it("keeps a monologue as one speaker", () => {
    // The failure that matters on real single-speaker audio is inventing a
    // second voice; the label mapping must not manufacture one.
    const out = normalize(
      [
        { start: 0, end: 30, speaker: 0 },
        { start: 31, end: 60, speaker: 0 },
      ],
      15,
    );
    expect(new Set(out.map((s) => s.speaker))).toEqual(new Set(["S1"]));
  });
});
