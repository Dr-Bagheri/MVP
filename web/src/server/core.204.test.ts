import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({
  readSession: async () => ({ accessToken: "token" }),
}));

import { coreFetch } from "./core";

/**
 * The 204 rule (user report, 2026-08-21, screenshot attached): core answers
 * DELETE /v1/calls/:id — and four other routes — with 204 No Content;
 * json() on an empty body THROWS, the route's catch turned that throw into
 * a 500, and the browser toasted "That didn't go through" about a delete
 * that went through. A success the helper reports as failure is the
 * red-lies-too failure on the happy path.
 */
describe("coreFetch and 204 No Content", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a 204 resolves (null) — never a parse crash wearing a 500", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    await expect(coreFetch("/v1/calls/c-1", { method: "DELETE" })).resolves.toBeNull();
  });

  it("a 200 with a body still parses as before", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(coreFetch("/v1/anything")).resolves.toEqual({ ok: true });
  });
});
