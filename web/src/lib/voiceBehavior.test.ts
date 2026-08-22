import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceBehavior, matchWake } from "./voiceLoop";

/**
 * The rebuilt voice behavior (2026-08-22, from scratch) — five rules and
 * nothing else. Each rule is pinned in BOTH directions: the thing it must
 * do, and the thing it must refuse to do.
 */
describe("createVoiceBehavior", () => {
  let onWake: ReturnType<typeof vi.fn<() => void>>;
  let onCommand: ReturnType<typeof vi.fn<(c: string) => void>>;
  let onStop: ReturnType<typeof vi.fn<() => void>>;
  let states: string[];
  let b: ReturnType<typeof createVoiceBehavior>;
  let now: number;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    onWake = vi.fn<() => void>();
    onCommand = vi.fn<(c: string) => void>();
    onStop = vi.fn<() => void>();
    states = [];
    b = createVoiceBehavior(
      { onWake, onCommand, onStop, onState: (s) => states.push(s) },
      { sessionMs: 45_000 },
    );
  });
  afterEach(() => vi.useRealTimers());

  const feed = (text: string) => { now += 7_000; b.consume(text, now); };

  // ── rule 1: it starts with the name ───────────────────────────────────
  it("the name alone wakes", () => {
    feed("echo");
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["session"]);
  });

  it("the Persian name wakes too", () => {
    feed("اکو");
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("name + words in one breath runs the words", () => {
    feed("echo برو به رکوردها");
    expect(onCommand).toHaveBeenCalledWith("برو به رکوردها");
    expect(onWake).not.toHaveBeenCalled();
  });

  it("without the name, NOTHING happens — whatever the language", () => {
    feed("please open the records");
    feed("لطفا رکوردها را باز کن");
    expect(onWake).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  // ── the session: after waking, no name needed ─────────────────────────
  it("in session, plain speech is the command — either language", () => {
    feed("echo");
    feed("what meetings do I have");
    feed("خلاصهٔ آخرین جلسه را بگو");
    expect(onCommand.mock.calls.map((c) => c[0])).toEqual([
      "what meetings do I have",
      "خلاصهٔ آخرین جلسه را بگو",
    ]);
  });

  it("the session expires after 45s of disuse", () => {
    feed("echo");
    vi.advanceTimersByTime(45_001);
    feed("open the archive");
    expect(onCommand).not.toHaveBeenCalled();
    expect(states).toEqual(["session", "idle"]);
  });

  // ── rule 3: stop stops it ─────────────────────────────────────────────
  it("a short stop in session stops and ends it", () => {
    feed("echo");
    feed("بسه");
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["session", "idle"]);
  });

  it("stop INSIDE a real sentence is not a stop", () => {
    feed("echo");
    feed("tell me where the bus stops on this route today");
    expect(onStop).not.toHaveBeenCalled();
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  // ── while the assistant SPEAKS: stop and barge-in only ────────────────
  it("while speaking, a short stop cuts the voice", () => {
    feed("echo");
    b.setSpeaking(true);
    feed("stop");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("while speaking, its own leaked reply does nothing — the self-echo defense", () => {
    feed("echo");
    b.setSpeaking(true);
    feed("here are the three meetings you had yesterday afternoon");
    expect(onCommand).toHaveBeenCalledTimes(0);
  });

  it("while speaking, the NAME + a command barges in", () => {
    feed("echo");
    b.setSpeaking(true);
    feed("echo open the records");
    expect(onCommand).toHaveBeenCalledWith("open the records");
  });

  // ── the one dedupe rule ───────────────────────────────────────────────
  it("the provider re-finalizing the consumed words is the same breath", () => {
    feed("echo go to records");
    b.consume("echo go to records", now + 2_000); // re-final, 2s later
    expect(onCommand).toHaveBeenCalledTimes(1);
    b.consume("go to records", now + 3_000); // contained fragment re-final
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("the same words said again LATER are a new command", () => {
    feed("echo go to records");
    b.consume("echo go to records", now + 10_000);
    expect(onCommand).toHaveBeenCalledTimes(2);
  });
});

describe("matchWake", () => {
  it("finds the name anywhere, remainder is the command", () => {
    expect(matchWake("hey echo do the thing")).toEqual({ woke: true, command: "do the thing" });
    expect(matchWake("سلام اکو")).toEqual({ woke: true, command: "" });
  });
  it("the name inside another word is not the name", () => {
    expect(matchWake("محمدی echoes").woke).toBe(false);
    expect(matchWake("gecko").woke).toBe(false);
  });
});
