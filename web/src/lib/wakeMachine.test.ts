import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWakeMachine } from "./voice";

/**
 * The wake machine, v3 — TWO states (2026-08-22 simplification: the
 * interim-primed ack machinery "was getting stuck"; idle now reacts to
 * FINALS only, and the conversation session keeps the fast interim
 * endpoint). What is pinned: waking is boring and reliable; the session
 * is where the cleverness lives; the assistant's own voice never feeds it.
 */
describe("createWakeMachine", () => {
  let onWake: ReturnType<typeof vi.fn<() => void>>;
  let onCommand: ReturnType<typeof vi.fn<(command: string) => void>>;
  let states: string[];
  let machine: ReturnType<typeof createWakeMachine>;

  beforeEach(() => {
    vi.useFakeTimers();
    onWake = vi.fn<() => void>();
    onCommand = vi.fn<(command: string) => void>();
    states = [];
    machine = createWakeMachine(
      { onWake, onCommand, onState: (s) => states.push(s) },
      { engageMs: 45_000 },
    );
  });
  afterEach(() => vi.useRealTimers());

  it("idle ignores INTERIMS entirely — no half-heard utterance can wedge it", () => {
    machine.feed("echo", false);
    machine.feed("echo go to records", false);
    vi.advanceTimersByTime(5_000);
    expect(onWake).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  it("a FINAL bare name wakes and acks", () => {
    machine.feed("echo", true);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["engaged"]);
  });

  it("a FINAL name + command runs the command, with no ack talked over it", () => {
    machine.feed("hey echo record new call", true);
    expect(onCommand).toHaveBeenCalledWith("record new call");
    expect(onWake).not.toHaveBeenCalled();
  });

  it("STANDBY: one wake, then several commands with no wake word between", () => {
    machine.feed("echo", true);
    machine.feed("go to calls", true);
    machine.feed("open the archive", true);
    expect(onCommand.mock.calls.map((c) => c[0])).toEqual(["go to calls", "open the archive"]);
    expect(states).toEqual(["engaged"]); // one session throughout
  });

  it("each command RENEWS the session", () => {
    machine.feed("echo", true);
    vi.advanceTimersByTime(40_000);
    machine.feed("go to calls", true);
    vi.advanceTimersByTime(40_000);
    machine.feed("open the archive", true);
    expect(onCommand).toHaveBeenCalledTimes(2);
  });

  it("the session ends on a stop word, either language", () => {
    machine.feed("echo", true);
    machine.feed("بسه", true);
    expect(states).toEqual(["engaged", "idle"]);
    machine.feed("go to calls", true);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("the session EXPIRES after silence — speech later is ordinary speech", () => {
    machine.feed("echo", true);
    vi.advanceTimersByTime(45_001);
    expect(states).toEqual(["engaged", "idle"]);
    machine.feed("record new call", true);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("MUTED while the assistant speaks: its own voice is never a command", () => {
    machine.feed("echo", true);
    machine.setMuted(true);
    machine.feed("I have navigated you to the calls archive", true);
    expect(onCommand).not.toHaveBeenCalled();
    machine.setMuted(false);
    machine.feed("open the archive", true);
    expect(onCommand).toHaveBeenCalledWith("open the archive");
  });

  it("unmute RENEWS the session — a long reply must not silently expire it", () => {
    machine.feed("echo", true);
    machine.setMuted(true);
    vi.advanceTimersByTime(44_000);
    machine.setMuted(false);
    vi.advanceTimersByTime(10_000);
    machine.feed("go to calls", true);
    expect(onCommand).toHaveBeenCalledWith("go to calls");
  });

  it("saying the name again mid-session re-acks instead of becoming a command", () => {
    machine.feed("echo", true);
    machine.feed("echo", true);
    expect(onWake).toHaveBeenCalledTimes(2);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("in-session: a changing interim is not a command", () => {
    machine.feed("echo", true);
    machine.feed("record new", false);
    vi.advanceTimersByTime(2000);
    machine.feed("record new call", false); // still talking — clock resets
    vi.advanceTimersByTime(2000);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("in-session: 3s of silence promotes the interim; the late final is swallowed once", () => {
    machine.feed("echo", true);
    machine.feed("record new call", false);
    vi.advanceTimersByTime(3000);
    expect(onCommand).toHaveBeenCalledWith("record new call");
    machine.feed("record new call", true);
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("a promoted STOP ends the session without becoming a command", () => {
    machine.feed("echo", true);
    machine.feed("بسه", false);
    vi.advanceTimersByTime(3000);
    expect(onCommand).not.toHaveBeenCalled();
    expect(states).toEqual(["engaged", "idle"]);
  });

  it("unrelated speech never wakes it", () => {
    machine.feed("let us check the report", true);
    expect(onWake).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });
});
