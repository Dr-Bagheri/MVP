import { describe, expect, it } from "vitest";
import {
  FIRST_SKIPPABLE, OPTIONS, SPEED_RATIO, STAGES, STEP_IDS, STEP_STAGE, TYPING_HOURS,
  canSkip, hoursSavedPerWeek, nextStep, prevStep, progress, ready, resumeStep, toggle,
} from "./steps";

/**
 * The flow's shape, asserted without a render: the rail's five stages in the
 * reference's order, every step under one of them in that order, the
 * progress bar a share of steps done, resume from what was saved, and
 * «Continue» greyed exactly where a choice is required.
 */
describe("the first-time flow's shape", () => {
  it("walks the five stages in the reference's order, and every step belongs to one", () => {
    expect(STAGES).toEqual(["signup", "permissions", "setup", "learn", "personalize"]);
    /* stages never go backwards along the steps — a rail that lit «set up»
       and then «permissions» would read as the flow losing its place */
    let last = -1;
    for (const id of STEP_IDS) {
      const at = STAGES.indexOf(STEP_STAGE[id]);
      expect(at, `${id} is under a real stage`).toBeGreaterThanOrEqual(0);
      expect(at, `${id} does not step back a stage`).toBeGreaterThanOrEqual(last);
      last = at;
    }
    /* and every stage has at least one step — an empty stage is a label
       that lights for nothing */
    for (const stage of STAGES) {
      expect(STEP_IDS.some((id) => STEP_STAGE[id] === stage), `${stage} has a step`).toBe(true);
    }
  });

  it("next and previous are inverses, and the ends are ends", () => {
    for (let i = 0; i < STEP_IDS.length; i += 1) {
      const id = STEP_IDS[i]!;
      const next = nextStep(id);
      if (i === STEP_IDS.length - 1) expect(next).toBeNull();
      else {
        expect(next).toBe(STEP_IDS[i + 1]);
        expect(prevStep(next!)).toBe(id);
      }
    }
    expect(prevStep(STEP_IDS[0])).toBeNull();
  });

  it("the bar is the share of steps already answered — empty at the first, never full", () => {
    expect(progress(STEP_IDS[0])).toBe(0);
    const at = progress(STEP_IDS[STEP_IDS.length - 1]!);
    expect(at).toBeGreaterThan(0.85);
    expect(at).toBeLessThan(1);
  });

  it("resumes from the saved step, and from the first when nothing sensible was saved", () => {
    expect(resumeStep({ step: "hotkey" })).toBe("hotkey");
    expect(resumeStep({})).toBe("welcome");
    expect(resumeStep(undefined)).toBe("welcome");
    /* a stale or foreign value — an old build's step name — must not strand
       the flow on nothing */
    expect(resumeStep({ step: "recording" as never })).toBe("welcome");
  });

  it("«Continue» waits for a choice on the question steps and on nothing else", () => {
    expect(ready("welcome", {})).toBe(false);
    expect(ready("welcome", { source: "friend" })).toBe(true);
    expect(ready("goals", { goals: [] })).toBe(false);
    expect(ready("goals", { goals: ["meetings"] })).toBe(true);
    expect(ready("work", {})).toBe(false);
    expect(ready("work", { work: "founder" })).toBe(true);
    expect(ready("places", {})).toBe(false);
    expect(ready("data", {})).toBe(false);
    expect(ready("data", { voiceprint: "none" })).toBe(true);
    expect(ready("languages", { languages: [] })).toBe(false);
    /* the control IS the choice on these */
    for (const id of ["mic", "hotkey", "dictate", "faster", "savings"] as const) {
      expect(ready(id, {}), id).toBe(true);
    }
  });

  /**
   * «later» BEGINS WITH THE PERMISSIONS STAGE (user, 2026-09-18: "remove the
   * later for the first four pages"). Asserted as the RELATIONSHIP rather
   * than as four names: everything before the first skippable step is the
   * sign-up stage and nothing from it on is — so a fifth question added to
   * sign-up is covered without a count to update, and a permission step
   * moved ahead of the questions is a red rather than a silent door.
   */
  it("the sign-up questions cannot be skipped; every step from the permissions stage on can", () => {
    expect(STEP_STAGE[FIRST_SKIPPABLE]).toBe("permissions");
    const boundary = STEP_IDS.indexOf(FIRST_SKIPPABLE);
    expect(boundary).toBe(4);
    for (const id of STEP_IDS) {
      const before = STEP_IDS.indexOf(id) < boundary;
      expect(canSkip(id), `canSkip(${id})`).toBe(!before);
      if (before) expect(STEP_STAGE[id], `${id} sits before the door and is not a sign-up question`).toBe("signup");
      else expect(STEP_STAGE[id], `${id} sits after the door and is still sign-up`).not.toBe("signup");
    }
  });

  it("toggling keeps the option order, whatever order things were picked in", () => {
    let list = toggle(undefined, "tasks", OPTIONS.goals);
    list = toggle(list, "meetings", OPTIONS.goals);
    expect(list).toEqual(["meetings", "tasks"]);
    expect(toggle(list, "tasks", OPTIONS.goals)).toEqual(["meetings"]);
  });

  it("the savings figure is whole hours, bounded by the slider, and grows with the load", () => {
    expect(SPEED_RATIO).toBeGreaterThan(1);
    const low = hoursSavedPerWeek(TYPING_HOURS.min);
    const high = hoursSavedPerWeek(TYPING_HOURS.max);
    expect(Number.isInteger(low) && Number.isInteger(high)).toBe(true);
    expect(high).toBeGreaterThan(low);
    /* out-of-range input is clamped, not extrapolated into a fantasy */
    expect(hoursSavedPerWeek(100)).toBe(high);
    expect(hoursSavedPerWeek(-3)).toBe(low);
    /* and the arithmetic is the estimate it claims: at ratio r, a day of h
       hours typing costs h/r hours spoken */
    expect(hoursSavedPerWeek(4)).toBe(Math.round(4 * 5 * (1 - 1 / SPEED_RATIO)));
  });
});
