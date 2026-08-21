import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWakeMachine } from "./voice";

/**
 * The wake machine is the SPEED fix (user: "hey echo has a delay — make it
 * faster"): the ack fires on the INTERIM transcript, commands ride the
 * same continuous stream (no recognizer restart), and the waking
 * utterance's own final must not become a phantom command.
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
      10_000,
    );
  });
  afterEach(() => vi.useRealTimers());

  it("acks a bare wake on the INTERIM — before end-of-speech", () => {
    machine.feed("echo", false); // interim: the word just appeared
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["awaiting"]);
  });

  it("the waking utterance's own final is not a command and not a second ack", () => {
    machine.feed("echo", false);
    machine.feed("echo", true); // the same utterance finalizing
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("wake + command in one breath runs from the final, not the interim", () => {
    machine.feed("hey echo record", false); // still being spoken
    expect(onCommand).not.toHaveBeenCalled();
    machine.feed("hey echo record new call", true);
    expect(onCommand).toHaveBeenCalledWith("record new call");
    expect(onWake).not.toHaveBeenCalled(); // no "Yes?" over a running command
  });

  it("interim ack, then the person keeps talking: the final carries the command", () => {
    machine.feed("echo", false); // ack fires here
    machine.feed("echo record new call", true); // same utterance, continued
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith("record new call");
    expect(states).toEqual(["awaiting", "idle"]);
  });

  it("a follow-up inside the window needs no wake word", () => {
    machine.feed("echo", true);
    machine.feed("record new call", true);
    expect(onCommand).toHaveBeenCalledWith("record new call");
  });

  it("the window EXPIRES — speech after it is ordinary speech again", () => {
    machine.feed("echo", true);
    vi.advanceTimersByTime(10_001);
    expect(states).toEqual(["awaiting", "idle"]);
    machine.feed("record new call", true);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("interims inside the window are not commands", () => {
    machine.feed("echo", true);
    machine.feed("record new", false);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("unrelated speech never wakes it", () => {
    machine.feed("let us check the report", true);
    expect(onWake).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });
});
