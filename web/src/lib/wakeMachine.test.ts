import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWakeMachine } from "./voice";

/**
 * The wake machine, v2 — shaped by three live complaints (2026-08-21):
 * the "Yes?" barged into sentences still being spoken; every command
 * needed its own "hey echo"; and the assistant's spoken reply must not
 * be transcribed into a command against itself.
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
      { ackDelayMs: 900, engageMs: 45_000 },
    );
  });
  afterEach(() => vi.useRealTimers());

  it("lets the sentence FINISH: no ack while words keep coming after the name", () => {
    machine.feed("hey echo", false); // the name appears mid-sentence
    machine.feed("hey echo go to the", false); // …and the sentence continues
    vi.advanceTimersByTime(2000); // well past the ack delay
    expect(onWake).not.toHaveBeenCalled(); // nothing talked over them
    machine.feed("hey echo go to the archive of calls", true);
    expect(onCommand).toHaveBeenCalledWith("go to the archive of calls");
  });

  it("a name that stays alone gets its ack after the short hold", () => {
    machine.feed("echo", false);
    expect(onWake).not.toHaveBeenCalled(); // not instantly — the hold
    vi.advanceTimersByTime(900);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["engaged"]);
  });

  it("a FINAL bare name acks immediately — the utterance is over, nothing to interrupt", () => {
    machine.feed("echo", true);
    expect(onWake).toHaveBeenCalledTimes(1);
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
    machine.feed("go to calls", true); // 5s before expiry — renews
    vi.advanceTimersByTime(40_000); // 80s after wake, 40s after command
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
    machine.setMuted(true); // the reply starts playing
    machine.feed("I have navigated you to the calls archive", true);
    expect(onCommand).not.toHaveBeenCalled();
    machine.setMuted(false);
    machine.feed("open the archive", true);
    expect(onCommand).toHaveBeenCalledWith("open the archive");
  });

  it("unmute RENEWS the session — a long reply must not silently expire it", () => {
    machine.feed("echo", true);
    machine.setMuted(true);
    vi.advanceTimersByTime(44_000); // almost the whole window spent listening
    machine.setMuted(false);
    vi.advanceTimersByTime(10_000); // would have expired without the renew
    machine.feed("go to calls", true);
    expect(onCommand).toHaveBeenCalledWith("go to calls");
  });

  it("saying the name again mid-session re-acks instead of becoming a command", () => {
    machine.feed("echo", true);
    machine.feed("hey echo", true);
    expect(onWake).toHaveBeenCalledTimes(2);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("wake + command in one breath runs from the final, with no ack over it", () => {
    machine.feed("hey echo record", false);
    machine.feed("hey echo record new call", true);
    expect(onCommand).toHaveBeenCalledWith("record new call");
    expect(onWake).not.toHaveBeenCalled();
  });

  it("a revised-away wake is a mishear, not a command", () => {
    machine.feed("echo", false); // primed
    machine.feed("that will do", true); // the recognizer changed its mind
    expect(onWake).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("unrelated speech never wakes it", () => {
    machine.feed("let us check the report", true);
    expect(onWake).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("an interim is not a command WHILE it is still changing", () => {
    machine.feed("echo", true);
    machine.feed("record new", false);
    vi.advanceTimersByTime(2000);
    machine.feed("record new call", false); // still talking — clock resets
    vi.advanceTimersByTime(2000);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("3s of SILENCE promotes the interim — the input ends when the person does", () => {
    machine.feed("echo", true);
    machine.feed("record new call", false);
    vi.advanceTimersByTime(3000);
    expect(onCommand).toHaveBeenCalledWith("record new call");
    // the recognizer's own late final for that utterance is a duplicate
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
});
