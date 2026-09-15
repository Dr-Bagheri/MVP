import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The code gate's two routes (M54), asserted at the seam that matters: what
 * GoTrue is asked, and what the browser is told.
 *
 *  · "send me a code" asks `/otp` with `create_user` — the one flag that makes
 *    signing up and signing in the same act — and answers `ok` whether or not
 *    the address exists (no membership oracle), passing through only a rate
 *    limit and a refused address;
 *  · the verify route turns a code into a SESSION COOKIE and the browser gets
 *    `{ok:true}` and nothing else (M1); a wrong code is `401 invalid`, the
 *    gate's one word for a refused credential; Persian digits arrive as ASCII.
 */
const requestEmailCode = vi.fn();
const verifyEmailCode = vi.fn();
const writeSession = vi.fn();

vi.mock("@/server/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/supabase")>();
  return {
    ...actual,
    requestEmailCode: (...args: unknown[]) => requestEmailCode(...args),
    verifyEmailCode: (...args: unknown[]) => verifyEmailCode(...args),
  };
});
vi.mock("@/server/session", () => ({ writeSession: (...args: unknown[]) => writeSession(...args) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "fa" }) }) }));

const { AuthError } = await import("@/server/supabase");
const { POST: send } = await import("./route");
const { POST: verify } = await import("./verify/route");

const post = (path: string, body: unknown) =>
  new Request(`https://app.neurai.pt${path}`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  requestEmailCode.mockReset().mockResolvedValue(undefined);
  verifyEmailCode.mockReset().mockResolvedValue({ access_token: "a", refresh_token: "r", expires_in: 3600 });
  writeSession.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/auth/otp — send me a code", () => {
  it("asks GoTrue for the address, with the fragment-fallback landing in the visitor's locale", async () => {
    const res = await send(post("/api/auth/otp", { email: "  person@example.com " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(requestEmailCode).toHaveBeenCalledWith(
      "person@example.com",
      "https://app.neurai.pt/fa/sign-in?confirmed=fragment",
    );
  });

  it("answers ok when the provider fails for any reason but a rate limit or a refused address — no oracle", async () => {
    requestEmailCode.mockRejectedValue(new AuthError(502, "auth provider unreachable"));
    const res = await send(post("/api/auth/otp", { email: "person@example.com" }));
    expect(res.status).toBe(200);
  });

  it("passes a rate limit through as one — pressing again is the one thing that keeps it failing", async () => {
    requestEmailCode.mockRejectedValue(new AuthError(429, "over_email_send_rate_limit"));
    const res = await send(post("/api/auth/otp", { email: "person@example.com" }));
    expect(res.status).toBe(429);
    expect((await res.json()).kind).toBe("rate_limited");
  });

  it("passes a refused address through as invalid", async () => {
    requestEmailCode.mockRejectedValue(new AuthError(400, "Unable to validate email address: invalid format"));
    const res = await send(post("/api/auth/otp", { email: "not-an-address" }));
    expect(res.status).toBe(400);
    expect((await res.json()).kind).toBe("invalid");
  });

  it("a missing address is a 400 before any provider is asked", async () => {
    const res = await send(post("/api/auth/otp", {}));
    expect(res.status).toBe(400);
    expect(requestEmailCode).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/otp/verify — the typed code", () => {
  it("verifies the code against the address, writes the cookie, and tells the browser nothing else", async () => {
    const res = await verify(post("/api/auth/otp/verify", { email: "person@example.com", code: "123456" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(verifyEmailCode).toHaveBeenCalledWith("person@example.com", "123456");
    expect(writeSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "a", refreshToken: "r" }));
  });

  it("Persian and Arabic-Indic digits reach GoTrue as ASCII", async () => {
    await verify(post("/api/auth/otp/verify", { email: "person@example.com", code: "۱۲۳٤٥٦" }));
    expect(verifyEmailCode).toHaveBeenCalledWith("person@example.com", "123456");
  });

  it("a wrong or expired code is 401 invalid — the gate's one word — and no cookie is written", async () => {
    verifyEmailCode.mockRejectedValue(new AuthError(403, "Token has expired or is invalid"));
    const res = await verify(post("/api/auth/otp/verify", { email: "person@example.com", code: "000000" }));
    expect(res.status).toBe(401);
    expect((await res.json()).kind).toBe("invalid");
    expect(writeSession).not.toHaveBeenCalled();
  });

  it("a short code is refused before the provider is asked", async () => {
    const res = await verify(post("/api/auth/otp/verify", { email: "person@example.com", code: "12" }));
    expect(res.status).toBe(400);
    expect(verifyEmailCode).not.toHaveBeenCalled();
  });
});
