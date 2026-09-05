import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import middleware from "./middleware";
import { SESSION_COOKIE } from "./server/session-cookie";

/**
 * The front-door gate (user directive 2026-08-16; hardened 2026-08-18):
 * signed out, NOTHING renders but the auth surfaces — and "signed out" now
 * includes an EXPIRED session whose refresh is refused, which is the state
 * the presence-only gate waved through for 29 days.
 *
 * These tests drive the real middleware with real NextRequests. The refresh
 * hop is stubbed at global.fetch — the one seam the edge runtime offers —
 * and each stub is asserted to have actually been consulted where the
 * branch under test requires it (a vacuously-green gate test is how the
 * first gate shipped).
 */

/** A session cookie the way writeSession spells it. */
const cookieValue = (expiresInMs: number, withRefresh = true) =>
  JSON.stringify({
    accessToken: "jwt-access",
    refreshToken: withRefresh ? "jwt-refresh" : undefined,
    expiresAt: Date.now() + expiresInMs,
  });

const req = (path: string, cookie?: string) => {
  const r = new NextRequest(`https://app.neurai.pt${path}`);
  if (cookie !== undefined) r.cookies.set(SESSION_COOKIE, cookie);
  return r;
};

const redirectTarget = (res: Response) => new URL(res.headers.get("location")!).pathname;

const LIVE = () => cookieValue(60 * 60 * 1000);
const EXPIRED = () => cookieValue(-60 * 1000);

/*
 * The middleware reads NEXT_PUBLIC_* through process.env (inlined in a real
 * build); vitest needs them present for the refresh branch to be reachable.
 */
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");

const stubRefresh = (impl: () => Response | Promise<Response>) => {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signed OUT — the login page is the only destination", () => {
  it.each(["/fa", "/fa/echo", "/fa/settings", "/fa/management/users", "/en/echo", "/"])(
    "%s redirects to sign-in",
    async (path) => {
      const res = await middleware(req(path));
      expect(res.status).toBeGreaterThanOrEqual(307);
      expect(redirectTarget(res)).toMatch(/\/(fa|en)\/sign-in$/);
    },
  );

  it("preserves the locale in the redirect — an English visitor lands on English sign-in", async () => {
    const res = await middleware(req("/en/management"));
    expect(redirectTarget(res)).toBe("/en/sign-in");
  });

  it("a garbage cookie is not a session — redirected, and the cookie is deleted", async () => {
    const res = await middleware(req("/fa/echo", "present"));
    expect(redirectTarget(res)).toBe("/fa/sign-in");
    // the delete rides the redirect as an expiring set-cookie
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
  });

  it.each(["/fa/sign-in", "/fa/sign-up", "/fa/forgot", "/fa/reset", "/fa/pending", "/fa/suspended"])(
    "%s stays reachable — it is how a session comes to exist",
    async (path) => {
      const res = await middleware(req(path));
      // next-intl answers these itself (200 rewrite or its own locale handling),
      // never a bounce to sign-in
      const loc = res.headers.get("location");
      if (loc) expect(new URL(loc).pathname).not.toMatch(/sign-in$/);
    },
  );
});

describe("signed IN — the gate opens, the wall stays core's", () => {
  it.each(["/fa", "/fa/echo", "/fa/settings"])("%s passes through on a live token", async (path) => {
    const fetchSpy = stubRefresh(() => {
      throw new Error("a live token must not be refreshed on every navigation");
    });
    const res = await middleware(req(path, LIVE()));
    const loc = res.headers.get("location");
    if (loc) expect(new URL(loc).pathname).not.toMatch(/sign-in$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["/fa/echo", "/en/settings"])(
    "%s is served no-store — a cached copy would outlive the session (Back after sign-out)",
    async (path) => {
      const res = await middleware(req(path, LIVE()));
      expect(res.headers.get("cache-control")).toContain("no-store");
    },
  );

  it("the sign-in page itself stays cacheable — it holds nothing to protect", async () => {
    const res = await middleware(req("/fa/sign-in"));
    expect(res.headers.get("cache-control") ?? "").not.toContain("no-store");
  });
});

describe("the session's END is the gate's business — the hardening", () => {
  it("an expired token with a working refresh walks in, wearing the renewed cookie", async () => {
    const fetchSpy = stubRefresh(() =>
      Response.json({ access_token: "fresh", refresh_token: "fresh-r", expires_in: 3600 }),
    );
    const res = await middleware(req("/fa/echo", EXPIRED()));
    const loc = res.headers.get("location");
    if (loc) expect(new URL(loc).pathname).not.toMatch(/sign-in$/);
    expect(fetchSpy).toHaveBeenCalledOnce();
    // the renewed session is set on THIS response — no second bounce
    expect(res.headers.get("set-cookie")).toContain("fresh");
  });

  it("an expired token whose refresh is REFUSED is signed out — this is 'cannot go in anymore'", async () => {
    const fetchSpy = stubRefresh(
      () => new Response(JSON.stringify({ error_description: "revoked" }), { status: 400 }),
    );
    const res = await middleware(req("/fa/echo", EXPIRED()));
    expect(redirectTarget(res)).toBe("/fa/sign-in");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("an expired token with no refresh token is simply signed out", async () => {
    const res = await middleware(req("/fa/echo", cookieValue(-1000, false)));
    expect(redirectTarget(res)).toBe("/fa/sign-in");
  });

  it("an auth-provider OUTAGE does not sign the userbase out — an unexpired token passes", async () => {
    stubRefresh(() => new Response("bad gateway", { status: 502 }));
    // inside the refresh margin but not yet expired
    const res = await middleware(req("/fa/echo", cookieValue(30_000)));
    const loc = res.headers.get("location");
    if (loc) expect(new URL(loc).pathname).not.toMatch(/sign-in$/);
  });
});
