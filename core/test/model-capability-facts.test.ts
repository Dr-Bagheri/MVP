/**
 * THE PRICE THE PROVIDER STATES, off the fetch that was already happening.
 *
 * Found by reading the DEPLOYED admin screen after the product narrowed to
 * three models (2026-09-18): the table said `google/gemini-3.6-flash` costs
 * $1.5 / $7.5 per million and OpenRouter says $0.75 / $3.75 — the bundled
 * catalogue's snapshot, exactly double, on the one screen whose job is
 * deciding what an organisation can afford to run. `z-ai/glm-5.2` was out by
 * a quarter. Nothing had ever compared the two, because a plausible price is
 * indistinguishable from a correct one, and while the table listed hundreds
 * the number was context rather than the comparison.
 *
 * The facts ride on the capability lookup because that response is ALREADY
 * being fetched, three fields over from `supported_parameters`. A second call
 * would be a second thing to fail, cache and reason about — and two readers of
 * one provider answer are how they come to disagree.
 *
 * THE FIXTURE IS THE PROVIDER'S OWN SHAPE, transcribed from a live
 * `GET https://openrouter.ai/api/v1/models` rather than written to match the
 * parser: prices arrive as decimal STRINGS per token ("0.00000075"), which is
 * the whole reason a conversion exists and the one detail a hand-written
 * fixture gets wrong by supplying a number per million and agreeing with
 * itself.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetCapabilityCache, toolCapability } from "../src/api/model-capability.ts";

/** Transcribed from the live endpoint, 2026-09-18. */
const LIVE = {
  data: [
    {
      id: "google/gemini-3.6-flash",
      supported_parameters: ["tools", "temperature"],
      pricing: { prompt: "0.00000075", completion: "0.00000375" },
      context_length: 1048576,
    },
    {
      id: "deepseek/deepseek-v4-flash-0731",
      supported_parameters: ["tools"],
      pricing: { prompt: "0.00000006", completion: "0.00000012" },
      context_length: 1310720,
    },
    {
      // a real shape too: a free model. Zero is a PRICE, not a missing one.
      id: "some/free-model",
      supported_parameters: ["tools"],
      pricing: { prompt: "0", completion: "0" },
      context_length: 32768,
    },
    {
      // and the one the parser must refuse to guess about
      id: "some/unpriced-model",
      supported_parameters: ["tools"],
      pricing: { prompt: "not-a-number", completion: null },
    },
  ],
};

const respond = (payload: unknown) =>
  (async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;

beforeEach(() => { resetCapabilityCache(); });

describe("what the provider says a model costs", () => {
  it("converts per-token strings to dollars per million", async () => {
    const map = await toolCapability({ fetchImpl: respond(LIVE), now: 0 });
    expect(map.known).toBe(true);
    // the number the screen was getting wrong, and the one it should show
    expect(map.facts.get("google/gemini-3.6-flash")?.cost).toEqual({ input: 0.75, output: 3.75 });
    expect(map.facts.get("deepseek/deepseek-v4-flash-0731")?.cost).toEqual({ input: 0.06, output: 0.12 });
  });

  it("carries the context window the provider states", async () => {
    const map = await toolCapability({ fetchImpl: respond(LIVE), now: 0 });
    expect(map.facts.get("google/gemini-3.6-flash")?.contextWindow).toBe(1_048_576);
    expect(map.facts.get("deepseek/deepseek-v4-flash-0731")?.contextWindow).toBe(1_310_720);
  });

  it("keeps a FREE model's zero, and drops a price it could not read", async () => {
    // The two halves are opposite failures and a parser can only get one of
    // them wrong at a time: dropping the zero renders a free model with no
    // price, and defaulting the unreadable one to zero renders a model that
    // bills as free. The second is the expensive way to be wrong.
    const map = await toolCapability({ fetchImpl: respond(LIVE), now: 0 });
    expect(map.facts.get("some/free-model")?.cost).toEqual({ input: 0, output: 0 });
    expect(map.facts.get("some/unpriced-model")?.cost).toBeUndefined();
    // …and it still keeps what it COULD read: the row is not thrown away
    expect(map.facts.get("some/free-model")?.contextWindow).toBe(32_768);
  });

  it("is empty — not wrong — when the lookup fails", async () => {
    // The same rule the tool flags follow: an outage must not become a claim.
    const dead = (async () => { throw new Error("unreachable"); }) as unknown as typeof fetch;
    const map = await toolCapability({ fetchImpl: dead, now: 0 });
    expect(map.known).toBe(false);
    expect(map.facts.size).toBe(0);
  });

  it("serves the last CHECKED facts through an outage, labelled stale", async () => {
    // Prices age exactly as the tool flags do, and say so through one label
    // rather than two — a screen cannot be told the flags are stale and the
    // prices fresh when they came out of the same response.
    const first = await toolCapability({ fetchImpl: respond(LIVE), now: 0 });
    expect(first.facts.size).toBeGreaterThan(0);
    const dead = (async () => { throw new Error("unreachable"); }) as unknown as typeof fetch;
    const second = await toolCapability({ fetchImpl: dead, now: 9_000_000 });
    expect(second.known).toBe(true);
    expect(second.stale).toBe(true);
    expect(second.facts.get("google/gemini-3.6-flash")?.cost).toEqual({ input: 0.75, output: 3.75 });
  });
});
