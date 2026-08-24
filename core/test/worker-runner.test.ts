/**
 * The retry-vs-dead-letter decision, and what a dead letter costs.
 *
 * This is the logic that decides whether a customer's recording is retried or
 * abandoned, so it is tested as a pure function rather than inferred from an
 * async loop.
 */
import { describe, expect, it, vi } from "vitest";

import { loadWorkerConfig, backoffSeconds, type WorkerConfig } from "../src/worker/config.ts";
import {
  MlRequestError,
  ML_DIARIZATION_SOURCES,
  ML_TIMESTAMP_GRANULARITIES,
  unknownVocabulary,
} from "../src/worker/ml-client.ts";
import {
  classify,
  createRunner,
  disposition,
  StepError,
  type StepHandler,
} from "../src/worker/runner.ts";
import { Q_PROCESS_PART, type JobPayload, type Queue } from "../src/worker/queue.ts";
import { OwnerMismatchError, UnknownActorError } from "../src/db/actor.ts";

const config: WorkerConfig = { ...loadWorkerConfig(), maxAttempts: 3, retryBaseSec: 10, retryMaxSec: 600 };

const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe("ml/ vocabulary drift", () => {
  const result = (timestamps: string, source: string) => ({
    provenance: { stt: { timestamps }, diarization: { source } },
  });

  it("recognises every value ml/CONTRACT.md publishes today", () => {
    // The positive half: if this fails, the worker has stopped understanding
    // a value ml/ legitimately sends.
    for (const t of ML_TIMESTAMP_GRANULARITIES) {
      expect(unknownVocabulary(result(t, "channels"))).toEqual([]);
    }
    for (const s of ML_DIARIZATION_SOURCES) {
      expect(unknownVocabulary(result("word", s))).toEqual([]);
    }
  });

  it("names a value it does not recognise", () => {
    // The failure this guards is silent by nature: an unknown granularity is
    // simply "not word", so every part degrades, seek dies product-wide, and
    // nothing rejects anything. Unlike pg_enum, this boundary has no catalogue
    // to disagree with us — so the check has to be ours.
    expect(unknownVocabulary(result("words", "channels"))).toEqual(["stt.timestamps=words"]);
    expect(unknownVocabulary(result("word", "speakers"))).toEqual(["diarization.source=speakers"]);
    expect(unknownVocabulary(result("line", "voiceprint"))).toHaveLength(2);
  });
});

describe("classify", () => {
  it("takes ml/ at its word about whether repeating helps", () => {
    expect(classify(new MlRequestError("stt_failed", "lane exhausted", true))).toMatchObject({
      errorType: "stt_failed",
      retryable: true,
    });
    expect(classify(new MlRequestError("unsupported_media", "not audio", false))).toMatchObject({
      errorType: "unsupported_media",
      retryable: false,
    });
  });

  it("names an identity failure instead of calling it 'unexpected'", () => {
    // These are recognised conditions. Left generic, a suspended org would
    // burn five attempts over half an hour and then dead-letter saying
    // nothing — the operator reading it needs to know an admin must act, not
    // that something surprising happened.
    expect(classify(new UnknownActorError("actor not found"))).toMatchObject({
      errorType: "owner_not_found",
      // The row does not exist; nothing will change that on its own.
      retryable: false,
    });
    expect(classify(new OwnerMismatchError("job owner cannot see the call"))).toMatchObject({
      errorType: "owner_cannot_see_call",
      // A pending member or suspended org may be reinstated by an admin; a
      // forged payload exhausts its attempts and dead-letters with a name.
      retryable: true,
    });
  });

  it("treats an UNRECOGNISED error as retryable", () => {
    // Dead-lettering on a surprise abandons someone's recording because of a
    // bug on our side. Retrying wastes attempts and then dead-letters anyway,
    // with the attempt count as evidence.
    expect(classify(new Error("something nobody predicted"))).toMatchObject({
      errorType: "unexpected",
      retryable: true,
    });
    expect(classify("a thrown string")).toMatchObject({ retryable: true });
  });
});

describe("disposition", () => {
  it("dead-letters a non-retryable failure immediately", () => {
    // A file that is not audio will not become audio. Burning four more
    // attempts makes the customer wait for the same answer.
    const decision = disposition(new MlRequestError("unsupported_media", "not audio", false), 1, config);
    expect(decision).toMatchObject({ action: "dead_letter", exhausted: false });
  });

  it("retries a transient failure with growing backoff", () => {
    const first = disposition(new MlRequestError("stt_failed", "down", true), 1, config);
    const second = disposition(new MlRequestError("stt_failed", "down", true), 2, config);
    expect(first).toMatchObject({ action: "retry", delaySec: 10 });
    expect(second).toMatchObject({ action: "retry", delaySec: 20 });
  });

  it("gives up once the attempts are spent, and says so", () => {
    const decision = disposition(new MlRequestError("stt_failed", "down", true), 3, config);
    expect(decision).toMatchObject({ action: "dead_letter", exhausted: true });
    if (decision.action === "dead_letter") expect(decision.reason).toMatch(/3 attempts/);
  });

  it("caps the backoff so a retry is never scheduled past usefulness", () => {
    expect(backoffSeconds(99, config)).toBe(config.retryMaxSec);
  });

  it("treats an unreachable ml/ as transient", () => {
    // The audio is fine; the service is not.
    expect(disposition(new MlRequestError("ml_unreachable", "down", true), 1, config)).toMatchObject({
      action: "retry",
    });
  });

  it("respects a step's own non-retryable verdict", () => {
    expect(disposition(new StepError("bad_payload", "no partId", false), 1, config)).toMatchObject({
      action: "dead_letter",
    });
  });
});

// --------------------------------------------------------------- the loop

function fakeQueue(messages: { msgId: number; readCt: number; body: JobPayload }[]) {
  const calls = { removed: [] as number[], archived: [] as number[], delayed: [] as [number, number][], sent: [] as unknown[] };
  let handed = false;
  const queue: Queue = {
    async send(_q, body) { calls.sent.push(body); return 1; },
    async read() {
      if (handed) return [];
      handed = true;
      return messages;
    },
    async remove(_q, id) { calls.removed.push(id); },
    async archive(_q, id) { calls.archived.push(id); },
    async delay(_q, id, vt) { calls.delayed.push([id, vt]); },
  };
  return { queue, calls };
}

const payload: JobPayload = { callId: "c1", ownerId: "o1", partId: "p1" };

function handlerThat(behaviour: () => Promise<void>): StepHandler {
  return { name: "test_step", queue: Q_PROCESS_PART, handle: behaviour };
}

describe("runner", () => {
  it("deletes the message when the step succeeds", async () => {
    const { queue, calls } = fakeQueue([{ msgId: 7, readCt: 1, body: payload }]);
    const sink = { onDeadLetter: vi.fn() };
    const runner = createRunner({
      queue,
      handlers: [handlerThat(async () => {})],
      config,
      sink,
      log: silent,
    });

    const result = await runner.poll();

    expect(result).toMatchObject({ claimed: 1, done: 1, retried: 0, deadLettered: 0 });
    expect(calls.removed).toEqual([7]);
    expect(sink.onDeadLetter).not.toHaveBeenCalled();
  });

  it("delays the message and does NOT notify the sink on a retryable failure", async () => {
    const { queue, calls } = fakeQueue([{ msgId: 8, readCt: 1, body: payload }]);
    const sink = { onDeadLetter: vi.fn() };
    const runner = createRunner({
      queue,
      handlers: [handlerThat(async () => { throw new MlRequestError("stt_failed", "down", true); })],
      config,
      sink,
      log: silent,
    });

    const result = await runner.poll();

    expect(result.retried).toBe(1);
    expect(calls.delayed).toEqual([[8, 10]]);
    expect(calls.archived).toEqual([]);
    // A retry is not a loss; nothing should be marked missing yet.
    expect(sink.onDeadLetter).not.toHaveBeenCalled();
  });

  it("archives BEFORE telling the sink, so a failed write cannot loop forever", async () => {
    const order: string[] = [];
    const { queue } = fakeQueue([{ msgId: 9, readCt: 1, body: payload }]);
    const archiving = { ...queue, archive: async (...a: unknown[]) => { order.push("archive"); void a; } };
    const sink = { onDeadLetter: async () => { order.push("sink"); } };

    const runner = createRunner({
      queue: archiving as Queue,
      handlers: [handlerThat(async () => { throw new StepError("no_audio", "gone", false); })],
      config,
      sink,
      log: silent,
    });

    await runner.poll();

    // An archived message is recoverable by hand; an infinite redelivery loop
    // is not. Order matters here and is easy to get backwards.
    expect(order).toEqual(["archive", "sink"]);
  });

  it("runs up to `concurrency` messages of one queue TOGETHER — the knob gates now", async () => {
    // Before 2026-08-23 the config knob sized the pool and gated nothing:
    // peak would read 1 here. 3 would mean the ceiling is ignored. Only 2
    // is the knob working.
    const msgs = [1, 2, 3].map((n) => ({ msgId: n, readCt: 1, body: payload }));
    const { queue } = fakeQueue(msgs);
    let active = 0;
    let peak = 0;
    const runner = createRunner({
      queue,
      handlers: [handlerThat(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active -= 1;
      })],
      config: { ...config, concurrency: 2 },
      sink: { onDeadLetter: vi.fn() },
      log: silent,
    });

    const result = await runner.poll();

    expect(result.done).toBe(3);
    expect(peak).toBe(2);
  });

  it("refuses two handlers on one queue", () => {
    const { queue } = fakeQueue([]);
    expect(() =>
      createRunner({
        queue,
        handlers: [handlerThat(async () => {}), handlerThat(async () => {})],
        config,
        sink: { onDeadLetter: vi.fn() },
        log: silent,
      }),
    ).toThrow(/two handlers/);
  });
});
