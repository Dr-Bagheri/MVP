import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/me` is fetched ONCE per page load.
 *
 * The defect this pins: `me()` was cached and `identityState()` was not, and
 * both ask the same endpoint — `PresenceDock` calls `identityState()` from a
 * mount effect on every route, so the hottest read in the product went out
 * twice on every navigation. Giving `identityState` its own cache key would
 * have made the second request *collapse with itself* and left the pair
 * costing two round trips, which is why the assertion here counts REQUESTS to
 * the endpoint rather than calls to either function.
 *
 * Verified red against the previous implementation (a raw `bff("/api/me")`
 * inside `identityState`): "one request" reported 2.
 *
 * The module cache is per-module-instance, so every case re-imports the
 * client fresh — a leaked cache from the previous test would make a later
 * "one request" pass for the wrong reason.
 */

const MEMBER = {
  id: "u-1",
  display_name: "سارا محمدی",
  display_name_en: "Sara Mohammadi",
  email: "sara@example.com",
  role: "member",
  status: "active",
  preferred_model: "google/gemini-3.1-pro",
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let calls: string[] = [];

async function freshClient() {
  vi.resetModules();
  return (await import("./client")) as typeof import("./client");
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (path: string, init?: RequestInit) => Response): void {
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    return Promise.resolve(handler(path, init));
  });
}

describe("/api/me is read once", () => {
  it("me() and identityState() share ONE request, in either order", async () => {
    stubFetch(() => jsonResponse(200, MEMBER));
    const { api } = await freshClient();

    const [me, identity] = await Promise.all([api.me(), api.identityState()]);

    expect(calls.filter((c) => c.endsWith("/api/me"))).toHaveLength(1);
    expect(me?.model_id).toBe("google/gemini-3.1-pro");
    expect(identity).toMatchObject({ state: "member" });
    expect(identity.state === "member" ? identity.me.model_id : null)
      .toBe("google/gemini-3.1-pro");

    /* the reverse order, and a serial pair, still ride the same answer */
    await api.identityState();
    await api.me();
    expect(calls.filter((c) => c.endsWith("/api/me"))).toHaveLength(1);
  });

  it("a 401 is a settled fact and is shared too — null and a signed-out state", async () => {
    stubFetch(() => jsonResponse(401, { kind: "no_session" }));
    const { api } = await freshClient();

    const [me, identity] = await Promise.all([api.me(), api.identityState()]);

    expect(calls.filter((c) => c.endsWith("/api/me"))).toHaveLength(1);
    expect(me).toBeNull();
    expect(identity).toEqual({ state: "signed_out" });
  });

  it("401 unknown_actor still reaches identityState as `unregistered`", async () => {
    stubFetch(() => jsonResponse(401, { kind: "unknown_actor" }));
    const { api } = await freshClient();
    expect(await api.identityState()).toEqual({ state: "unregistered" });
    /* me() reads the SAME refusal as "nobody signed in" — unchanged */
    expect(await api.me()).toBeNull();
  });

  it("403 pending/suspended keep their kind and their detail", async () => {
    stubFetch(() => jsonResponse(403, { kind: "pending", error: "در انتظار تأیید" }));
    const { api } = await freshClient();
    expect(await api.identityState()).toEqual({ state: "pending", detail: "در انتظار تأیید" });
    /* and me() still THROWS on a 403 — only 401 becomes null */
    await expect(api.me()).rejects.toThrow();
  });

  /*
   * The half that keeps the cache honest. A 500 is not a fact about who the
   * caller is; caching it would freeze a blip onto the identity for the whole
   * TTL. It must be evicted, which means the next call really does go out.
   */
  it("a 500 is NOT cached — the next call retries", async () => {
    let status = 500;
    stubFetch(() => (status === 500 ? jsonResponse(500, {}) : jsonResponse(200, MEMBER)));
    const { api } = await freshClient();

    await expect(api.me()).rejects.toThrow();
    status = 200;
    const me = await api.me();

    expect(calls.filter((c) => c.endsWith("/api/me"))).toHaveLength(2);
    expect(me?.id).toBe("u-1");
  });

  it("a write clears it — a saved profile is visible on the next read", async () => {
    let name = "سارا محمدی";
    stubFetch((_path, init) => {
      if (init?.method && init.method !== "GET") {
        name = "سارا رضایی";
        return jsonResponse(200, { ...MEMBER, display_name: name });
      }
      return jsonResponse(200, { ...MEMBER, display_name: name });
    });
    const { api } = await freshClient();

    expect((await api.me())?.display_name).toBe("سارا محمدی");
    await api.updateProfile({ display_name: "سارا رضایی" });
    expect((await api.me())?.display_name).toBe("سارا رضایی");
    /* two reads plus the write: the cache did not serve the stale name */
    expect(calls.filter((c) => c.endsWith("/api/me"))).toHaveLength(3);
  });
});
