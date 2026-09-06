import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Identity } from "../src/agent/types.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { PartRow } from "../src/worker/lifecycle.ts";
import type { TranslatePayload } from "../src/worker/queue.ts";

/**
 * The translate step (2026-09-06, C4) against fakes at the seams it owns:
 * one ml call per part with the part's own signed audio and a wait that
 * follows the part's length; the units placed on THAT part's lines with the
 * part's offset; and the failure rules, which are the point — a provider
 * refusal marks the REQUEST failed and ends normally (the call stays ready),
 * a transient fault is retried while the status stays queued, and the third
 * delivery writes even a transient fault down rather than handing the
 * message to a sink that would fail the call.
 */
const OWNER: Identity = { userId: "u-1", orgId: "org-1", role: "member", isActive: true };

vi.mock("../src/worker/job-identity.ts", () => ({
  resolveJobIdentity: async () => OWNER,
}));

const { createTranslateStep } = await import("../src/worker/translate-step.ts");

const PAYLOAD: TranslatePayload = {
  kind: "translate", callId: "c-1", ownerId: "u-1", orgId: "org-1", language: "en", requestedBy: "u-2",
};

const part = (over: Partial<PartRow>): PartRow => ({
  id: "p-1", call_id: "c-1", idx: 0, offset_ms: 0, duration_ms: 60_000,
  storage_bucket: "call-audio", storage_path: "c-1/p-1.webm", audio_sha256: null,
  status: "diarized", missing: false, call_language: "fa", ...over,
});

function harness(options: {
  parts?: PartRow[];
  spans?: { id: string; part_id: string | null; start_ms: number; end_ms: number }[];
  translate?: ReturnType<typeof vi.fn>;
} = {}) {
  const spans = options.spans ?? [
    { id: "s-1", part_id: "p-1", start_ms: 0, end_ms: 5_000 },
    { id: "s-2", part_id: "p-1", start_ms: 5_000, end_ms: 10_000 },
    { id: "s-3", part_id: "p-2", start_ms: 60_000, end_ms: 65_000 },
  ];
  const db = {
    withIdentity: async <T,>(_identity: Identity, fn: (tx: SqlTx) => Promise<T>) =>
      fn({ unsafe: async () => spans } as unknown as SqlTx),
  } as unknown as Db;
  const translate = options.translate ?? vi.fn(async (req: { jobRef?: string }) => ({
    job_ref: req.jobRef ?? null, model: "stt-async-v5", media: { duration_ms: 60_000 },
    units: [
      { start_ms: 1_000, end_ms: 2_000, source_language: "fa", source_text: "سلام", text: "Hello" },
      { start_ms: 6_000, end_ms: 7_000, source_language: "fa", source_text: "دنیا", text: "world" },
    ],
  }));
  const ml = { translate, process: vi.fn(), health: vi.fn(), embed: vi.fn() };
  const storage = { signDownload: vi.fn(async (_b: string, path: string) => `https://signed.test/${path}`) };
  const lifecycle = { partsOfCall: vi.fn(async () => options.parts ?? [part({}), part({ id: "p-2", idx: 1, offset_ms: 60_000, storage_path: "c-1/p-2.webm" })]) };
  const translations = {
    writeSegments: vi.fn(async () => {}),
    markReady: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  };
  const step = createTranslateStep({
    db, ml: ml as never, storage, lifecycle: lifecycle as never, translations: translations as never,
    mlTimeoutMs: 20 * 60 * 1000,
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { step, ml, storage, translations, log };
}

describe("the translate step", () => {
  beforeEach(() => vi.clearAllMocks());

  it("translates each part's own audio and places the units on that part's lines, with the part's offset", async () => {
    const { step, ml, storage, translations, log } = harness();
    await step.handle(PAYLOAD, { attempt: 1, log });

    expect(storage.signDownload).toHaveBeenCalledTimes(2);
    expect(ml.translate).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ audioUrl: "https://signed.test/c-1/p-1.webm", targetLanguage: "en", jobRef: "p-1" }),
      { timeoutMs: 20 * 60 * 1000 }); // a one-minute part waits the floor
    // p-1's units land on p-1's lines; p-2's (offset 60 s) on s-3
    expect(translations.writeSegments).toHaveBeenCalledWith(OWNER, "c-1", "org-1", "en", [
      { segment_id: "s-1", text: "Hello" },
      { segment_id: "s-2", text: "world" },
      { segment_id: "s-3", text: "Hello world" },
    ]);
    expect(translations.markReady).toHaveBeenCalledWith(OWNER, "c-1", "en", "stt-async-v5");
    expect(translations.markFailed).not.toHaveBeenCalled();
  });

  it("a provider refusal marks the REQUEST failed with its type and ends normally — the call is untouched", async () => {
    const translate = vi.fn(async () => { throw Object.assign(new Error("too long"), { errorType: "media_too_long", retryable: false }); });
    const { step, translations, log } = harness({ translate });
    await expect(step.handle(PAYLOAD, { attempt: 1, log })).resolves.toBeUndefined();
    expect(translations.markFailed).toHaveBeenCalledWith(OWNER, "c-1", "en", "media_too_long");
    expect(translations.markReady).not.toHaveBeenCalled();
  });

  it("a transient fault is rethrown for the retry while the request stays queued — until the third delivery", async () => {
    const translate = vi.fn(async () => { throw Object.assign(new Error("down"), { errorType: "ml_unreachable", retryable: true }); });
    const { step, translations, log } = harness({ translate });
    await expect(step.handle(PAYLOAD, { attempt: 1, log })).rejects.toMatchObject({ errorType: "ml_unreachable" });
    expect(translations.markFailed).not.toHaveBeenCalled();

    await expect(step.handle(PAYLOAD, { attempt: 3, log })).resolves.toBeUndefined();
    expect(translations.markFailed).toHaveBeenCalledWith(OWNER, "c-1", "en", "ml_unreachable");
  });

  it("a call with no lines is a failed request named as such, and nothing is sent to ml/", async () => {
    const { step, ml, translations, log } = harness({ spans: [] });
    await step.handle(PAYLOAD, { attempt: 1, log });
    expect(ml.translate).not.toHaveBeenCalled();
    expect(translations.markFailed).toHaveBeenCalledWith(OWNER, "c-1", "en", "no_transcript");
  });

  it("a part with no audio is skipped, never sent", async () => {
    const { step, ml, translations, log } = harness({ parts: [part({ storage_path: null }), part({ id: "p-2", idx: 1, offset_ms: 60_000 })] });
    await step.handle(PAYLOAD, { attempt: 1, log });
    expect(ml.translate).toHaveBeenCalledTimes(1);
    expect(translations.markReady).toHaveBeenCalled();
  });
});
