/**
 * THE RANKING AGAINST THE REAL CATALOGUE.
 *
 * `models-members.test.ts` mocks `catalogue()` down to five entries — the
 * right call for what it asserts, and the reason it cannot see this class of
 * bug at all: a suggestion list naming a model the catalogue does not have
 * passes every test in that file and then serves an admin a row that cannot
 * be chosen, or a members' picker whose first entry 400s.
 *
 * That is not hypothetical. `models.ts` records `ai21/jamba-large-1.7` — a
 * RETIRED provider — leading the picker because the api served catalogue
 * order, and a live loop run died on it. The ranking is hand-written and
 * gets re-picked as models come and go (2026-08-16, then 2026-09-09), so the
 * one thing worth pinning is that every id in it is a model this product can
 * actually serve.
 *
 * So: NO MOCK here, deliberately. The assertions read the same
 * `builtinModels()` catalogue production reads.
 */
import { describe, expect, it } from "vitest";
import { catalogue } from "../src/agent/pi.ts";
import {
  EXCLUDED_PROVIDERS,
  latestOfEachFamily,
  RECOMMENDED_MODELS,
  SUGGESTED_MODELS,
} from "../src/api/models.ts";

const ids = new Set(catalogue().map((m) => m.id));

describe("the model ranking", () => {
  it("names only models the catalogue actually has", () => {
    // The whole point: a typo or a retired id is invisible everywhere else
    // until someone picks it.
    expect(RECOMMENDED_MODELS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("names no excluded provider", () => {
    // The same negative-space assertion models-members.test.ts makes about
    // SUGGESTED_MODELS, widened to the shelf: the shelf is what the ADD
    // dialog opens on, so a barred model reaching it is the picker offering
    // what `choose()` will refuse.
    const barred = RECOMMENDED_MODELS.filter((id) => {
      const vendor = id.toLowerCase().replace(/^[^a-z0-9]+/, "").split("/")[0] ?? "";
      return EXCLUDED_PROVIDERS.includes(vendor) || id.toLowerCase().includes("claude");
    });
    expect(barred).toEqual([]);
  });

  it("opens with the org's lineup, in the lineup's own order", () => {
    // `bySuggestion` ranks by RECOMMENDED_MODELS alone, so the five are the
    // top five ONLY because the shelf starts with them. Split the two lists
    // and the picker silently stops leading with the lineup — nothing else
    // would fail.
    expect(RECOMMENDED_MODELS.slice(0, SUGGESTED_MODELS.length)).toEqual([...SUGGESTED_MODELS]);
  });

  it("lists each model once", () => {
    // A duplicate does not break `indexOf`, it just makes the second entry a
    // dead line that reads like a decision.
    expect(new Set(RECOMMENDED_MODELS).size).toBe(RECOMMENDED_MODELS.length);
  });

  it("names no id carrying the catalogue's transport decorations", () => {
    // `:batch` and `:free` are the same shape as the `:online` suffix that
    // killed every ask on 2026-09-04 — a routing plan wearing a model id's
    // clothes. The picker offers MODELS.
    expect(RECOMMENDED_MODELS.filter((id) => id.includes(":"))).toEqual([]);
  });
});

/**
 * THE SHELF IS A RANKING; THIS IS THE FILTER UNDER IT.
 *
 * The catalogue's 335 entries are not 335 models, and the ADD dialog was
 * offering every one of them: routing plans, moving aliases, meta-routers and
 * four dated cuts of the same GPT. What survives here is one entry per
 * family, and the fixtures are TRANSCRIBED FROM THE LIVE CATALOGUE rather
 * than invented — an id I make up agrees with whatever rule I just wrote,
 * which is the whole reason the ranking above is checked against the real
 * catalogue too.
 */
describe("latest of each family", () => {
  const keepNothing = () => false;
  const idsOf = (models: { id: string }[]) => models.map((m) => m.id);
  const run = (ids: string[], keep: (id: string) => boolean = keepNothing) =>
    idsOf(latestOfEachFamily(ids.map((id) => ({ id })), keep));

  it("keeps the highest version of a family and drops the rest", () => {
    expect(run(["z-ai/glm-5.2", "z-ai/glm-5.1", "z-ai/glm-5"])).toEqual(["z-ai/glm-5.2"]);
  });

  it("reads a version as it is PRINTED, not as semver", () => {
    // `grok-4.20` is an April-20 joke release and `grok-4.5` is xAI's current
    // model. Segment-wise integer comparison ranks 20 above 5 and hides the
    // one an admin came here for — which is what the first draft did.
    expect(run(["x-ai/grok-4.20", "x-ai/grok-4.5", "x-ai/grok-4.3"]))
      .toEqual(["x-ai/grok-4.5"]);
  });

  it("treats a variant as its own family, not a version of its sibling", () => {
    // luna / sol / terra are three models at one version, not three cuts of
    // one. Collapsing them would leave OpenAI with a single entry chosen by
    // an alphabet.
    expect(run(["openai/gpt-5.6-luna", "openai/gpt-5.6-sol", "openai/gpt-5.6-terra"]).sort())
      .toEqual(["openai/gpt-5.6-luna", "openai/gpt-5.6-sol", "openai/gpt-5.6-terra"]);
  });

  it("prefers the plain id over a dated cut of itself", () => {
    // The vendor's own pointer at the family, and the one a person
    // recognises. All three dated ids are real catalogue entries.
    expect(run([
      "openai/gpt-4o-2024-05-13", "openai/gpt-4o", "openai/gpt-4o-2024-11-20",
    ])).toEqual(["openai/gpt-4o"]);
  });

  it("prefers a shipped id over a preview of the same version", () => {
    expect(run(["google/gemini-3.1-flash-lite-preview", "google/gemini-3.1-flash-lite"]))
      .toEqual(["google/gemini-3.1-flash-lite"]);
  });

  it("KEEPS a preview when the family ships no other way", () => {
    // The rule that a blanket -preview filter got wrong: Google's current Pro
    // is published only as a preview id, so dropping the suffix as noise left
    // the catalogue's Gemini Pro family represented by `gemini-2.5-pro`.
    expect(run(["google/gemini-3.1-pro-preview", "google/gemini-2.5-pro"]))
      .toEqual(["google/gemini-3.1-pro-preview"]);
  });

  it("drops what is not a model", () => {
    // A routing plan, a moving alias, a meta-router, a bare id with no
    // vendor, and a tool-schema variant — every one a real catalogue entry
    // the picker was offering as a choice.
    expect(run([
      "openai/gpt-5.2:batch",
      "~openai/gpt-latest",
      "openrouter/auto",
      "auto",
      "google/gemini-3.1-pro-preview-customtools",
      "openai/gpt-chat-latest",
    ])).toEqual([]);
  });

  it("never drops a model the caller says to keep", () => {
    // The load-bearing case: this list is ALSO the admin's remove table, so a
    // filter that hides an allowed model takes away the only control for
    // un-allowing it — the org would be running a model it can no longer
    // see, let alone stop.
    const allowed = "openai/gpt-4o-2024-05-13";
    expect(run(["openai/gpt-4o", allowed], (id) => id === allowed))
      .toContain(allowed);
  });

  it("keeps the input's own order", () => {
    // `bySuggestion` sorts afterwards and is STABLE, so anything this filter
    // reorders it cannot put back.
    expect(run(["z-ai/glm-5.2", "openai/gpt-5.6-terra", "deepseek/deepseek-v4-pro"]))
      .toEqual(["z-ai/glm-5.2", "openai/gpt-5.6-terra", "deepseek/deepseek-v4-pro"]);
  });

  it("leaves the whole shelf standing when run over the real catalogue", () => {
    // The shelf is what the dialog OPENS on, so a shelf entry the filter
    // removes is a ranking and a list disagreeing about one org.
    const survivors = new Set(run([...ids], (id) => RECOMMENDED_MODELS.includes(id)));
    expect(RECOMMENDED_MODELS.filter((id) => !survivors.has(id))).toEqual([]);
  });
});
