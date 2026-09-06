import { describe, expect, it, vi } from "vitest";
import { mergeBySeq, openChatLive } from "./chatLive";

/**
 * 0184 — the browser's delivery lane.
 *
 * The three facts here are the ones that decide whether the room is trustworthy:
 *
 *  1. THE SAME MESSAGE ARRIVING TWICE IS ONE MESSAGE. It genuinely will: the
 *     stream delivers it and an overlapping catch-up read delivers it again,
 *     and a list that appended blindly would show every message twice for
 *     exactly as long as a reconnect takes.
 *  2. NO DIRECT ADDRESS → POLL, never a stream at a guessed URL. A stream
 *     opened at a guess fails silently, and a room that has quietly stopped
 *     updating is indistinguishable from a room where nobody is talking.
 *  3. A STREAM ERROR FALLS BACK rather than dying. `EventSource` retries on
 *     its own — except after a non-200, where the spec fails the connection
 *     permanently and never tries again. That is precisely what a 502 during
 *     a deploy produces.
 */

function fakeSource() {
  const listeners = new Map<string, (event: MessageEvent) => void>();
  const es = {
    onopen: null as null | (() => void),
    onerror: null as null | (() => void),
    close: vi.fn(),
    addEventListener: (type: string, fn: (event: MessageEvent) => void) => {
      listeners.set(type, fn);
    },
  };
  return {
    es: es as unknown as EventSource,
    open: () => es.onopen?.(),
    fail: () => es.onerror?.(),
    emit: (type: string, data: unknown) => {
      listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
    },
  };
}

describe("mergeBySeq", () => {
  it("is idempotent, and keeps the newest version of a message", () => {
    const first = [{ id: "a", seq: 1 }, { id: "b", seq: 2 }];
    /* the same row twice, and an EDIT of one of them: the stream and the
       catch-up read overlap constantly */
    const merged = mergeBySeq(first, [{ id: "b", seq: 2 }, { id: "c", seq: 3 }]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    /* and it SORTS: a catch-up read can hand back rows the stream already
       delivered out of order */
    expect(mergeBySeq([{ id: "c", seq: 3 }], [{ id: "a", seq: 1 }]).map((m) => m.seq))
      .toEqual([1, 3]);
  });

  it("returns the same list when nothing arrived", () => {
    const list = [{ id: "a", seq: 1 }];
    expect(mergeBySeq(list, [])).toBe(list);
  });
});

describe("openChatLive", () => {
  it("opens the stream when core gave a direct address", async () => {
    const fake = fakeSource();
    const seen: unknown[] = [];
    const states: string[] = [];
    const stop = openChatLive(
      { onEvent: (e) => seen.push(e), onPoll: () => undefined, onState: (s) => states.push(s) },
      {
        ticket: async () => ({ direct_url: "https://api.example/v1/chat/stream?ticket=t" }),
        source: () => fake.es,
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    fake.open();
    fake.emit("message", { type: "message", message: { id: "m1", seq: 1 } });
    expect(states).toEqual(["connecting", "live"]);
    expect(seen).toHaveLength(1);
    stop();
  });

  it("POLLS when there is no direct address — never a stream at a guess", async () => {
    let ticks = 0;
    const states: string[] = [];
    const timers: Array<() => void> = [];
    const madeSource = vi.fn();
    const stop = openChatLive(
      { onEvent: () => undefined, onPoll: () => { ticks += 1; }, onState: (s) => states.push(s) },
      {
        ticket: async () => ({ direct_url: null }),
        source: (url: string) => { madeSource(url); return fakeSource().es; },
        setTimer: (fn) => { timers.push(fn); return timers.length; },
        clearTimer: () => undefined,
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(madeSource).not.toHaveBeenCalled();
    expect(states).toEqual(["connecting", "polling"]);
    timers[0]?.();
    expect(ticks).toBe(1);
    stop();
  });

  it("falls back to polling when the stream errors", async () => {
    const fake = fakeSource();
    const states: string[] = [];
    const timers: Array<() => void> = [];
    const stop = openChatLive(
      { onEvent: () => undefined, onPoll: () => undefined, onState: (s) => states.push(s) },
      {
        ticket: async () => ({ direct_url: "https://api.example/stream" }),
        source: () => fake.es,
        setTimer: (fn) => { timers.push(fn); return timers.length; },
        clearTimer: () => undefined,
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    fake.open();
    expect(states).toEqual(["connecting", "live"]);
    fake.fail();
    expect(states).toEqual(["connecting", "live", "polling"]);
    /* and the CONTROL: a second error must not start a second poller, which
       would double the request rate on every reconnect attempt */
    fake.fail();
    expect(timers).toHaveLength(1);
    stop();
  });

  it("stops everything on unmount", async () => {
    const fake = fakeSource();
    const cleared: number[] = [];
    const stop = openChatLive(
      { onEvent: () => undefined, onPoll: () => undefined, onState: () => undefined },
      {
        ticket: async () => ({ direct_url: null }),
        source: () => fake.es,
        setTimer: () => 7,
        clearTimer: (id) => cleared.push(id),
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    stop();
    expect(cleared).toEqual([7]);
  });
});

describe("openChatLive — after a drop (2026-09-06)", () => {
  it("mints a fresh ticket after a jittered backoff, polls meanwhile, and stops polling once live again", async () => {
    const sources: ReturnType<typeof fakeSource>[] = [];
    const tickets = vi.fn(async () => ({ direct_url: "https://api.example/v1/chat/stream?ticket=t" }));
    const states: string[] = [];
    const laters: Array<{ fn: () => void; ms: number }> = [];
    const intervals: Array<() => void> = [];
    let cleared = 0;
    const stop = openChatLive(
      { onEvent: () => undefined, onPoll: () => undefined, onState: (s) => states.push(s) },
      {
        ticket: tickets,
        source: () => { const f = fakeSource(); sources.push(f); return f.es; },
        setTimer: (fn) => { intervals.push(fn); return intervals.length; },
        clearTimer: () => { cleared += 1; },
        later: (fn, ms) => { laters.push({ fn, ms }); return laters.length; },
        cancelLater: () => undefined,
        random: () => 0.5,
      },
    );
    await Promise.resolve(); await Promise.resolve();
    sources[0]!.open();
    expect(states).toEqual(["connecting", "live"]);

    /* the connection drops */
    sources[0]!.fail();
    expect(states[states.length - 1]).toBe("polling");
    expect(intervals.length, "polling is the floor").toBe(1);
    /* the old code stopped here: EventSource retried the spent ticket, got a
       401, and the page polled for the rest of its life */
    expect(laters.length, "a reconnect is scheduled").toBe(1);
    expect(laters[0]!.ms).toBe(2_000); // 2 s × (0.75 + 0.5 × 0.5)
    expect(tickets).toHaveBeenCalledTimes(1);

    laters[0]!.fn();
    await Promise.resolve(); await Promise.resolve();
    expect(tickets, "a FRESH ticket, not the spent one").toHaveBeenCalledTimes(2);
    expect(sources.length).toBe(2);

    sources[1]!.open();
    expect(states[states.length - 1]).toBe("live");
    expect(cleared, "the poller is cleared once the stream is live again").toBe(1);
    stop();
  });

  it("the backoff doubles while the relay stays down, and never past thirty seconds", async () => {
    const laters: number[] = [];
    let pending: (() => void) | null = null;
    const stop = openChatLive(
      { onEvent: () => undefined, onPoll: () => undefined, onState: () => undefined },
      {
        ticket: async () => { throw new Error("down"); },
        source: () => fakeSource().es,
        setTimer: () => 1,
        clearTimer: () => undefined,
        later: (fn, ms) => { laters.push(ms); pending = fn; return laters.length; },
        cancelLater: () => undefined,
        random: () => 0.5,
      },
    );
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      pending!();
    }
    await Promise.resolve(); await Promise.resolve();
    expect(laters.slice(0, 6)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    stop();
  });
});
