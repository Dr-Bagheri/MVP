/**
 * SEED JOBS (M52, 2026-09-09) — the in-memory ledger that lets a four-minute
 * seed answer its POST in a millisecond.
 *
 * The console pressed "create" and watched a button say "Seeding…" for four
 * minutes, pressed it again, and got a 409 from the second door. A seed is
 * hundreds of database round trips and a handful of storage copies, and the
 * only honest thing a screen can show over that span is where the seed
 * actually IS — so the engine now reports its stages as it passes them, and
 * this ledger is where those reports land: one entry per running seed, keyed
 * by a job id the POST hands back at once.
 *
 * Three rules, each carrying a reason:
 *
 *  - THE RESULT IS READ ONCE. A create's result holds the presenter's
 *    password, which core generates, returns and never stores. Stashing it in
 *    a map until it is polled is the same promise stretched over two
 *    requests — and it holds only if the GET that delivers a finished job
 *    also deletes it. A second GET is a 404, never a second copy.
 *
 *  - ONE SEED PER NAME. The double press was the whole incident: the second
 *    POST reached the door while the first was still writing. `start` refuses
 *    a name that is already running with a message that says so, and the
 *    name is compared the way `echo.org`'s uniqueness will compare it.
 *
 *  - THE LEDGER IS BOUNDED AND FORGETS. An entry nobody reads would live for
 *    ever in a process that runs for weeks, and a finished one carries a
 *    password. Finished entries expire ten minutes after they finish, and the
 *    map refuses to grow past `max` — swept lazily, on every start and read,
 *    with an injectable clock so the rule is testable without waiting.
 */

import { ConflictError } from "../errors.ts";
import type { SeedProgress } from "./engine.ts";

export type { SeedProgress };

export type SeedJobKind = "create" | "reseed";

/** The live picture the console polls. */
export interface SeedJobProgress {
  stage: string | null;
  stages: readonly string[];
  done_stages: number;
  total_stages: number;
  started_at: string;
}

export interface SeedJobError {
  message: string;
  code?: string;
}

/** One poll's answer. `result` and `error` appear exactly once each. */
export interface SeedJobView extends SeedJobProgress {
  id: string;
  kind: SeedJobKind;
  name: string;
  status: "running" | "done" | "failed";
  finished_at: string | null;
  result?: unknown;
  error?: SeedJobError;
}

/** What the POST answers with, instead of the seed. */
export interface SeedJobStart {
  job_id: string;
  stages: readonly string[];
  started_at: string;
}

interface Entry {
  id: string;
  kind: SeedJobKind;
  name: string;
  nameKey: string;
  ownerId: string;
  stages: readonly string[];
  stage: string | null;
  doneStages: number;
  startedAt: Date;
  finishedAt: Date | null;
  status: "running" | "done" | "failed";
  result: unknown;
  error: SeedJobError | null;
  /** tracked so a test (or a shutdown) can wait for the seed to settle */
  settled: Promise<void>;
}

export interface SeedJobsOptions {
  now?: () => Date;
  /** how long a FINISHED job waits to be read before it is forgotten */
  ttlMs?: number;
  /** the most entries the ledger will hold, running ones included */
  max?: number;
  newId?: () => string;
}

const TEN_MINUTES = 10 * 60 * 1000;

/** The name as the door's uniqueness sees it — trimmed, case-folded. */
export const seedNameKey = (name: string): string => name.trim().toLowerCase();

export function createSeedJobs(options: SeedJobsOptions = {}) {
  const clock = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? TEN_MINUTES;
  const max = options.max ?? 20;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const entries = new Map<string, Entry>();

  /** Forget every finished job that has sat unread past its ttl. */
  function sweep(): void {
    const now = clock().getTime();
    for (const [id, entry] of entries) {
      if (entry.finishedAt !== null && now - entry.finishedAt.getTime() >= ttlMs) {
        entries.delete(id);
      }
    }
  }

  function running(nameKey: string): Entry | undefined {
    for (const entry of entries.values()) {
      if (entry.status === "running" && entry.nameKey === nameKey) return entry;
    }
    return undefined;
  }

  /**
   * Begin a seed. `run` receives the progress reporter and is started at
   * once; its promise is tracked here and never left to reject unobserved.
   */
  function start<T>(input: {
    kind: SeedJobKind;
    name: string;
    ownerId: string;
    stages: readonly string[];
    run: (progress: SeedProgress) => Promise<T>;
  }): SeedJobStart {
    sweep();
    const nameKey = seedNameKey(input.name);
    if (running(nameKey) !== undefined) {
      throw new ConflictError(
        `a seed for this name is already running — wait for it to finish, or watch it from the Demo tab`,
        { code: "demo_seed_running" },
      );
    }
    if (entries.size >= max) {
      /* make room from the finished end first: those have been read or are
         merely waiting to expire, and a running seed must never be dropped */
      const finished = [...entries.values()]
        .filter((e) => e.finishedAt !== null)
        .sort((a, b) => a.finishedAt!.getTime() - b.finishedAt!.getTime());
      for (const entry of finished) {
        if (entries.size < max) break;
        entries.delete(entry.id);
      }
      if (entries.size >= max) {
        throw new ConflictError("too many demo seeds are running at once — wait for one to finish", {
          code: "demo_seeds_saturated",
        });
      }
    }

    const id = newId();
    const startedAt = clock();
    const entry: Entry = {
      id, kind: input.kind, name: input.name, nameKey, ownerId: input.ownerId,
      stages: [...input.stages], stage: null, doneStages: 0,
      startedAt, finishedAt: null, status: "running",
      result: undefined, error: null,
      settled: Promise.resolve(),
    };
    const progress: SeedProgress = (stage) => {
      if (entry.status !== "running") return;
      const at = entry.stages.indexOf(stage);
      /* a stage the engine did not announce is still shown by name; the
         count only moves for the ones it promised, so it cannot overshoot */
      entry.stage = stage;
      if (at >= 0) entry.doneStages = Math.max(entry.doneStages, at);
    };
    /* through a resolved promise so a `run` that throws before its first
       await lands in the ledger as a failed job, never out of `start` after
       the entry is already reachable */
    entry.settled = Promise.resolve().then(() => input.run(progress)).then(
      (result) => {
        entry.status = "done";
        entry.result = result;
        entry.stage = null;
        entry.doneStages = entry.stages.length;
        entry.finishedAt = clock();
      },
      (cause: unknown) => {
        entry.status = "failed";
        entry.error = {
          message: cause instanceof Error ? cause.message : String(cause),
          ...(typeof (cause as { code?: unknown })?.code === "string"
            ? { code: (cause as { code: string }).code }
            : {}),
        };
        entry.finishedAt = clock();
      },
    );
    entries.set(id, entry);
    return { job_id: id, stages: entry.stages, started_at: startedAt.toISOString() };
  }

  /**
   * One poll. A running job is described; a finished one is described and
   * FORGOTTEN in the same call — the read-once rule. `null` means the ledger
   * does not know the id: expired, already delivered, or a process that
   * restarted underneath it. Another root's job reads as unknown too.
   */
  function read(id: string, ownerId: string): SeedJobView | null {
    sweep();
    const entry = entries.get(id);
    if (entry === undefined || entry.ownerId !== ownerId) return null;
    const view: SeedJobView = {
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      status: entry.status,
      stage: entry.stage,
      stages: entry.stages,
      done_stages: entry.doneStages,
      total_stages: entry.stages.length,
      started_at: entry.startedAt.toISOString(),
      finished_at: entry.finishedAt === null ? null : entry.finishedAt.toISOString(),
    };
    if (entry.status === "running") return view;
    entries.delete(id);
    if (entry.status === "done") view.result = entry.result;
    else if (entry.error !== null) view.error = entry.error;
    return view;
  }

  /** Is a seed with this name in flight? */
  const isRunning = (name: string): boolean => running(seedNameKey(name)) !== undefined;

  /** Wait for a job's seed to settle — for tests and an orderly shutdown. */
  const settled = (id: string): Promise<void> => entries.get(id)?.settled ?? Promise.resolve();

  return {
    start, read, isRunning, settled, sweep,
    get size() { return entries.size; },
  };
}

export type SeedJobs = ReturnType<typeof createSeedJobs>;
