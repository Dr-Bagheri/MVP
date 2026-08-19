import { beforeEach, describe, expect, it, vi } from "vitest";

const readSession = vi.fn();
const enrollmentRequired = vi.fn();

vi.mock("@/server/session", () => ({ readSession: () => readSession() }));
vi.mock("@/server/supabase", () => ({
  AuthError: class AuthError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
  },
  oauthPasswordEnrollmentRequired: (...args: unknown[]) => enrollmentRequired(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  readSession.mockReset();
  enrollmentRequired.mockReset();
});

describe("OAuth password enrollment status", () => {
  it("reports only the setup boolean for the authenticated session", async () => {
    readSession.mockResolvedValue({ accessToken: "opaque-provider-token" });
    enrollmentRequired.mockResolvedValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ required: true });
    expect(enrollmentRequired).toHaveBeenCalledWith("opaque-provider-token");
  });

  it("does not query identity state without a session", async () => {
    readSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(enrollmentRequired).not.toHaveBeenCalled();
  });
});
