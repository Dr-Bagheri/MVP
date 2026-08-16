import { afterEach, describe, expect, it, vi } from "vitest";

import { createUploadsRepo } from "../src/api/uploads.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * The upload surface's logic, on fakes at the honest altitude: the fake is
 * the DATABASE ANSWER and the STORAGE ANSWER, never the repo's own
 * composition. RLS/grant behaviour is not provable here and is not claimed —
 * the routes ride the same withIdentity path every proven surface uses.
 *
 * What IS proved: ordering (bytes before row — the purge deadlock's mirror),
 * the path cage on registerPart (the one caller-supplied value that touches
 * storage), the enqueue contract {callId, ownerId, partId} (M7: ownerId
 * stamped while a genuine caller is present), and that every refusal is a
 * NAMED refusal, not a stub.
 */

const CALL_ID = "11111111-2222-4333-8444-555555555555";

const identity: Identity = {
  userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  orgId: "99999999-8888-4777-8666-555555555555",
  role: "member",
} as unknown as Identity;

interface Recorded {
  sql: string;
  params: unknown[];
}

/** A db whose answers are scripted per-SQL-shape; every call is recorded. */
function fakeDb(answer: (sql: string, params: unknown[]) => unknown[]): {
  db: Db;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const tx = {
    unsafe: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve(answer(sql, params));
    },
  } as unknown as SqlTx;
  const db = {
    withIdentity: (_who: Identity, fn: (tx: SqlTx) => unknown) => fn(tx),
    withoutIdentity: (fn: (tx: SqlTx) => unknown) => fn(tx),
  } as unknown as Db;
  return { db, calls };
}

const CONFIG = { storageUrl: "https://project.supabase.co", serviceKey: "k" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn((url: string | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init)));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function recordingCall(sql: string): unknown[] {
  if (sql.includes("select id, status from echo.call")) {
    return [{ id: CALL_ID, status: "recording" }];
  }
  if (sql.includes("insert into echo.call_part")) return [{ id: "part-1" }];
  if (sql.includes("pgmq.send")) return [{ send: 1 }];
  return [];
}

describe("createCall", () => {
  it("refuses an invented scope with a sentence, before any write", async () => {
    const { db, calls } = fakeDb(() => []);
    const repo = createUploadsRepo(db, CONFIG);
    await expect(
      repo.createCall(identity, { source: "web", scope: "everyone", title: undefined }),
    ).rejects.toThrow(/scope/);
    expect(calls).toHaveLength(0);
  });
});

describe("uploadPart", () => {
  it("puts the BYTES in storage before the row exists (the orphan that costs pennies, not the one that retries forever)", async () => {
    const { db, calls } = fakeDb(recordingCall);
    const order: string[] = [];
    stubFetch(() => {
      // at upload time the only db traffic so far is the status read —
      // the part row must not exist yet
      order.push(...calls.map((c) => (c.sql.includes("call_part") ? "row" : "read")));
      return new Response("{}", { status: 200 });
    });
    const repo = createUploadsRepo(db, CONFIG);
    await repo.uploadPart(identity, CALL_ID, {
      idx: 0, offsetMs: 0, contentType: "audio/webm", bytes: Buffer.from("aa"),
    });
    expect(order).not.toContain("row");
    expect(calls.some((c) => c.sql.includes("insert into echo.call_part"))).toBe(true);
  });

  it("enqueues M7's exact message: callId + ownerId + partId, ownerId stamped from the CALLER", async () => {
    const { db, calls } = fakeDb(recordingCall);
    stubFetch(() => new Response("{}", { status: 200 }));
    const repo = createUploadsRepo(db, CONFIG);
    await repo.uploadPart(identity, CALL_ID, {
      idx: 2, offsetMs: 3_600_000, contentType: "audio/webm", bytes: Buffer.from("aa"),
    });
    const enqueue = calls.find((c) => c.sql.includes("pgmq.send"));
    expect(enqueue).toBeDefined();
    const payload = JSON.parse(String(enqueue!.params[1])) as Record<string, unknown>;
    expect(payload).toEqual({ callId: CALL_ID, ownerId: identity.userId, partId: "part-1" });
  });

  it("names the refusal when the call is past recording", async () => {
    const { db } = fakeDb((sql) =>
      sql.includes("select id, status") ? [{ id: CALL_ID, status: "processing" }] : []);
    stubFetch(() => new Response("{}", { status: 200 }));
    const repo = createUploadsRepo(db, CONFIG);
    await expect(
      repo.uploadPart(identity, CALL_ID, {
        idx: 0, offsetMs: 0, contentType: "audio/webm", bytes: Buffer.from("aa"),
      }),
    ).rejects.toMatchObject({ code: "call_not_recording" });
  });

  it("refuses an audio type the pipeline cannot take, naming the ones it can", async () => {
    const { db } = fakeDb(recordingCall);
    const fetchSpy = stubFetch(() => new Response("{}", { status: 200 }));
    const repo = createUploadsRepo(db, CONFIG);
    await expect(
      repo.uploadPart(identity, CALL_ID, {
        idx: 0, offsetMs: 0, contentType: "video/mp4", bytes: Buffer.from("aa"),
      }),
    ).rejects.toMatchObject({ code: "unsupported_audio" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an unconfigured deployment answers with a NAMED refusal, never a stub", async () => {
    const { db } = fakeDb(recordingCall);
    const repo = createUploadsRepo(db, {});
    await expect(
      repo.uploadPart(identity, CALL_ID, {
        idx: 0, offsetMs: 0, contentType: "audio/webm", bytes: Buffer.from("aa"),
      }),
    ).rejects.toMatchObject({ code: "uploads_unconfigured" });
  });
});

describe("signPart", () => {
  it("mints a full https URL under the project host, path caged to the call", async () => {
    const { db } = fakeDb(recordingCall);
    stubFetch((url) => {
      expect(url).toContain("/storage/v1/object/upload/sign/call-audio/");
      return new Response(
        JSON.stringify({ url: `/object/upload/sign/call-audio/${CALL_ID}/0-x.webm?token=t` }),
        { status: 200 },
      );
    });
    const repo = createUploadsRepo(db, CONFIG);
    const signed = await repo.signPart(identity, CALL_ID, { idx: 0, contentType: "audio/webm" });
    expect(signed.upload_url).toMatch(/^https:\/\/project\.supabase\.co\/storage\/v1\/object\/upload\/sign\//);
    expect(signed.path.startsWith(`${CALL_ID}/`)).toBe(true);
    expect(signed.path.endsWith(".webm")).toBe(true);
  });

  it("a signer the storage refuses is a named refusal, status only", async () => {
    const { db } = fakeDb(recordingCall);
    stubFetch(() => new Response("secret-path-in-body", { status: 403 }));
    const repo = createUploadsRepo(db, CONFIG);
    await expect(
      repo.signPart(identity, CALL_ID, { idx: 0, contentType: "audio/webm" }),
    ).rejects.toMatchObject({ code: "storage_refused" });
  });
});

describe("registerPart", () => {
  it("refuses a path outside the call's own prefix — the cage is the security", async () => {
    const { db } = fakeDb(recordingCall);
    const fetchSpy = stubFetch(() => new Response(null, { status: 200 }));
    const repo = createUploadsRepo(db, CONFIG);
    await expect(
      repo.registerPart(identity, CALL_ID, {
        idx: 0, offsetMs: 0, path: "someone-elses-call/0-x.webm",
      }),
    ).rejects.toThrow(/does not belong/);
    await expect(
      repo.registerPart(identity, CALL_ID, {
        idx: 0, offsetMs: 0, path: `${CALL_ID}/../other/0-x.webm`,
      }),
    ).rejects.toThrow(/does not belong/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the object must EXIST before the row does — absent object, no row, named code", async () => {
    const { db, calls } = fakeDb(recordingCall);
    stubFetch(() => new Response(null, { status: 404 }));
    const repo = createUploadsRepo(db, CONFIG);
    await expect(
      repo.registerPart(identity, CALL_ID, {
        idx: 0, offsetMs: 0, path: `${CALL_ID}/0-x.webm`,
      }),
    ).rejects.toMatchObject({ code: "object_missing" });
    expect(calls.some((c) => c.sql.includes("insert into echo.call_part"))).toBe(false);
  });

  it("byte_size comes from storage's HEAD, never from the caller", async () => {
    const { db, calls } = fakeDb(recordingCall);
    stubFetch(() =>
      new Response(null, { status: 200, headers: { "content-length": "4242" } }));
    const repo = createUploadsRepo(db, CONFIG);
    const result = await repo.registerPart(identity, CALL_ID, {
      idx: 1, offsetMs: 1_800_000, path: `${CALL_ID}/1-x.webm`,
    });
    expect(result.part_id).toBe("part-1");
    const insert = calls.find((c) => c.sql.includes("insert into echo.call_part"));
    expect(insert!.params).toContain(4242);
    // and the tail is the same M7 enqueue as the direct path
    const enqueue = calls.find((c) => c.sql.includes("pgmq.send"));
    const payload = JSON.parse(String(enqueue!.params[1])) as Record<string, unknown>;
    expect(payload).toEqual({ callId: CALL_ID, ownerId: identity.userId, partId: "part-1" });
  });
});

describe("finish", () => {
  it("finishing twice is the same answer, not a fault", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("update echo.call set status")) return []; // already flipped
      if (sql.includes("select id, status")) return [{ id: CALL_ID, status: "processing" }];
      return [];
    });
    const repo = createUploadsRepo(db, CONFIG);
    const result = await repo.finish(identity, CALL_ID);
    expect(result).toEqual({ id: CALL_ID, status: "processing" });
  });

  it("a call that is not there is not_found, not a silent success", async () => {
    const { db } = fakeDb(() => []);
    const repo = createUploadsRepo(db, CONFIG);
    await expect(repo.finish(identity, CALL_ID)).rejects.toThrow(/not found/);
  });
});
