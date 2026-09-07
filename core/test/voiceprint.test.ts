import { describe, expect, it } from "vitest";
import {
  MAX_TAKES, centroidOf, cosine, scorePerson, unit, withTake,
} from "../src/api/voiceprint.ts";
import { decideMatch } from "../src/worker/voice-match.ts";

/**
 * THE ARITHMETIC BEHIND A MORE POWERFUL ENROLMENT (db/0207).
 *
 * Every rule here is invisible from a screen: a print that quietly drifts
 * toward whichever clip was loudest, a cap that keeps the wrong end of the
 * list, an aggregation that reads as "more samples is better" while making a
 * voice harder to recognise. The failures are all silent and all arithmetic,
 * which is exactly what a pure module is for.
 */
describe("a print is the mean of DIRECTIONS, not of vectors", () => {
  it("a loud take does not drag the centroid onto itself", () => {
    /*
     * THE 0096 DEFECT, held as a test. Two takes of the same voice pointing
     * 90° apart in this toy space; the second arrives with ten times the
     * magnitude — a longer or louder clip. Averaging the RAW vectors lands
     * the print almost on top of the loud one (cos ≈ 0.995 to it, ≈ 0.1 to
     * the quiet one); averaging their directions lands it between them.
     */
    const quiet = [1, 0];
    const loud = [0, 10];
    const c = centroidOf([quiet, loud]);
    expect(cosine(c, quiet)).toBeCloseTo(cosine(c, loud), 6);
    /* and the raw mean is what that would have been — the control that makes
       the assertion above about DIRECTION rather than about luck */
    const rawMean = quiet.map((v, i) => (v + loud[i]!) / 2);
    expect(cosine(rawMean, loud)).toBeGreaterThan(0.99);
    expect(cosine(rawMean, quiet)).toBeLessThan(0.2);
  });

  it("is itself unit length, so it can be stored beside takes and compared to anything", () => {
    const c = centroidOf([[3, 4], [0, 5]]);
    expect(Math.hypot(...c)).toBeCloseTo(1, 6);
  });

  it("a vector from another model is left out rather than averaged in", () => {
    /* 0081's rule: two extractors live in different spaces. A centroid over
       both would be a confident number about nothing. */
    const c = centroidOf([[1, 0], [0, 1], [1, 0, 0]]);
    expect(c).toHaveLength(2);
  });

  it("no usable take is an EMPTY print, never a zero vector", () => {
    /* a zero vector has cosine 0 with everything, which reads as "enrolled
       and never matching" — the shape that hides a broken extractor */
    expect(centroidOf([])).toEqual([]);
    expect(centroidOf([[0, 0, 0]])).toEqual([]);
  });
});

describe("the take list", () => {
  it("keeps the NEWEST at the cap — a voice and its room change", () => {
    const takes = Array.from({ length: MAX_TAKES }, (_, i) => [i, 0]);
    const next = withTake(takes, [99, 0]);
    expect(next).toHaveLength(MAX_TAKES);
    expect(next.at(-1)).toEqual([99, 0]);
    /* the OLDEST is what went, not the newest and not one from the middle */
    expect(next[0]).toEqual([1, 0]);
  });

  it("a first enrolment is a one-take list", () => {
    expect(withTake(null, [1, 2])).toEqual([[1, 2]]);
  });

  it("drops takes of another dimension — a model change starts a new list", () => {
    expect(withTake([[1, 2, 3]], [4, 5])).toEqual([[4, 5]]);
  });

  it("copies rather than aliasing the caller's arrays", () => {
    const take = [1, 2];
    const list = withTake(null, take);
    take[0] = 99;
    expect(list[0]).toEqual([1, 2]);
  });
});

describe("a person scores their BEST take", () => {
  it("one take from the right room is enough — which is the whole point", () => {
    /*
     * The measured failure this exists for: the same person scored 0.79 from
     * a microphone and 0.34 online. With both conditions enrolled, the online
     * trial is answered by the online take; a MEAN over the two would average
     * the match away and refuse the person again.
     */
    const trial = [0, 1];
    const takes = [[1, 0], [0.1, 0.995]];
    expect(scorePerson(trial, takes)).toBeGreaterThan(0.99);
    const mean = takes[0]!.map((v, i) => (v + takes[1]![i]!) / 2);
    expect(cosine(trial, mean)).toBeLessThan(0.8);
  });

  it("no takes is 0, not NaN", () => {
    expect(scorePerson([1, 0], [])).toBe(0);
  });
});

describe("decideMatch over people with several takes", () => {
  const alice = { person_id: "alice", vectors: [[1, 0, 0], [0.9, 0.44, 0]] };
  const bob = { person_id: "bob", vectors: [[0, 1, 0]] };

  it("a person's own second take is not a rival candidate", () => {
    /*
     * THE TRAP THIS SHAPE INTRODUCES, and the reason `scorePerson` runs
     * before the sort rather than after it. Flattened into one candidate per
     * TAKE, Alice's two takes would be the top two scores, the margin would
     * compare her against herself, and every well-enrolled person would be
     * permanently "ambiguous" — a refusal that gets worse the more carefully
     * somebody enrols.
     */
    const v = decideMatch([1, 0.05, 0], [alice, bob], 0.55, 0.1);
    expect(v).toMatchObject({ person_id: "alice" });
  });

  it("…and two DIFFERENT people who are genuinely close are still refused", () => {
    /* the control: without it, "never ambiguous" passes the test above and
       is completely wrong */
    const twin = { person_id: "twin", vectors: [[0.99, 0.14, 0]] };
    const v = decideMatch([1, 0.07, 0], [alice, twin], 0.55, 0.1);
    expect(v).toMatchObject({ person_id: null, why: "ambiguous" });
  });
});

describe("unit", () => {
  it("leaves a zero vector alone rather than dividing by zero", () => {
    expect(unit([0, 0])).toEqual([0, 0]);
  });
});
