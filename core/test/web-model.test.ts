import { describe, expect, it } from "vitest";
import { baseModelId, catalogue, resolveModel } from "../src/agent/pi.ts";

/**
 * THE WEB SWITCH DISPATCHES A DECORATED ID AND RESOLVES A REAL ONE.
 *
 * `web: true` rides OpenRouter's `<model>:online`, which is a request feature
 * spelled as part of the model name. Nothing in the catalogue is spelled that
 * way, so the suffix must reach the wire and must NOT reach the lookup.
 *
 * This is written after the live failure it describes: the capability existed
 * in four callers, all four built the suffix correctly, and none of them could
 * ever have worked, because the one resolver they share looked the suffixed id
 * up as a name. A green suite the whole time — every test that had ever
 * exercised this function passed a plain id.
 */
describe("the web-enabled model id", () => {
  /* the base the rest of the file leans on — if this model ever leaves the
     catalogue these assertions would pass vacuously against a different bug */
  const REAL = "google/gemini-3.1-pro-preview";

  it("had something to check — the catalogue really holds the base model", () => {
    expect(catalogue().some((m) => m.id === REAL), `${REAL} is not in the catalogue`).toBe(true);
    expect(catalogue().some((m) => m.id === `${REAL}:online`), "the catalogue must NOT hold the decoration — if it did, this whole file is testing nothing").toBe(false);
  });

  it("resolves a suffixed id instead of throwing on it", () => {
    /* the shipped bug, exactly: this threw `unknown model:
       openrouter/google/gemini-3.1-pro-preview:online` and killed the run
       four seconds after the person pressed enter */
    expect(() => resolveModel({ provider: "openrouter", id: `${REAL}:online` })).not.toThrow();
  });

  it("dispatches the decoration — or the web switch is silently off", () => {
    const { model } = resolveModel({ provider: "openrouter", id: `${REAL}:online` });
    expect(
      (model as { id: string }).id,
      "the id sent to the provider must carry :online, or the request is an ordinary one and nobody searched anything",
    ).toBe(`${REAL}:online`);
  });

  it("leaves the registry's own model alone", () => {
    /*
     * The failure this cannot be allowed to have: `getBuiltinModel` returns a
     * shared object, so stamping the suffix onto it in place would rename that
     * model for every later run in the process — one person's web turn putting
     * an unrelated org's asks on the web plan, at their expense, invisibly.
     */
    resolveModel({ provider: "openrouter", id: `${REAL}:online` });
    const plain = resolveModel({ provider: "openrouter", id: REAL });
    expect((plain.model as { id: string }).id, "a later plain run inherited the suffix").toBe(REAL);
  });

  it("keeps the plain path exactly as it was", () => {
    const { model, reasoningRequired } = resolveModel({ provider: "openrouter", id: REAL });
    expect((model as { id: string }).id).toBe(REAL);
    expect(typeof reasoningRequired).toBe("boolean");
  });

  it("still refuses an id that is genuinely unknown", () => {
    /* the control: without this, a resolver that swallowed every miss would
       pass every assertion above and hide the next typo until generation time */
    expect(() => resolveModel({ provider: "openrouter", id: "nobody/wrote-this" })).toThrow(/unknown model/);
    expect(() => resolveModel({ provider: "openrouter", id: "nobody/wrote-this:online" })).toThrow(/unknown model/);
  });

  it("names the BASE id when it refuses", () => {
    /* the message is what someone reads at 2am; `unknown model: x:online`
       sends them looking for a catalogue entry that is not supposed to exist */
    expect(() => resolveModel({ provider: "openrouter", id: "nobody/wrote-this:online" }))
      .toThrow("unknown model: openrouter/nobody/wrote-this");
  });

  it("strips only the suffix, and only at the end", () => {
    expect(baseModelId(`${REAL}:online`)).toBe(REAL);
    expect(baseModelId(REAL)).toBe(REAL);
    /* a model whose own name contained the word must survive untouched */
    expect(baseModelId("vendor/online-model")).toBe("vendor/online-model");
  });
});
