import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthPasswordEnrollmentRequired, setInitialOAuthPassword } from "./supabase";

const response = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OAuth password enrollment", () => {
  it("requires the first password for a Google-only account", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response({
      identities: [{ provider: "google" }],
      user_metadata: {},
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(oauthPasswordEnrollmentRequired("oauth-token")).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/user",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer oauth-token" }) }),
    );
  });

  it("does not offer the first-password route to an existing email identity", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response({
      identities: [{ provider: "google" }, { provider: "email" }],
      user_metadata: {},
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(oauthPasswordEnrollmentRequired("oauth-token")).resolves.toBe(false);
    await expect(setInitialOAuthPassword("oauth-token", "new-password")).rejects.toMatchObject({
      status: 409,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("stores the enrollment marker together with the first password", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(response({ identities: [{ provider: "google" }], user_metadata: {} }))
      .mockResolvedValueOnce(response({ id: "user-1" }));
    vi.stubGlobal("fetch", fetchSpy);

    await setInitialOAuthPassword("oauth-token", "new-password");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://project.supabase.co/auth/v1/user",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ password: "new-password", data: { neurai_password_enrolled: true } }),
      }),
    );
  });
});

/**
 * THE CODE GATE'S TWO CALLS (M54), at the seam: the path and body GoTrue is
 * handed. `create_user` is the flag that makes one field both sign-up and
 * sign-in; `redirect_to` rides the QUERY STRING, where GoTrue reads it for
 * this endpoint; the verify is the email-OTP shape, not the token-hash one.
 */
describe("the email code (M54)", () => {
  it("asks /otp with create_user and the landing in the query string", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchSpy);
    const { requestEmailCode } = await import("./supabase");
    await requestEmailCode("person@example.com", "https://app.neurai.pt/fa/sign-in?confirmed=fragment");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/otp?redirect_to=" + encodeURIComponent("https://app.neurai.pt/fa/sign-in?confirmed=fragment"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "person@example.com", create_user: true }),
      }),
    );
  });

  it("verifies the typed code as an email OTP and returns the session", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { verifyEmailCode } = await import("./supabase");
    const tokens = await verifyEmailCode("person@example.com", "123456");
    expect(tokens.access_token).toBe("a");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/verify",
      expect.objectContaining({ body: JSON.stringify({ type: "email", email: "person@example.com", token: "123456" }) }),
    );
  });

  it("a magic-link token hash is verified with its own type", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { verifySignupToken } = await import("./supabase");
    await verifySignupToken("hash", "magiclink");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/verify",
      expect.objectContaining({ body: JSON.stringify({ type: "magiclink", token_hash: "hash" }) }),
    );
  });
});
