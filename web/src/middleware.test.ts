import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import middleware from "./middleware";
import { SESSION_COOKIE } from "./server/session-cookie";

/**
 * The front-door gate (user directive 2026-08-16): signed out, NOTHING
 * renders but the auth surfaces. These tests drive the real middleware with
 * real NextRequests — deleting the gate turns the redirect assertions red.
 */

const req = (path: string, cookie = false) => {
  const r = new NextRequest(`https://app.neurai.pt${path}`);
  if (cookie) r.cookies.set(SESSION_COOKIE, "present");
  return r;
};

const redirectTarget = (res: Response) => new URL(res.headers.get("location")!).pathname;

describe("signed OUT — the login page is the only destination", () => {
  it.each(["/fa", "/fa/echo", "/fa/settings", "/fa/management/users", "/en/echo", "/"])(
    "%s redirects to sign-in",
    (path) => {
      const res = middleware(req(path));
      expect(res.status).toBeGreaterThanOrEqual(307);
      expect(redirectTarget(res)).toMatch(/\/(fa|en)\/sign-in$/);
    },
  );

  it("preserves the locale in the redirect — an English visitor lands on English sign-in", () => {
    const res = middleware(req("/en/management"));
    expect(redirectTarget(res)).toBe("/en/sign-in");
  });

  it.each(["/fa/sign-in", "/fa/sign-up", "/fa/forgot", "/fa/reset", "/fa/pending", "/fa/suspended"])(
    "%s stays reachable — it is how a session comes to exist",
    (path) => {
      const res = middleware(req(path));
      // next-intl answers these itself (200 rewrite or its own locale handling),
      // never a bounce to sign-in
      const loc = res.headers.get("location");
      if (loc) expect(new URL(loc).pathname).not.toMatch(/sign-in$/);
    },
  );
});

describe("signed IN — the gate opens, the wall stays core's", () => {
  it.each(["/fa", "/fa/echo", "/fa/settings"])("%s passes through", (path) => {
    const res = middleware(req(path, true));
    const loc = res.headers.get("location");
    if (loc) expect(new URL(loc).pathname).not.toMatch(/sign-in$/);
  });
});
