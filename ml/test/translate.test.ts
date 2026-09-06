/**
 * Translation through the transcriber (2026-09-06): the token stream the
 * provider documents for one-way translation — original runs timed, their
 * translations untimed and following — becomes units; the request body
 * carries the translation instruction; and the HTTP surface answers with
 * the declared shape when the translator is a stub.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { TranslateResponseSchema } from "../src/schema.js";
import { groupTranslation, setTranslator, translateBody } from "../src/stt/soniox-translate.js";
import { concat, ffmpegPresent, fixtureDir, silence, tone, writeWav } from "./helpers.js";

describe("groupTranslation — the provider's stream into units", () => {
  it("pairs each original run with the translation that follows it, timing from the originals", () => {
    const units = groupTranslation([
      { text: "سلام", start_ms: 100, end_ms: 300, language: "fa", translation_status: "original" },
      { text: " دنیا", start_ms: 320, end_ms: 500, language: "fa", translation_status: "original" },
      { text: "Hello", language: "en", source_language: "fa", translation_status: "translation" },
      { text: " world", language: "en", source_language: "fa", translation_status: "translation" },
      { text: "خداحافظ", start_ms: 900, end_ms: 1200, language: "fa", translation_status: "original" },
      { text: "Goodbye", language: "en", source_language: "fa", translation_status: "translation" },
    ]);
    expect(units).toEqual([
      { start_ms: 100, end_ms: 500, source_language: "fa", source_text: "سلام دنیا", text: "Hello world" },
      { start_ms: 900, end_ms: 1200, source_language: "fa", source_text: "خداحافظ", text: "Goodbye" },
    ]);
  });

  it("a token the provider left untranslated carries its own text — never a blank line", () => {
    const units = groupTranslation([
      { text: "okay", start_ms: 0, end_ms: 200, language: "en", translation_status: "none" },
      { text: " then", start_ms: 210, end_ms: 400, language: "en", translation_status: "none" },
      { text: "بله", start_ms: 800, end_ms: 900, language: "fa", translation_status: "original" },
      { text: "Yes", language: "en", source_language: "fa", translation_status: "translation" },
    ]);
    expect(units.map((u) => [u.source_text, u.text])).toEqual([
      ["okay then", "okay then"],
      ["بله", "Yes"],
    ]);
  });

  it("an original run with no translation after it still comes out, saying its source", () => {
    const units = groupTranslation([
      { text: "تست", start_ms: 0, end_ms: 100, language: "fa", translation_status: "original" },
    ]);
    expect(units).toEqual([{ start_ms: 0, end_ms: 100, source_language: "fa", source_text: "تست", text: "تست" }]);
    expect(groupTranslation([])).toEqual([]);
  });

  it("asks the provider for a one-way translation with identification on", () => {
    const body = translateBody("f1", { file: "x.wav", durationMs: 1000, targetLanguage: "en", languageHints: ["fa", "en"] });
    expect(body).toMatchObject({
      file_id: "f1", model: "stt-async-v5", enable_language_identification: true,
      translation: { type: "one_way", target_language: "en" },
    });
  });
});

const have = await ffmpegPresent();
const suite = have ? describe : describe.skip;

suite("POST /translate", () => {
  let dir: string;
  let wav: string;

  beforeAll(async () => {
    dir = await fixtureDir();
    wav = await writeWav(path.join(dir, "clip.wav"), concat(tone(220, 800), silence(400)), 1);
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  afterEach(() => {
    delete process.env.ML_ALLOW_LOCAL_PATHS;
    delete process.env.SONIOX_API_KEY;
    resetConfig();
    setTranslator(undefined);
  });

  it("answers the declared shape, with the units the translator produced and the file's duration", async () => {
    process.env.ML_ALLOW_LOCAL_PATHS = "1";
    process.env.SONIOX_API_KEY = "k";
    resetConfig();
    let seen: { targetLanguage: string; durationMs: number } | undefined;
    setTranslator(async (input) => {
      seen = { targetLanguage: input.targetLanguage, durationMs: input.durationMs };
      return { model: "stub", units: [{ start_ms: 0, end_ms: 800, source_language: "fa", source_text: "سلام", text: "Hello" }] };
    });
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "POST", url: "/translate", payload: { audio_path: wav, target_language: "en", job_ref: "j1" } });
      expect(res.statusCode).toBe(200);
      const body = TranslateResponseSchema.parse(res.json());
      expect(body.job_ref).toBe("j1");
      expect(body.units).toEqual([{ start_ms: 0, end_ms: 800, source_language: "fa", source_text: "سلام", text: "Hello" }]);
      expect(body.media.duration_ms).toBeGreaterThan(1000);
      expect(seen).toEqual({ targetLanguage: "en", durationMs: body.media.duration_ms });
    } finally {
      await app.close();
    }
  });

  it("refuses a target that is not a language tag, and says stt_unavailable without a key", async () => {
    process.env.ML_ALLOW_LOCAL_PATHS = "1";
    process.env.SONIOX_API_KEY = "k";
    resetConfig();
    const app = await buildServer();
    try {
      const bad = await app.inject({ method: "POST", url: "/translate", payload: { audio_path: wav, target_language: "English" } });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
    delete process.env.SONIOX_API_KEY;
    resetConfig();
    const app2 = await buildServer();
    try {
      const none = await app2.inject({ method: "POST", url: "/translate", payload: { audio_path: wav, target_language: "en" } });
      expect(none.statusCode).toBe(503);
      expect(none.json()).toMatchObject({ error_type: "stt_unavailable" });
    } finally {
      await app2.close();
    }
  });
});
