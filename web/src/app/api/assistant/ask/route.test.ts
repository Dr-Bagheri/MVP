/**
 * The ask route is a field-for-field TRANSLATION, and a translation drops
 * whatever it was never taught: `client_tools`/`context` (M33/M34) rode the
 * client and were read by core while THIS route silently discarded them —
 * the model answered "I don't have the ability to navigate" with six tools
 * advertised one hop away (user report, 2026-08-21; the route's own header
 * comment had already described the failure class it then reproduced).
 *
 * This test pins the FORWARDING: every field the client sends that core
 * reads must arrive in the upstream body. New wire fields join FORWARDED —
 * a field added to client.ts and core but not here fails this file, not
 * production.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const coreStream = vi.fn();

vi.mock("@/server/core", () => ({
  coreStream: (...args: unknown[]) => coreStream(...args),
  errorResponse: () => Response.json({ error: "upstream" }, { status: 502 }),
}));

import { POST } from "./route";

const FORWARDED = {
  question: "شروع ضبط",
  session_id: "s-1",
  model: "google/gemini-3.6-pro",
  skill: "sk",
  call_id: "c-1",
  call_ids: ["c-1", "c-2"],
  web: true,
  agent: "a-1",
  workflow: "w-1",
  connector_provider: "google",
  source_id: "src-1",
  locale: "fa",
  client_tools: ["navigate", "start_recording"],
  context: { route: "/echo", entity: { kind: "call", id: "c-1" } },
};

beforeEach(() => {
  coreStream.mockReset();
  coreStream.mockResolvedValue(new Response("data: {}\n\n", { status: 200 }));
});

describe("POST /api/assistant/ask forwarding", () => {
  it("forwards EVERY wire field core reads — client tools and context included", async () => {
    await POST(new Request("http://localhost/api/assistant/ask", {
      method: "POST",
      body: JSON.stringify(FORWARDED),
    }));
    expect(coreStream).toHaveBeenCalledTimes(1);
    const [path, body] = coreStream.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/v1/assistant/ask");
    // toEqual, not toMatchObject: an extra invented field is drift too
    expect(body).toEqual(FORWARDED);
  });
});
