import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { visiblePoll } from "./visiblePoll";

/**
 * The poll that sleeps with the tab. Each case is a state the person can be
 * in; the discriminating ones are the two RETURNS — after a long absence the
 * poll catches up once, after a short one it does not — because a version
 * that runs on every visibility change satisfies "it polls while visible" and
 * "it stops while hidden" and is the thirty-second interval wearing a
 * different trigger.
 */
let state: DocumentVisibilityState = "visible";

function show(next: DocumentVisibilityState): void {
  state = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  state = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("visiblePoll", () => {
  it("runs every interval while the tab is visible — and never at zero", () => {
    const run = vi.fn();
    const stop = visiblePoll(run, 1_000);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it("runs nothing at all while the tab is hidden", () => {
    state = "hidden";
    const run = vi.fn();
    const stop = visiblePoll(run, 1_000);
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
    stop();
  });

  it("stops when the tab goes away, and catches up ONCE when it comes back after a long absence", () => {
    const run = vi.fn();
    const stop = visiblePoll(run, 1_000);
    vi.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(1);

    show("hidden");
    vi.advanceTimersByTime(5_000);
    expect(run).toHaveBeenCalledTimes(1);

    show("visible");
    /* at once — the person is looking now, and five intervals passed */
    expect(run).toHaveBeenCalledTimes(2);
    /* and the rhythm resumes from the return, not from the old schedule */
    vi.advanceTimersByTime(999);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it("does NOT run on a short tab switch — the control for the case above", () => {
    const run = vi.fn();
    const stop = visiblePoll(run, 1_000);
    vi.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(1);

    show("hidden");
    vi.advanceTimersByTime(200);
    show("visible");
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stop() ends it, and a later return to the tab wakes nothing", () => {
    const run = vi.fn();
    const stop = visiblePoll(run, 1_000);
    stop();
    vi.advanceTimersByTime(5_000);
    show("hidden");
    vi.advanceTimersByTime(5_000);
    show("visible");
    vi.advanceTimersByTime(5_000);
    expect(run).not.toHaveBeenCalled();
  });
});
