import { afterEach, describe, expect, it } from "vitest";
import { resetConfig } from "../src/config.js";
import { MlError } from "../src/errors.js";
import { jobLogger } from "../src/log.js";
import { maxDurationForLanes, resetLanes, setLanes, transcribe, laneStatus } from "../src/stt/registry.js";
import type { SttInput, SttLane, SttResult } from "../src/stt/types.js";

class StubLane implements SttLane {
  calls = 0;

  constructor(
    readonly name: string,
    private readonly behaviour: "ok" | "fail" | "unconfigured",
    private readonly ceilingMs: number = Number.POSITIVE_INFINITY,
  ) {}

  configured(): boolean {
    return this.behaviour !== "unconfigured";
  }

  maxDurationMs(): number {
    return this.ceilingMs;
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    this.calls++;
    if (this.behaviour === "fail") throw new MlError("stt_failed", `${this.name} is down`);
    if (input.durationMs > this.ceilingMs) throw new MlError("media_too_long", `${this.name} ceiling`);
    return {
      words: [{ text: "سلام", start_ms: 0, end_ms: 300, confidence: 1, speaker: null, language: "fa" }],
      timestamps: "word",
      model: `${this.name}-model`,
      language: "fa",
      diarized: false,
    };
  }
}

const input: SttInput = { file: "unused.wav", languageHints: ["fa"], diarize: false, durationMs: 1000 };
const log = jobLogger("test");

function withLanes(order: string, lanes: Array<[string, SttLane]>) {
  process.env.ML_LANE_ORDER = order;
  resetConfig();
  setLanes(new Map(lanes));
}

afterEach(() => {
  delete process.env.ML_LANE_ORDER;
  resetConfig();
  resetLanes();
});

describe("each lane's own ceiling (2026-09-06)", () => {
  it("the job's ceiling is the largest among the usable lanes, and a pinned lane answers for itself", () => {
    const short = new StubLane("short", "ok", 35 * 60 * 1000);
    const long = new StubLane("long", "ok", 5 * 60 * 60 * 1000);
    withLanes("short,long", [["short", short], ["long", long]]);
    expect(maxDurationForLanes(null)).toBe(5 * 60 * 60 * 1000);
    expect(maxDurationForLanes("short")).toBe(35 * 60 * 1000);
    // an unconfigured long lane does not lend its ceiling
    withLanes("short,long", [["short", short], ["long", new StubLane("long", "unconfigured", 5 * 60 * 60 * 1000)]]);
    expect(maxDurationForLanes(null)).toBe(35 * 60 * 1000);
  });

  it("a lane that refuses a long file falls through to the next, and the refusal is on record", async () => {
    const short = new StubLane("short", "ok", 1000);
    const long = new StubLane("long", "ok");
    withLanes("short,long", [["short", short], ["long", long]]);
    const outcome = await transcribe({ ...input, durationMs: 5000 }, log, null);
    expect(outcome.lane).toBe("long");
    expect(outcome.attempts.map((a) => [a.lane, a.ok, a.error_type])).toEqual([
      ["short", false, "media_too_long"], ["long", true, null],
    ]);
  });
});

describe("lane fallback", () => {
  it("uses the primary and never touches the fallback when it works", async () => {
    const primary = new StubLane("primary", "ok");
    const fallback = new StubLane("fallback", "ok");
    withLanes("primary,fallback", [
      ["primary", primary],
      ["fallback", fallback],
    ]);

    const out = await transcribe(input, log, null);

    expect(out.lane).toBe("primary");
    expect(fallback.calls).toBe(0);
    expect(out.attempts).toEqual([
      expect.objectContaining({ lane: "primary", ok: true, error_type: null }),
    ]);
  });

  it("falls through to the next lane and records the failure", async () => {
    const primary = new StubLane("primary", "fail");
    const fallback = new StubLane("fallback", "ok");
    withLanes("primary,fallback", [
      ["primary", primary],
      ["fallback", fallback],
    ]);

    const out = await transcribe(input, log, null);

    expect(out.lane).toBe("fallback");
    expect(primary.calls).toBe(1);
    // A fallback nobody can see is a fallback nobody fixes.
    expect(out.attempts.map((a) => [a.lane, a.ok])).toEqual([
      ["primary", false],
      ["fallback", true],
    ]);
    expect(out.attempts[0]!.error_type).toBe("stt_failed");
  });

  it("skips an unconfigured lane without counting it as a failure", async () => {
    const primary = new StubLane("primary", "unconfigured");
    const fallback = new StubLane("fallback", "ok");
    withLanes("primary,fallback", [
      ["primary", primary],
      ["fallback", fallback],
    ]);

    const out = await transcribe(input, log, null);

    expect(out.attempts).toHaveLength(1);
    expect(out.attempts[0]!.lane).toBe("fallback");
  });

  it("fails retryably when every lane is down", async () => {
    withLanes("primary,fallback", [
      ["primary", new StubLane("primary", "fail")],
      ["fallback", new StubLane("fallback", "fail")],
    ]);

    const err = await transcribe(input, log, null).catch((e) => e);
    expect(err).toBeInstanceOf(MlError);
    expect(err.type).toBe("stt_failed");
    expect(err.retryable).toBe(true);
    expect((err.detail?.attempts as unknown[]).length).toBe(2);
  });

  it("reports stt_unavailable — not stt_failed — when nothing is configured", async () => {
    withLanes("primary", [["primary", new StubLane("primary", "unconfigured")]]);

    const err = await transcribe(input, log, null).catch((e) => e);
    // The distinction matters to the DAG: a missing key is an operator
    // problem, an exhausted lane is a provider problem.
    expect(err.type).toBe("stt_unavailable");
  });

  it("honours a pinned lane instead of the policy order", async () => {
    const primary = new StubLane("primary", "ok");
    const other = new StubLane("other", "ok");
    withLanes("primary,other", [
      ["primary", primary],
      ["other", other],
    ]);

    const out = await transcribe(input, log, "other");

    expect(out.lane).toBe("other");
    expect(primary.calls).toBe(0);
  });

  it("does not fall back past a pinned lane", async () => {
    const other = new StubLane("other", "ok");
    withLanes("primary,other", [
      ["primary", new StubLane("primary", "fail")],
      ["other", other],
    ]);

    const err = await transcribe(input, log, "primary").catch((e) => e);
    expect(err.type).toBe("stt_failed");
    expect(other.calls).toBe(0);
  });
});

describe("laneStatus", () => {
  it("says configured or not, and nothing about the key itself", () => {
    withLanes("a,b", [
      ["a", new StubLane("a", "ok")],
      ["b", new StubLane("b", "unconfigured")],
    ]);

    const status = laneStatus();
    expect(status).toEqual({ a: "configured", b: "unconfigured" });
    expect(JSON.stringify(status)).not.toMatch(/key|secret|bearer/i);
  });
});
