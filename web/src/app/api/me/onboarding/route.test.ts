import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The flow's save route forwards EXACTLY the two keys core accepts and
 * nothing it was not sent: an absent `complete` must stay absent (that is
 * what lets a step save without ending the flow), and a stray key must not
 * be forwarded to become core's `400 unknown_fields` on somebody's behalf.
 */
const coreFetch = vi.fn();
vi.mock("@/server/core", () => ({
  coreFetch: (...args: unknown[]) => coreFetch(...args),
  errorResponse: () => Response.json({ error: "upstream" }, { status: 502 }),
  readJson: (request: Request) => request.json(),
}));

const { PATCH } = await import("./route");

const patch = (body: unknown) =>
  new Request("http://localhost/api/me/onboarding", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  coreFetch.mockReset().mockResolvedValue({ id: "u1", onboarding: { goals: ["meetings"] }, onboarding_completed_at: null });
});

describe("PATCH /api/me/onboarding", () => {
  it("forwards the answers alone when only answers were sent — the stamp is left untouched", async () => {
    const res = await PATCH(patch({ answers: { goals: ["meetings"], step: "work" } }));
    expect(res.status).toBe(200);
    expect(coreFetch).toHaveBeenCalledWith("/v1/me/onboarding", {
      method: "PATCH",
      body: { answers: { goals: ["meetings"], step: "work" } },
    });
    const sent = coreFetch.mock.calls[0]![1] as { body: Record<string, unknown> };
    expect("complete" in sent.body).toBe(false);
  });

  it("forwards `complete` when sent, and drops a key core does not know", async () => {
    await PATCH(patch({ complete: true, display_name: "x" }));
    expect(coreFetch).toHaveBeenCalledWith("/v1/me/onboarding", {
      method: "PATCH",
      body: { complete: true },
    });
  });
});
