/**
 * The no-Claude rule, at every door a model id can come through.
 *
 * The rule has now failed FIVE times, and the shape has been identical each
 * time: someone wrote the M5 ladder out fresh in a new place and did not ask
 * whether the product would serve the rung they landed on. `startsWith
 * ("anthropic/")` lost to one leading tilde; four worker copies never applied
 * the exclusion at all; the ask wire took `body.model` as free text; and the
 * 2026-08-29 audit found two more — `/v1/calls/:id/translate`, and a skill's
 * pinned `model` column, which is free text on create and patch and which no
 * `assertAskable` can ever see because nobody types it at run time.
 *
 * The lesson stopped being "fix this one" some failures ago: **a rule enforced
 * on the path a person watches is not enforced.** So this file is about the
 * DOORS rather than about any one caller — one test per way a model id can
 * enter the system, so the next copy of the ladder has somewhere to fail.
 *
 * ── the distinction every test here turns on ──────────────────────────────
 * A model someone TYPED is refused by name: they asked for something specific
 * and deserve to be told what was refused. A model NOBODY typed — a stale
 * stored preference, a pin configured months ago — is treated as an absent
 * rung, and the ladder continues. Refusing that would end a run with "no
 * model selected" for a person who never chose it, which is a vaguer nothing
 * (rule 12) and the reason the by-name refusal was reversed for stored rows
 * in the first place.
 *
 * ── fixture independence ──────────────────────────────────────────────────
 * `~anthropic/claude-opus-latest` is not invented for this file. It is the id
 * production actually served, transcribed from the user's screenshot, and it
 * is here because a hand-written `anthropic/claude-3` agrees with what the
 * code already believed and would have passed against the shipped bug.
 *
 * ── the checker that was written here and thrown away ─────────────────────
 * The first attempt at closing this class was a source-level instrument:
 * parse `server.ts` into route handlers and demand that any handler reading
 * `body.model` or `preferred_model` also calls a guard. It found four routes
 * — and all four were false positives. `POST /v1/skills` and `PATCH
 * /v1/skills/:id` pass the value to a repo that guards it; `PUT
 * /v1/models/preferred` validates at write time inside the repo; and the
 * `/v1/assistant/ask` hit was the words `preferred_model` inside a COMMENT,
 * which is the name-matching-itself trap in a checker written to catch
 * exactly that trap.
 *
 * It was deleted rather than tuned. A checker that manufactures false
 * positives gets muted within a week and is then worse than absent, and a
 * guard living one layer down in a repo is CORRECT design, not a hole — an
 * instrument that calls the right shape wrong would push the code toward the
 * wrong shape.
 *
 * What replaced it is better than a check: `modelForRun` is the single funnel
 * every run's model passes through, and it now applies the exclusion itself.
 * A route that forgets the wall no longer reaches a barred model — it reaches
 * the caller's next rung. That is the wrong state made unrepresentable rather
 * than watched for, which is the outcome this repo prefers wherever it is
 * available.
 */
import { describe, expect, it } from "vitest";

import { firstServable } from "../src/api/models.ts";
import { modelForRun } from "../src/agent/skills.ts";
import type { Skill } from "../src/agent/types.ts";

/** The id production served, not one written to match the implementation. */
const BARRED = "~anthropic/claude-opus-latest";
const PLAIN_BARRED = "anthropic/claude-sonnet-4";
const FINE = "google/gemini-3.1-flash";

const skill = (over: Partial<Skill> = {}): Skill =>
  ({
    id: "s1", level: "system", slug: "translator", name: "t", description: "",
    prompt: "p", model: null, tools: [], starter_questions: [],
    max_tool_calls: null, editable: false, ...over,
  }) as Skill;

describe("the model wall — every door a model id enters through", () => {
  describe("firstServable, the ladder itself", () => {
    it("skips a barred rung and keeps descending", () => {
      expect(firstServable(BARRED, FINE)).toBe(FINE);
      expect(firstServable(PLAIN_BARRED, null, FINE)).toBe(FINE);
    });

    it("returns null when EVERY rung is barred — including the env fallback", () => {
      // the env rung matters most: a misconfigured WORKER_SUMMARY_MODEL is
      // exactly what serves one silently forever, because nobody reads it
      // again after the day it is set
      expect(firstServable(BARRED, PLAIN_BARRED, "anthropic/claude-3-opus")).toBeNull();
    });

    it("is not defeated by a routing prefix — the one-character failure", () => {
      // `startsWith("anthropic/")` shipped, and lost to the leading `~`. The
      // rule names a model FAMILY, not a routing prefix.
      expect(firstServable(BARRED)).toBeNull();
      expect(firstServable("~ANTHROPIC/Claude-Opus")).toBeNull();
    });

    it("passes a legitimate model through untouched", () => {
      expect(firstServable(FINE)).toBe(FINE);
      // the negative control for the whole file: a wall that refuses
      // everything satisfies every assertion above and is completely wrong
      expect(firstServable(null, undefined, "", FINE)).toBe(FINE);
    });
  });

  describe("modelForRun — a skill's pin is a rung, not an override", () => {
    it("refuses to let a barred PIN win over the caller's choice", () => {
      // the sixth copy of the ladder: `skill?.model ?? callerModel` asked
      // neither rung whether the product would serve it
      expect(modelForRun(skill({ model: BARRED }), FINE)).toBe(FINE);
    });

    it("falls through a barred pin to nothing, and says so, rather than serving it", () => {
      expect(() => modelForRun(skill({ model: BARRED }), undefined)).toThrow(/no model selected/);
    });

    it("still prefers a legitimate pin over the caller — M5 unchanged", () => {
      // the control: the fix must not have inverted the precedence it guards
      expect(modelForRun(skill({ model: FINE }), "openai/gpt-5-mini")).toBe(FINE);
      expect(modelForRun(skill({ model: null }), FINE)).toBe(FINE);
    });
  });
});
