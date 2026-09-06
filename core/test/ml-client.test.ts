import { describe, expect, it, vi } from "vitest";

import { createMlClient, mlTimeoutFor } from "../src/worker/ml-client.ts";

/**
 * The ml/ client at its wire (2026-09-06, the long-file lane): the wait that
 * follows the part's length, and the STRUCTURED context on the request body
 * — asserted against a fake fetch, because "the option was set" is true in
 * every version of this that forgets to send it.
 */
describe("mlTimeoutFor — the wait follows the part", () => {
  const floor = 20 * 60 * 1000;

  it("never waits less than the floor — a two-minute memo gets the floor, an unknown length too", () => {
    expect(mlTimeoutFor(2 * 60 * 1000, floor)).toBe(floor); // 3 + 15 min < the 20-min floor
    expect(mlTimeoutFor(null, floor)).toBe(floor);
    expect(mlTimeoutFor(0, floor)).toBe(floor);
    // and just past it the length rule takes over
    expect(mlTimeoutFor(5 * 60 * 1000, floor)).toBe(22.5 * 60 * 1000);
  });

  it("gives a long part one and a half times its length plus a quarter hour", () => {
    expect(mlTimeoutFor(2 * 60 * 60 * 1000, floor)).toBe(3 * 60 * 60 * 1000 + 15 * 60 * 1000);
  });

  it("never waits past six and a half hours", () => {
    expect(mlTimeoutFor(5 * 60 * 60 * 1000, floor)).toBe(6.5 * 60 * 60 * 1000);
  });
});

describe("the /process request", () => {
  function client() {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, words: [] }), { status: 200 });
    });
    return { calls, ml: createMlClient({ baseUrl: "http://ml.test", fetchImpl: fetchImpl as unknown as typeof fetch }) };
  }

  it("sends the structured context as given, and no context field when there is none", async () => {
    const { calls, ml } = client();
    const context = { terms: ["نورای"], text: "kickoff", general: [{ key: "organization", value: "Neurai" }] };
    await ml.process({ audioUrl: "https://x.test/a.wav", options: { languageHints: ["fa"], context } });
    expect((calls[0]!.body.options as Record<string, unknown>).context).toEqual(context);

    await ml.process({ audioUrl: "https://x.test/b.wav", options: { languageHints: ["fa"] } });
    expect("context" in (calls[1]!.body.options as Record<string, unknown>)).toBe(false);
  });

  it("a per-call timeout aborts the request — the ml_timeout kind, retryable", async () => {
    const never = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const ml = createMlClient({ baseUrl: "http://ml.test", fetchImpl: never as unknown as typeof fetch, timeoutMs: 60_000 });
    await expect(ml.process({ audioUrl: "https://x.test/a.wav" }, { timeoutMs: 20 }))
      .rejects.toMatchObject({ errorType: "ml_timeout", retryable: true });
  });
});
