/**
 * The upload ORCHESTRATION — the piece of Part 5 that must be right and can
 * be tested without a microphone: one part travels sign → PUT → register,
 * parts upload strictly in order while the recorder keeps rolling, and
 * `settle()` is the barrier the FINISH button waits behind.
 *
 * Kept apart from the recorder component so the sequencing rules live where
 * vitest can reach them; the component wires browser APIs to this and
 * renders state, nothing more.
 */

export interface UploadApi {
  signCallPart(
    callId: string,
    input: { idx: number; content_type: string },
  ): Promise<{ upload_url: string; path: string; content_type: string }>;
  putSignedPart(uploadUrl: string, blob: Blob, contentType: string): Promise<void>;
  registerCallPart(
    callId: string,
    input: { idx: number; offset_ms: number; path: string },
  ): Promise<{ part_id: string }>;
}

export interface PartJob {
  idx: number;
  offsetMs: number;
  blob: Blob;
  contentType: string;
}

/** One part, whole: a part that PUT but never registered does not count. */
export async function uploadOnePart(
  api: UploadApi,
  callId: string,
  job: PartJob,
): Promise<void> {
  const signed = await api.signCallPart(callId, {
    idx: job.idx,
    content_type: job.contentType,
  });
  await api.putSignedPart(signed.upload_url, job.blob, job.contentType);
  await api.registerCallPart(callId, {
    idx: job.idx,
    offset_ms: job.offsetMs,
    path: signed.path,
  });
}

export type UploaderProgress = {
  /** parts fully uploaded (registered) */
  done: number;
  /** parts waiting or in flight */
  pending: number;
  /** parts that failed after the retry — held with their bytes for retryFailed() */
  failed: number;
};

/**
 * Sequential queue with one automatic retry per part.
 *
 * Sequential on purpose: parts arrive one per 30 minutes (or once, for a
 * file), so parallelism buys nothing — and ordered uploads mean a failure
 * leaves an honest prefix rather than holes.
 *
 * A failed part is KEPT, bytes and all. Audio that reached the browser and
 * then vanished because a request failed would be the unforgivable loss —
 * the person cannot re-say the meeting (M21: never the user's data).
 */
export class PartUploader {
  private chain: Promise<void> = Promise.resolve();
  private doneCount = 0;
  private pendingCount = 0;
  private failedJobs: PartJob[] = [];

  constructor(
    private readonly api: UploadApi,
    private readonly callId: string,
    private readonly onProgress?: (p: UploaderProgress) => void,
  ) {}

  private report(): void {
    this.onProgress?.({
      done: this.doneCount,
      pending: this.pendingCount,
      failed: this.failedJobs.length,
    });
  }

  enqueue(job: PartJob): void {
    this.pendingCount += 1;
    this.report();
    this.chain = this.chain.then(async () => {
      try {
        try {
          await uploadOnePart(this.api, this.callId, job);
        } catch {
          // one automatic retry — a transient network blip must not need a
          // human; a second failure does, and keeps the bytes
          await uploadOnePart(this.api, this.callId, job);
        }
        this.doneCount += 1;
      } catch {
        this.failedJobs.push(job);
      } finally {
        this.pendingCount -= 1;
        this.report();
      }
    });
  }

  /** Push every kept failure back through the queue. */
  retryFailed(): void {
    const jobs = this.failedJobs;
    this.failedJobs = [];
    this.report();
    for (const job of jobs) this.enqueue(job);
  }

  /**
   * The FINISH barrier: resolves when the queue is drained, and answers
   * whether every part made it. `false` means finish must NOT be called —
   * a call finished with a missing part would transcribe with a silent hole
   * where nothing marks the gap as ours.
   */
  async settle(): Promise<{ clean: boolean; failed: number }> {
    await this.chain;
    return { clean: this.failedJobs.length === 0, failed: this.failedJobs.length };
  }
}
