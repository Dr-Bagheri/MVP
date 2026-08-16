/**
 * The OAuth-arrival fixture: a registration POST with NO display_name.
 *
 * This is the input where the feature's absence and its presence differ
 * (rule 12): a password sign-up always types an email, so the client can
 * derive a name and the fallback never fires — every green test written
 * from that path would stay green with the fallback deleted. The Google/
 * GitHub arrival is the one that reaches the org step with an empty form,
 * and against the pre-fix route this exact request came back 400
 * ("display_name is required" on a screen with no name field).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const coreFetch = vi.fn();
const readSession = vi.fn();

vi.mock("@/server/core", () => ({
  coreFetch: (...args: unknown[]) => coreFetch(...args),
  errorResponse: () => Response.json({ error: "upstream" }, { status: 502 }),
}));
vi.mock("@/server/session", () => ({
  readSession: () => readSession(),
}));

import { POST } from "./route";

/** A structurally-real JWT: header.payload.signature, payload base64url. */
function tokenWith(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "ES256" })}.${b64(payload)}.sig`;
}

function post(body: object): Request {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  coreFetch.mockReset().mockResolvedValue({ id: "u1", role: "owner", status: "active" });
  readSession.mockReset();
});

describe("register: display_name fallback from the session token", () => {
  it("derives the name from user_metadata when the form sent none (OAuth arrival)", async () => {
    readSession.mockResolvedValue({
      accessToken: tokenWith({
        email: "jane@example.com",
        user_metadata: { full_name: "Jane Dev" },
      }),
    });

    const res = await POST(post({ org_name: "acme" }));

    expect(res.status).toBe(201);
    expect(coreFetch).toHaveBeenCalledWith(
      "/v1/signup",
      expect.objectContaining({ body: expect.objectContaining({ display_name: "Jane Dev" }) }),
    );
  });

  it("falls back to the email local part when the provider sent no name", async () => {
    readSession.mockResolvedValue({
      accessToken: tokenWith({ email: "jane.dev@example.com", user_metadata: {} }),
    });

    const res = await POST(post({ org_name: "acme" }));

    expect(res.status).toBe(201);
    expect(coreFetch).toHaveBeenCalledWith(
      "/v1/signup",
      expect.objectContaining({ body: expect.objectContaining({ display_name: "jane.dev" }) }),
    );
  });

  it("still refuses when there is no session and no typed name", async () => {
    readSession.mockResolvedValue(null);

    const res = await POST(post({ org_name: "acme" }));

    expect(res.status).toBe(400);
    expect(coreFetch).not.toHaveBeenCalled();
  });

  it("a typed name wins — the token is never consulted", async () => {
    const res = await POST(post({ display_name: "Typed Name", org_name: "acme" }));

    expect(res.status).toBe(201);
    expect(readSession).not.toHaveBeenCalled();
    expect(coreFetch).toHaveBeenCalledWith(
      "/v1/signup",
      expect.objectContaining({ body: expect.objectContaining({ display_name: "Typed Name" }) }),
    );
  });
});
