import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import middleware from "@/middleware";
import { SESSION_COOKIE } from "@/server/session-cookie";
import { routing } from "./routing";

/**
 * PERSIAN IS THE DEFAULT (user ruling, 2026-09-16: "the default language is
 * persian") — and "default" has to be TRUE for a browser that asks for
 * English, or it is only a default for browsers already set to Persian.
 *
 * The probe is a SIGNED-IN request, and that is the finding of its first
 * draft: a signed-out bare URL is redirected by our own gate, which spells
 * the sign-in address with `routing.defaultLocale` before next-intl ever
 * runs — so that request landed on /fa/sign-in with detection ON as well,
 * and the mutation stayed green. Only a request the gate lets through
 * reaches next-intl's locale choice, and there `Accept-Language: en-US`
 * discriminates: with detection on it would go to /en, with it off it goes
 * to /fa. The CONTROL is a URL that already carries /en — the prefix a
 * person chose still wins, so "everything is Persian now" cannot pass.
 */
const live = () =>
  JSON.stringify({ accessToken: "jwt-access", refreshToken: "jwt-refresh", expiresAt: Date.now() + 3_600_000 });

const req = (path: string, acceptLanguage: string) => {
  const r = new NextRequest(`https://app.neurai.pt${path}`, {
    headers: { "accept-language": acceptLanguage },
  });
  r.cookies.set(SESSION_COOKIE, live());
  return r;
};
const target = (res: Response) => new URL(res.headers.get("location")!).pathname;

describe("the default locale", () => {
  it("is Persian, with the browser's own preference not consulted", () => {
    expect(routing.defaultLocale).toBe("fa");
    expect(routing.locales).toEqual(["fa", "en"]);
    expect(routing.localeDetection).toBe(false);
  });

  it("lands a signed-in bare URL on /fa even for a browser that asks for English", async () => {
    const res = await middleware(req("/", "en-US,en;q=0.9"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(target(res)).toBe("/fa");
  });

  it("keeps a prefix the person chose — the control", async () => {
    const res = await middleware(req("/en/settings", "fa-IR,fa;q=0.9"));
    /* a prefixed, signed-in request passes through: no redirect away from
       the language the person is reading in */
    expect(res.headers.get("location")).toBeNull();
  });
});
