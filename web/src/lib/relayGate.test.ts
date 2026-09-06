import { describe, expect, it } from "vitest";
import { createRelayGate } from "./relayGate";

/**
 * The breaker the voice loop lacked on 2026-09-05/06 — see relayGate.ts.
 * Every case here is a sequence the loop actually produces; the control is
 * the good session, which must clear everything, or a person who talks in a
 * room with a bad relay would stay throttled after it recovered.
 */
describe("the relay gate", () => {
  it("opens freely at first, and a session WE ended never costs anything", () => {
    const gate = createRelayGate();
    expect(gate.canOpen(0)).toBe(true);
    gate.noteOpened(0);
    expect(gate.noteEnded(50, false)).toBe("ok");
    expect(gate.canOpen(51)).toBe(true);
    expect(gate.shortEnds).toBe(0);
  });

  it("a short server-ended session backs off, doubling each time, and never past the ceiling", () => {
    const gate = createRelayGate({ baseDelayMs: 1_500, maxDelayMs: 60_000, tripAfter: 100 });
    let now = 0;
    const waits: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      gate.noteOpened(now);
      now += 20; // the 20 ms lifetime the incident measured
      expect(gate.noteEnded(now, true)).toBe("backoff");
      waits.push(gate.notBefore - now);
      expect(gate.canOpen(now)).toBe(false);
      expect(gate.canOpen(gate.notBefore)).toBe(true);
      now = gate.notBefore;
    }
    expect(waits).toEqual([1_500, 3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000]);
  });

  it("a start that fails outright is a short end too — the reopen-on-every-frame path", () => {
    const gate = createRelayGate();
    // no noteOpened: the start threw before a session existed
    expect(gate.noteEnded(1_000, true)).toBe("backoff");
    expect(gate.canOpen(1_000)).toBe(false);
    expect(gate.canOpen(2_500)).toBe(true);
  });

  it("THE CONTROL: a session that produced tokens, however short, clears the count", () => {
    const gate = createRelayGate();
    gate.noteOpened(0);
    gate.noteEnded(20, true);
    gate.noteOpened(2_000);
    gate.noteEnded(2_020, true);
    expect(gate.shortEnds).toBe(2);
    gate.noteOpened(6_000);
    gate.noteTokens();
    expect(gate.noteEnded(6_300, true)).toBe("ok");
    expect(gate.shortEnds).toBe(0);
    expect(gate.canOpen(6_301)).toBe(true);
  });

  it("a session that lived past the short window clears the count even without tokens", () => {
    const gate = createRelayGate({ shortMs: 5_000 });
    gate.noteOpened(0);
    gate.noteEnded(20, true);
    gate.noteOpened(2_000);
    expect(gate.noteEnded(7_500, true)).toBe("ok");
    expect(gate.shortEnds).toBe(0);
  });

  it("six consecutive short ends trip the breaker: shut for the pause, announced ONCE, then open again", () => {
    const gate = createRelayGate({ tripAfter: 6, tripPauseMs: 300_000 });
    let now = 0;
    const verdicts: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      now = Math.max(now, gate.notBefore);
      gate.noteOpened(now);
      now += 20;
      verdicts.push(gate.noteEnded(now, true));
    }
    expect(verdicts).toEqual(["backoff", "backoff", "backoff", "backoff", "backoff", "tripped"]);
    expect(gate.canOpen(now + 299_000)).toBe(false);
    expect(gate.canOpen(now + 300_000)).toBe(true);
    // the relay is still down after the pause: shut again, but not announced again
    now += 300_000;
    gate.noteOpened(now);
    expect(gate.noteEnded(now + 20, true)).toBe("backoff");
    expect(gate.canOpen(now + 20)).toBe(false);
    // it recovers: one good session clears the trip and re-arms the announcement
    now += 300_000;
    gate.noteOpened(now);
    gate.noteTokens();
    expect(gate.noteEnded(now + 100, true)).toBe("ok");
    for (let i = 0; i < 6; i += 1) {
      now = Math.max(now, gate.notBefore) + 1;
      gate.noteOpened(now);
      verdicts.push(gate.noteEnded(now + 20, true));
    }
    expect(verdicts[verdicts.length - 1]).toBe("tripped");
  });

  it("THE CONTROL: five short ends are a backoff, not a trip", () => {
    const gate = createRelayGate({ tripAfter: 6 });
    let now = 0;
    let last = "";
    for (let i = 0; i < 5; i += 1) {
      now = Math.max(now, gate.notBefore);
      gate.noteOpened(now);
      now += 20;
      last = gate.noteEnded(now, true);
    }
    expect(last).toBe("backoff");
    expect(gate.notBefore - now).toBeLessThan(60_000);
  });
});
