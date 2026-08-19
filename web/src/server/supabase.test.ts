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
