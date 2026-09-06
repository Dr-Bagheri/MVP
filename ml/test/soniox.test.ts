/**
 * The Soniox lane at its wire (2026-09-06): the request BODY the provider
 * receives — structured recognition context, language identification on,
 * the model — asserted against a fake `fetch` rather than a paraphrase of
 * the lane (rule 10); the lane's own ceiling, refused before any request is
 * made; and the two pure pieces of the async wait.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfig } from "../src/config.js";
import { createBody, SonioxLane } from "../src/stt/soniox.js";
import { pollDeadlineMs, pollIntervalMs, sonioxContext } from "../src/stt/soniox-api.js";
import type { SttInput } from "../src/stt/types.js";
import { fixtureDir, tone, writeWav } from "./helpers.js";

let dir: string;
let wav: string;

beforeAll(async () => {
  dir = await fixtureDir();
  wav = await writeWav(path.join(dir, "clip.wav"), tone(220, 500), 1);
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.SONIOX_API_KEY;
  delete process.env.ML_SONIOX_MAX_DURATION_MS;
  delete process.env.ML_STT_POLL_MS;
  resetConfig();
  vi.restoreAllMocks();
});

const input = (over: Partial<SttInput> = {}): SttInput => ({
  file: wav, languageHints: ["fa", "en"], diarize: true, durationMs: 500, ...over,
});

describe("sonioxContext — ours into the provider's", () => {
  it("keeps terms in order, de-duplicates them case-insensitively, and carries text and general facts", () => {
    const out = sonioxContext({
      terms: [" نورای ", "NeurAI", "neurai", "x", "سینا سپاسی", "سینا سپاسی"],
      text: "  kickoff  ",
      general: [{ key: " organization ", value: " Neurai " }, { key: "", value: "dropped" }],
    });
    expect(out).toEqual({
      terms: ["نورای", "NeurAI", "سینا سپاسی"],
      text: "kickoff",
      general: [{ key: "organization", value: "Neurai" }],
    });
  });

  it("is ABSENT when there is nothing to say — an empty context is a claim we did not make", () => {
    expect(sonioxContext(undefined)).toBeUndefined();
    expect(sonioxContext({ terms: [], text: "  " })).toBeUndefined();
    expect(sonioxContext({ terms: ["a"] })).toBeUndefined(); // one letter is not a term
  });

  it("stops at the provider's budget rather than sending a context it would refuse", () => {
    const many = Array.from({ length: 700 }, (_, i) => `term${i}`);
    const out = sonioxContext({ terms: many })!;
    expect((out.terms as string[]).length).toBe(500);
    const long = Array.from({ length: 200 }, (_, i) => `${"ا".repeat(70)}${i}`);
    const chars = (sonioxContext({ terms: long })!.terms as string[]).join("").length;
    expect(chars).toBeLessThanOrEqual(6_000);
  });
});

describe("the async wait", () => {
  it("allows a recording its own length plus a quarter hour, never less than the floor", () => {
    const floor = 15 * 60 * 1000;
    expect(pollDeadlineMs(0, floor)).toBe(floor);
    expect(pollDeadlineMs(5 * 60 * 1000, floor)).toBe(20 * 60 * 1000);
    expect(pollDeadlineMs(5 * 60 * 60 * 1000, floor)).toBe(5 * 60 * 60 * 1000 + floor);
    // a floor above the length rule still wins
    expect(pollDeadlineMs(60_000, 60 * 60 * 1000)).toBe(60 * 60 * 1000);
  });

  it("polls at the base interval for two minutes, then every ten seconds", () => {
    expect(pollIntervalMs(0, 3000)).toBe(3000);
    expect(pollIntervalMs(119_000, 3000)).toBe(3000);
    expect(pollIntervalMs(121_000, 3000)).toBe(10_000);
    expect(pollIntervalMs(121_000, 15_000)).toBe(15_000); // never faster than configured
  });
});

describe("the lane", () => {
  it("names a five-hour ceiling of its own and refuses above it before touching the network", async () => {
    process.env.SONIOX_API_KEY = "k";
    resetConfig();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const lane = new SonioxLane();
    expect(lane.maxDurationMs()).toBe(5 * 60 * 60 * 1000);
    await expect(lane.transcribe(input({ durationMs: 5 * 60 * 60 * 1000 + 1 })))
      .rejects.toMatchObject({ type: "media_too_long" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the structured context, language identification and the model — the body the provider gets", async () => {
    process.env.SONIOX_API_KEY = "k";
    process.env.ML_STT_POLL_MS = "1";
    resetConfig();
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: u, method, body: typeof init?.body === "string" ? init.body : undefined });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (u.endsWith("/files") && method === "POST") return json({ id: "f1" });
      if (u.endsWith("/transcriptions") && method === "POST") return json({ id: "t1" });
      if (u.endsWith("/transcriptions/t1") && method === "GET") return json({ status: "completed" });
      if (u.endsWith("/transcriptions/t1/transcript")) {
        return json({ tokens: [
          { text: "سلام", start_ms: 0, end_ms: 200, confidence: 0.9, speaker: 1, language: "fa" },
          { text: " hello", start_ms: 300, end_ms: 500, confidence: 0.8, speaker: 2, language: "en" },
        ] });
      }
      if (method === "DELETE") return new Response("", { status: 200 });
      return new Response("nope", { status: 404 });
    });

    const result = await new SonioxLane().transcribe(input({
      context: { terms: ["نورای", "Sina"], text: "kickoff", general: [{ key: "organization", value: "Neurai" }] },
    }));

    const create = calls.find((c) => c.url.endsWith("/transcriptions") && c.method === "POST")!;
    const body = JSON.parse(create.body!) as Record<string, unknown>;
    expect(body.model).toBe("stt-async-v5");
    expect(body.file_id).toBe("f1");
    expect(body.enable_language_identification).toBe(true);
    expect(body.enable_speaker_diarization).toBe(true);
    expect(body.language_hints).toEqual(["fa", "en"]);
    expect(body.context).toEqual({
      terms: ["نورای", "Sina"], text: "kickoff", general: [{ key: "organization", value: "Neurai" }],
    });
    // both provider objects are deleted afterwards — the customer's record leaves no copy
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url.split("/v1")[1])).toEqual([
      "/transcriptions/t1", "/files/f1",
    ]);
    // per-token languages survive into the words (C2's raw material)
    expect(result.words.map((w) => w.language)).toEqual(["fa", "en"]);
    expect(result.language).toBe("fa");
  });

  it("omits context entirely when nothing is given — createBody is the seam", () => {
    const body = createBody("f9", input());
    expect("context" in body).toBe(false);
    expect(body.enable_language_identification).toBe(true);
  });
});
