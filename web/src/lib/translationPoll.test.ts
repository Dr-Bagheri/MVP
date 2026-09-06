import { describe, expect, it } from "vitest";

import { pollUntilSettled, TranslationTimeout } from "./translationPoll";

/**
 * The wait, with fake time: it reads until `ready` or `failed`, sleeps the
 * interval between reads, and stops on its own after the budget — the case
 * a screen can never see and a person would otherwise pay for with an
 * endless spinner.
 */
describe("pollUntilSettled", () => {
  it("returns the first settled reading and slept between the reads before it", async () => {
    const answers = ["queued", "queued", "ready"];
    const slept: number[] = [];
    const out = await pollUntilSettled(async () => ({ status: answers.shift() ?? "ready" }), {
      intervalMs: 4000, maxMs: 60_000, sleep: async (ms) => { slept.push(ms); },
    });
    expect(out.status).toBe("ready");
    expect(slept).toEqual([4000, 4000]);
  });

  it("`failed` settles too — a failure is an answer, not a reason to keep asking", async () => {
    let reads = 0;
    const out = await pollUntilSettled(async () => { reads++; return { status: "failed" }; }, {
      intervalMs: 1, maxMs: 60_000, sleep: async () => {},
    });
    expect(out.status).toBe("failed");
    expect(reads).toBe(1);
  });

  it("gives up with its own error once the budget is spent", async () => {
    /* the fake sleep THROWS past a ceiling: a poll that lost its budget
       would otherwise spin on an instant sleep forever — a microtask loop no
       test timeout can interrupt — and the verify-red for this rule hung
       the run rather than going red (2026-09-06) */
    let clock = 0;
    let sleeps = 0;
    await expect(pollUntilSettled(async () => ({ status: "queued" }), {
      intervalMs: 5000, maxMs: 20_000,
      sleep: async (ms) => { clock += ms; if (++sleeps > 50) throw new Error("the poll never gave up"); },
      now: () => clock,
    })).rejects.toBeInstanceOf(TranslationTimeout);
    expect(sleeps).toBe(4); // 0, 5, 10, 15 s read; the 20 s read is past the budget
  });

  it("an aborted signal stops the wait before the next read", async () => {
    const controller = new AbortController();
    controller.abort();
    let reads = 0;
    await expect(pollUntilSettled(async () => { reads++; return { status: "queued" }; }, {
      intervalMs: 1, maxMs: 1000, signal: controller.signal, sleep: async () => {},
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toBe(0);
  });
});
