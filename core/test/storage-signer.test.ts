/**
 * The storage signer. Two of these tests are the module's whole reason for
 * existing: it must refuse to CONSTRUCT when unconfigured, and it must never
 * put a credential into an error (there is nothing to assert about logging
 * because it does not log — asserted by absence in the source).
 */
import { describe, expect, it, vi } from "vitest";

import {
  createStorageSigner, StorageConfigError, StorageSignError, storageSignerFromEnv,
} from "../src/storage/signer.ts";

const URL_BASE = "https://proj.supabase.co";
const KEY = "service-key-do-not-log";

const okFetch = (signed = "/object/sign/audio/o/c/p.ogg?token=abc") =>
  vi.fn(async () => new Response(JSON.stringify({ signedURL: signed }), { status: 200 }));

const signer = (fetchImpl: typeof fetch) =>
  createStorageSigner({ url: URL_BASE, serviceKey: KEY, fetchImpl });

describe("refuses to start half-configured", () => {
  it("throws at CONSTRUCTION, not per job", async () => {
    // A signer that constructs and then throws on every part dead-letters the
    // whole queue and reads as a pipeline bug for an hour.
    expect(() => createStorageSigner({ url: "", serviceKey: KEY })).toThrow(StorageConfigError);
    expect(() => createStorageSigner({ url: URL_BASE, serviceKey: "" })).toThrow(StorageConfigError);
    expect(() => createStorageSigner({ url: "   ", serviceKey: "  " })).toThrow(StorageConfigError);
  });

  it("names the missing variable and quotes neither value", () => {
    try {
      createStorageSigner({ url: URL_BASE, serviceKey: "" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("SUPABASE_SERVICE_KEY");
      expect((error as Error).message).not.toContain(URL_BASE);
    }
  });

  it("rejects a plaintext base — the minted URL is a credential in flight", () => {
    expect(() => createStorageSigner({ url: "http://proj.supabase.co", serviceKey: KEY }))
      .toThrow(/https/);
  });

  it("reads the environment only through the env helper", () => {
    expect(() => storageSignerFromEnv({} as NodeJS.ProcessEnv)).toThrow(StorageConfigError);
    expect(storageSignerFromEnv({ SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_KEY: KEY } as NodeJS.ProcessEnv))
      .toBeDefined();
  });
});

describe("signing", () => {
  it("returns an absolute URL, joining Supabase's project-relative answer", async () => {
    const url = await signer(okFetch() as unknown as typeof fetch)
      .signDownload("audio", "org/call/part.ogg", 3600);
    expect(url).toBe(`${URL_BASE}/storage/v1/object/sign/audio/o/c/p.ogg?token=abc`);
  });

  it("passes an absolute answer through unchanged", async () => {
    const absolute = "https://cdn.example.com/x?token=abc";
    const url = await signer(okFetch(absolute) as unknown as typeof fetch)
      .signDownload("audio", "a/b.ogg", 60);
    expect(url).toBe(absolute);
  });

  it("sends the key as a header and the TTL as the caller gave it", async () => {
    const fetchImpl = okFetch();
    await signer(fetchImpl as unknown as typeof fetch).signDownload("audio", "a/b.ogg", 1_800);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({ expiresIn: 1_800 });
  });

  it("encodes each path SEGMENT, keeping the separators", async () => {
    const fetchImpl = okFetch();
    await signer(fetchImpl as unknown as typeof fetch).signDownload("audio", "org a/call?1/p.ogg", 60);
    const [target] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(target).toContain("/object/sign/audio/org%20a/call%3F1/p.ogg");
  });

  it("refuses a TTL that defeats the point of signing", async () => {
    const s = signer(okFetch() as unknown as typeof fetch);
    await expect(s.signDownload("audio", "a.ogg", 0)).rejects.toBeInstanceOf(StorageSignError);
    await expect(s.signDownload("audio", "a.ogg", -1)).rejects.toBeInstanceOf(StorageSignError);
    // a week-long URL is not a signed URL; clamping silently would hide the
    // caller's mistake from the caller
    await expect(s.signDownload("audio", "a.ogg", 7 * 24 * 3600)).rejects.toThrow(/24h/);
  });

  it("refuses an empty bucket or path before making a request", async () => {
    const fetchImpl = okFetch();
    const s = signer(fetchImpl as unknown as typeof fetch);
    await expect(s.signDownload("", "a.ogg", 60)).rejects.toBeInstanceOf(StorageSignError);
    await expect(s.signDownload("audio", "///", 60)).rejects.toBeInstanceOf(StorageSignError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("a failure never carries a credential", () => {
  it("reports the status and NOT the response body", async () => {
    // the body of a failed sign can echo the path; of a successful one, the
    // signed URL itself
    const fetchImpl = vi.fn(async () => new Response("no such object: org/call/secret.ogg", { status: 404 }));
    try {
      await signer(fetchImpl as unknown as typeof fetch).signDownload("audio", "org/call/secret.ogg", 60);
      expect.unreachable("should have thrown");
    } catch (error) {
      // asserted POSITIVELY on the exact message: `rejects.not.toThrow(/…/)`
      // is the shape that passes whether or not the string is there
      expect((error as Error).message).toBe("storage: sign failed (404)");
    }
  });

  it("swallows the transport error's cause, which can hold the key", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(`connect failed to ${URL_BASE} with ${KEY}`); });
    try {
      await signer(fetchImpl as unknown as typeof fetch).signDownload("audio", "a.ogg", 60);
      expect.unreachable("should have thrown");
    } catch (error) {
      const text = `${(error as Error).message}${(error as Error).stack ?? ""}`;
      expect(text).not.toContain(KEY);
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it("treats a 200 with no url as a failure, not as an empty URL", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(signer(fetchImpl as unknown as typeof fetch).signDownload("audio", "a.ogg", 60))
      .rejects.toThrow(/no url/);
  });
});
