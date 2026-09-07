/**
 * How a voice is REPRESENTED by more than one recording of it (db/0207).
 *
 * Pure arithmetic, in its own module, because every rule here is invisible
 * from a screen and none of it needs a database or a microphone to be wrong:
 * a centroid that drifts toward the loudest clip, a cap that keeps the wrong
 * end of the list, an aggregation that reads as "more samples is better" while
 * making a print worse. These are the shapes a test can hold.
 *
 * ── WHY TAKES ARE KEPT, NOT MERGED ────────────────────────────────────────
 *
 * 0096 averaged each new clip into one running vector on the reasoning that
 * "speaker embeddings average well". They do — within a recording condition.
 * Across conditions the mean is a point that is NEITHER: enrol on a headset
 * and again through a laptop, and the stored centroid sits between two
 * clusters and scores worse against both than either take would alone. This is
 * why multi-condition enrolment is scored against the BEST take rather than
 * against their average, and it costs one cosine per take to do.
 */

/**
 * How many takes a print keeps. Not a storage limit — 0207's own check allows
 * fifty — but a decision about what a print MEANS: past a handful, another
 * reading of the same script in the same room adds a near-duplicate that
 * cannot change any verdict, and the takes that matter are the ones from
 * conditions not already represented. When it is full the OLDEST goes: a
 * person's voice, room and microphone all change, and the recent takes are
 * the ones that describe them now.
 */
export const MAX_TAKES = 8;

/** a vector's length, or 0 for the degenerate ones */
export function norm(v: readonly number[]): number {
  let n = 0;
  for (const x of v) n += x * x;
  return Math.sqrt(n);
}

/**
 * The same direction, unit length. Cosine ignores magnitude — but an AVERAGE
 * does not, which is the entire reason this function exists: 0096 summed raw
 * vectors, so a longer or louder clip arrived with a bigger norm and pulled
 * the print toward itself. A zero vector is returned unchanged rather than
 * divided by zero; the callers refuse it before it reaches here.
 */
export function unit(v: readonly number[]): number[] {
  const n = norm(v);
  return n === 0 ? [...v] : v.map((x) => x / n);
}

/**
 * The print a set of takes stands for: the mean of their DIRECTIONS, itself
 * unit length. This is what `person.voiceprint` holds — the one-vector answer
 * for every reader that does not care about takes — and it is derived here so
 * that the two can never disagree about the same person.
 */
export function centroidOf(takes: readonly (readonly number[])[]): number[] {
  /*
   * A take is usable if it has a DIRECTION. The eight-dimension floor that
   * stood here is db/0081's and the enrolment route's — it is checked where
   * a vector enters the product, and re-checking it inside the arithmetic
   * made this function silently return nothing for any vector shorter than
   * eight, which its own test caught by asking for the centroid of a pair of
   * 2-D vectors and getting `[]`. An invariant enforced at a different
   * altitude than it is promised reads as rigour and behaves as a landmine.
   */
  const usable = takes.filter((t) => norm(t) > 0);
  if (usable.length === 0) return [];
  const dim = usable[0]!.length;
  const sum = new Array<number>(dim).fill(0);
  for (const take of usable) {
    if (take.length !== dim) continue; // a different model's vector, refused
    const u = unit(take);
    for (let i = 0; i < dim; i += 1) sum[i]! += u[i]!;
  }
  return unit(sum);
}

/**
 * The take list after one more recording. Same-dimension takes only — a
 * vector from another extractor lives in a different space, and a list that
 * mixed them would produce a centroid of nothing and a max-score that means
 * nothing (0081's rule, enforced here rather than trusted).
 */
export function withTake(
  prior: readonly (readonly number[])[] | null | undefined,
  take: readonly number[],
  max: number = MAX_TAKES,
): number[][] {
  const fresh = [...take];
  const kept = (prior ?? [])
    .filter((t) => t.length === fresh.length)
    .map((t) => [...t]);
  const all = [...kept, fresh];
  return all.slice(Math.max(0, all.length - max));
}

/** cosine — one spelling for the whole package (the worker imports it) */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * How well a trial vector matches a PERSON — the best of their takes.
 *
 * `max`, never `mean`: the question a match asks is "have I heard this voice
 * before", and one take recorded in this room answering yes is the whole
 * point of keeping several. A mean would let two takes from other conditions
 * drag a true match under the bar, which is the defect 0207 exists to end.
 */
export function scorePerson(
  trial: readonly number[],
  takes: readonly (readonly number[])[],
): number {
  let best = 0;
  for (const take of takes) {
    const s = cosine(trial, take);
    if (s > best) best = s;
  }
  return best;
}
