/**
 * The purge job — the one operation in this product with no undo.
 *
 * The assertions that matter are about ORDER and REFUSAL, because the database
 * already guarantees *which* rows (db/0013's window predicate) and testing that
 * here would be a second copy of a rule that lives in SQL.
 */
import { describe, expect, it, vi } from "vitest";

import { purgeCall, runPurge, type PurgeStorage } from "../src/purge/purge.ts";
import { createStorage } from "../src/purge/main.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const CALL = "c4000000-0000-4000-8000-000000000004";

/** Records every statement and object delete in the order they happened. */
function harness(opts: { parts?: { storage_bucket: string; storage_path: string | null }[]; storageFails?: unknown } = {}) {
  const order: string[] = [];
  const tx = {
    unsafe: async (sql: string) => {
      const table = /from echo\.(\w+)/.exec(sql)?.[1] ?? "?";
      order.push(sql.trimStart().startsWith("select") ? `select:${table}` : `delete:${table}`);
      if (sql.includes("from echo.call_part") && sql.trimStart().startsWith("select")) {
        return opts.parts ?? [{ storage_bucket: "call-audio", storage_path: "a.webm" }];
      }
      if (sql.includes("from echo.call") && sql.trimStart().startsWith("select")) {
        return [{ id: CALL }];
      }
      return [];
    },
  };
  const storage: PurgeStorage = {
    remove: vi.fn(async (bucket: string, path: string) => {
      order.push(`object:${bucket}/${path}`);
      if (opts.storageFails) throw opts.storageFails;
      return true;
    }),
  };
  const begin = async <T,>(fn: (t: never) => Promise<T>) => fn(tx as never);
  return { order, storage, begin, tx: tx as never };
}

describe("purgeCall — objects before rows", () => {
  it("deletes the stored audio BEFORE the row that points at it", async () => {
    // The row is the retry token: `call_part.storage_path` is the only pointer
    // to the object. Rows-first leaves audio that nothing can find and nobody
    // knows to look for — the recording surviving after the user was told it
    // was purged. This ordering is the whole privacy promise.
    const { order, storage, tx } = harness();
    await purgeCall(tx, storage, CALL, silent);

    expect(order.indexOf("object:call-audio/a.webm")).toBeLessThan(order.indexOf("delete:call_part"));
    expect(order.indexOf("object:call-audio/a.webm")).toBeLessThan(order.indexOf("delete:call"));
  });

  it("deletes rows in the dependency order db/0014 specifies", async () => {
    const { order, storage, tx } = harness();
    await purgeCall(tx, storage, CALL, silent);

    expect(order.filter((o) => o.startsWith("delete:"))).toEqual([
      "delete:summary",
      "delete:agent_run",
      "delete:transcript_segment",
      "delete:call_speaker",
      "delete:call_part",
      "delete:call",
    ]);
  });

  it("treats an already-absent object as success and still deletes the rows", async () => {
    // A retry after partial success is NORMAL here, and a part marked missing
    // never had audio at all. If absence stopped the call, the second run of a
    // recovered purge would be impossible — and objects-before-rows guarantees
    // there IS a second run to recover.
    //
    // This test used to hand the adapter an error with `{status: 404}` and
    // assert that purgeCall counted it as missing. That was a test of a belief
    // rather than of the system: the real provider answers 400 and never 404,
    // so the branch it "covered" could not execute. Absence is now the
    // adapter's decision (it is the only layer that knows how its provider
    // spells the word) and reaches here as a plain `false`.
    const { order, tx } = harness();
    const counts = await purgeCall(tx, { remove: async () => false }, CALL, silent);
    expect(counts).toMatchObject({ objectsMissing: 1, objectsDeleted: 0 });
    expect(order).toContain("delete:call");
  });

  it("STOPS before deleting rows when storage genuinely fails", async () => {
    // Proceeding would strand the object with nothing pointing at it — exactly
    // the failure the ordering exists to prevent.
    const { order, storage, tx } = harness({ storageFails: Object.assign(new Error("503"), { status: 503 }) });

    await expect(purgeCall(tx, storage, CALL, silent)).rejects.toThrow();
    expect(order.filter((o) => o.startsWith("delete:"))).toEqual([]);
  });

  it("skips parts that never had audio", async () => {
    const { storage, tx } = harness({ parts: [{ storage_bucket: "call-audio", storage_path: null }] });
    const counts = await purgeCall(tx, storage, CALL, silent);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ objectsDeleted: 0, objectsMissing: 0 });
  });
});

describe("blast radius", () => {
  it("REFUSES a run larger than the ceiling, and says why", async () => {
    // The policies bound which rows, never how many. Everything expiring at
    // once is far likelier to be a clock or `purge_after` fault than a real
    // backlog — and this is the one operation with no undo.
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `call-${i}` }));
    const begin = async <T,>(fn: (t: never) => Promise<T>) =>
      fn({ unsafe: async () => many } as never);
    const storage: PurgeStorage = { remove: vi.fn() };

    const result = await runPurge(begin, storage, { maxCallsPerRun: 10, batchSize: 5 }, silent);

    expect(result.callsPurged).toBe(0);
    expect(result.refused).toMatch(/refusing to purge/);
    expect(result.refused).toMatch(/clock or purge_after/);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("distinguishes a refusal from an empty run", async () => {
    // A quiet zero reads as "nothing was expired". The two need opposite
    // responses, so they must not look the same.
    const begin = async <T,>(fn: (t: never) => Promise<T>) => fn({ unsafe: async () => [] } as never);
    const result = await runPurge(begin, { remove: vi.fn() }, { maxCallsPerRun: 10, batchSize: 5 }, silent);

    expect(result).toMatchObject({ callsPurged: 0, refused: null });
  });

  it("one failing call does not hold the others hostage", async () => {
    const calls = [{ id: "a" }, { id: "b" }, { id: "c" }];
    let seen = 0;
    const begin = async <T,>(fn: (t: never) => Promise<T>) => {
      const tx = {
        unsafe: async (sql: string) => {
          if (sql.includes("order by purge_after")) return calls;
          if (sql.trimStart().startsWith("select")) {
            seen++;
            if (seen === 2) throw new Error("storage unreachable");
            return [];
          }
          return [];
        },
      };
      return fn(tx as never);
    };

    const result = await runPurge(begin, { remove: vi.fn() }, { maxCallsPerRun: 10, batchSize: 5 }, silent);
    expect(result.callsPurged).toBe(2);
  });
});

/**
 * The storage adapter, against the response Supabase ACTUALLY sends.
 *
 * These fixtures are transcribed from a live call to the dev project, not
 * written from what the API ought to do — which is the whole point, because
 * what it ought to do and what it does disagree. Deleting an object that is
 * not there answers 400, with the 404 in the body. The first version of this
 * adapter tested `status === 404`, so its already-gone branch could never run:
 * an expired call whose object had already been removed would be retried on
 * every pass and deleted on none, forever.
 *
 * That state is not exotic. Objects are deleted before rows precisely so that
 * an interrupted run leaves exactly this behind.
 */
describe("storage adapter — what 'already gone' actually looks like", () => {
  const withFetch = async (response: Response, run: () => Promise<unknown>) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => response) as typeof fetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  const supabaseNotFound = () =>
    new Response(
      JSON.stringify({
        statusCode: "404",
        error: "not_found",
        message: "Object not found",
        code: "NoSuchKey",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );

  it("treats Supabase's 400-with-a-404-inside as already gone", async () => {
    const storage = createStorage("https://project.supabase.co", "key");
    const removed = await withFetch(supabaseNotFound(), () => storage.remove("call-audio", "a/b.webm"));
    // false = "it was not there", which is success and is COUNTED separately.
    expect(removed).toBe(false);
  });

  it("still reports a real deletion as a deletion", async () => {
    const storage = createStorage("https://project.supabase.co", "key");
    const removed = await withFetch(new Response("{}", { status: 200 }), () =>
      storage.remove("call-audio", "a/b.webm"),
    );
    expect(removed).toBe(true);
  });

  it("does NOT swallow a genuine 400 — an unreadable failure must still fail", async () => {
    const storage = createStorage("https://project.supabase.co", "key");
    await expect(
      withFetch(new Response("not json at all", { status: 400 }), () =>
        storage.remove("call-audio", "a/b.webm"),
      ),
    ).rejects.toThrow(/400/);
  });

  it("does not treat a REJECTED KEY as absence — and the real shape is a 400", async () => {
    // This test used to send `status: 403`, which is not how a rejected key
    // arrives. Backend 3 measured it while verifying the rotated credential:
    //
    //   400 Bad Request
    //   {"statusCode":"403","error":"Unauthorized","code":"AccessDenied"}
    //
    // Same HTTP status as "object not found", opposite meaning. A rule any
    // looser than the three discriminating fields — "400 means gone" — would
    // read a dead key as a completed deletion, delete the row, and leave the
    // audio orphaned in the bucket on EVERY call it touched. The old fixture
    // could not have caught that, because it tested a response the API does
    // not send: my belief about a 403, not a 403.
    const storage = createStorage("https://project.supabase.co", "key");
    const deadKey = () =>
      new Response(
        JSON.stringify({ statusCode: "403", error: "Unauthorized", code: "AccessDenied" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    await expect(
      withFetch(deadKey(), () => storage.remove("call-audio", "a/b.webm")),
    ).rejects.toThrow(/AccessDenied/);
  });

  it("names a MISSING credential differently from a rejected one", async () => {
    // Also measured, also a 400. Three cases, three codes — which is what
    // makes the probe discriminating rather than merely red, and what stops
    // "the purge is failing" meaning three different things at once.
    const storage = createStorage("https://project.supabase.co", "");
    const noCredential = () =>
      new Response(
        JSON.stringify({
          statusCode: "400",
          error: "InvalidRequest",
          message: "headers must have required property 'authorization'",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    await expect(
      withFetch(noCredential(), () => storage.remove("call-audio", "a/b.webm")),
    ).rejects.toThrow(/400/);
  });

  it("carries the provider code into the error, so a 400 is diagnosable", async () => {
    // Reporting `(400)` alone sends whoever is paged at 4am to inspect our
    // request payload when the answer is that the key is dead.
    const storage = createStorage("https://project.supabase.co", "key");
    const err = await withFetch(
      new Response(JSON.stringify({ statusCode: "403", error: "Unauthorized", code: "AccessDenied" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
      () => storage.remove("call-audio", "a/b.webm").catch((e: Error) => e),
    );
    expect((err as Error).message).toContain("AccessDenied");
    // The path is the customer's business and never appears.
    expect((err as Error).message).not.toContain("a/b.webm");
  });
});

describe("counting the two kinds of success", () => {
  it("separates objects it deleted from objects that were already gone", async () => {
    const { begin, tx } = harness({
      parts: [
        { storage_bucket: "call-audio", storage_path: "present.webm" },
        { storage_bucket: "call-audio", storage_path: "absent.webm" },
      ],
    });
    const storage: PurgeStorage = {
      remove: async (_bucket, path) => path === "present.webm",
    };
    const counts = await purgeCall(tx, storage, CALL, silent);
    // Collapsing these into one number is how "the bucket was already empty"
    // gets read as "a hundred recordings were deleted".
    expect(counts).toEqual({ objectsDeleted: 1, objectsMissing: 1 });
    void begin;
  });
});
