/**
 * THE OFFER LIST AGAINST THE REAL CATALOGUE.
 *
 * `models-members.test.ts` mocks `catalogue()` down to a handful of entries —
 * the right call for what it asserts, and the reason it cannot see this class
 * of bug at all: a list naming a model the catalogue does not have passes
 * every test in that file and then serves an admin a row that cannot be
 * chosen, or a members' picker whose first entry 400s.
 *
 * That is not hypothetical. `models.ts` records `ai21/jamba-large-1.7` — a
 * RETIRED provider — leading the picker because the api served catalogue
 * order, and a live loop run died on it.
 *
 * It matters MORE since 2026-09-18 than it did when this file was written
 * against a ranking. `OFFERED_MODELS` is now an allow-list rather than an
 * order: an id the bundled catalogue does not carry is not a row out of
 * place, it is a model the product cannot serve at all, and three ids is a
 * short enough list that losing one to a pi-ai bump takes a third of the
 * picker with it and nothing else goes red.
 *
 * So: NO MOCK here, deliberately. The assertions read the same
 * `builtinModels()` catalogue production reads.
 */
import { describe, expect, it } from "vitest";
import { catalogue } from "../src/agent/pi.ts";
import {
  isExcluded,
  isNotAModel,
  latestOfEachFamily,
  OFFERED_MODELS,
} from "../src/api/models.ts";

const ids = new Set(catalogue().map((m) => m.id));

describe("the models this product offers", () => {
  it("offers something at all", () => {
    // The control for every assertion below: `[].filter(...)` satisfies all
    // of them, and an empty offer list is a product that serves no model to
    // anyone. Cheap to write, and the one failure the others cannot express.
    expect(OFFERED_MODELS.length).toBeGreaterThan(0);
  });

  it("names only models the catalogue actually has", () => {
    // A typo or an id dropped by a catalogue bump is invisible everywhere
    // else until someone picks it — and now, until a third of the product's
    // models quietly stops existing.
    expect(OFFERED_MODELS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("names no excluded provider, asked with the product's OWN predicate", () => {
    // Not a hand-written copy of the rule: a re-implementation here agrees
    // with whatever I believed while writing it, which is exactly how the
    // no-Claude rule passed its tests and served 28 anthropic models.
    //
    // This is also what keeps the exclusion load-bearing now that the offer
    // list subsumes it. Enforcement runs through `isServable`, where a
    // barred id is refused twice over; this assertion is the one place the
    // FAMILY rule can still fail on its own, so a widening that pastes in a
    // Claude id goes red here rather than shipping.
    expect(OFFERED_MODELS.filter((id) => isExcluded(id))).toEqual([]);
  });

  it("names no routing plan, moving alias or meta-router", () => {
    // `:batch` and `:free` are the same shape as the `:online` suffix that
    // killed every ask on 2026-09-04 — a transport feature wearing a model
    // id's clothes — and `~vendor/model-latest` resolves to whatever ships
    // next, which is not a decision anyone here can be said to have made.
    // With a hand-written list this is the only door those can come through.
    expect(OFFERED_MODELS.filter((id) => isNotAModel(id))).toEqual([]);
  });

  it("lists each model once", () => {
    // A duplicate does not break `indexOf`, it just makes the second entry a
    // dead line that reads like a decision.
    expect(new Set(OFFERED_MODELS).size).toBe(OFFERED_MODELS.length);
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

  it("would need its `keep` to leave the offer list standing — and here is the one that proves it", () => {
    /*
     * This filter is off the live path since 2026-09-18 (see the function's
     * own header), so what is worth pinning is the condition under which it
     * could be put back safely: with `keep` naming the offer list, every
     * offered model survives a run over the REAL catalogue.
     *
     * And the half that would have bitten whoever restored it: without
     * `keep`, `deepseek/deepseek-v4-flash-0731` does NOT survive, because a
     * plain id outranks a dated cut of itself and `deepseek/deepseek-v4-flash`
     * is in the same catalogue. The product offers the dated one on purpose
     * — it routes to a server twice as fast — so a restored call site
     * without its `keep` would quietly drop a third of the picker.
     */
    const kept = new Set(run([...ids], (id) => OFFERED_MODELS.includes(id)));
    expect(OFFERED_MODELS.filter((id) => !kept.has(id))).toEqual([]);

    const bare = new Set(run([...ids]));
    expect(OFFERED_MODELS.filter((id) => !bare.has(id)))
      .toEqual(["deepseek/deepseek-v4-flash-0731"]);
  });
});
