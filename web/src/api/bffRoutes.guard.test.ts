import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY BFF PATH THE CLIENT CALLS MUST HAVE A ROUTE FILE.
 *
 * Rule 13½'s oldest shape, at the one seam that had no instrument: a consumer
 * with no producer, where nothing can see it. `api.recallDecisions` shipped
 * calling `/api/meetings/:id/recall` while that route file did not exist —
 * the typecheck passed (a fetch URL is a string), 1370 tests passed (the
 * client is mocked everywhere), and the production build passed (Next builds
 * the routes that ARE there). The only symptom would have been a 404 during a
 * live meeting, which the hook swallows on purpose.
 *
 * This is the check the 2026-08-13 close declaration asked for and never got:
 * **"NO BFF ROUTE" is the precise claim**, and it is now a claim something
 * asserts rather than one a person has to notice.
 *
 * ── WHY IT MATCHES THE SHAPE, NOT THE STRING ──────────────────────────────
 *
 * `/api/meetings/${id}/recall` is a template, and `src/app/api/meetings/[id]/
 * recall/route.ts` is its file. So an interpolation matches exactly one
 * dynamic segment and nothing else — a substring search would be satisfied by
 * any file whose path happened to contain "recall", which is the
 * name-matching-itself trap this repo has recorded three times.
 */
const CLIENT = join(process.cwd(), "src", "api", "client.ts");
const API_ROOT = join(process.cwd(), "src", "app", "api");

/**
 * Every `/api/...` path the client asks for, as a list of segments.
 *
 * TWO patterns, not one alternation over `` [^`"]+ ``: a template literal
 * legitimately contains double quotes inside its interpolations
 * (`${archived ? "a" : "b"}`), and a character class excluding both delimiters
 * truncates exactly there. The first version did, and reported four routes
 * missing that all exist — a checker that manufactures false positives is
 * muted within a week and is then worse than absent (this repo has deleted
 * one for precisely that).
 */
function calledPaths(): { raw: string; segments: string[] }[] {
  const source = readFileSync(CLIENT, "utf8");
  const out: { raw: string; segments: string[] }[] = [];
  const patterns = [
    /bff(?:<[^>]*>)?\(\s*`([^`]+)`/g,     // a template literal
    /bff(?:<[^>]*>)?\(\s*"([^"]+)"/g,     // a plain string
  ];
  for (const pattern of patterns) {
    for (const m of source.matchAll(pattern)) {
      const raw = m[1]!;
      if (!raw.startsWith("/api/")) continue;
      /*
       * THE QUERY STRING IS THE FIRST `?` OUTSIDE AN INTERPOLATION.
       *
       * `${archived ? "archive" : "unarchive"}` contains one, and a plain
       * `split("?")` cut the path at it — leaving `${archived ` and reporting
       * a route that exists. Masking the interpolations first is what makes
       * the two kinds of `?` distinguishable at all.
       */
      const masked = raw.replace(/\$\{[^}]*\}/g, (g) => "\u0000".repeat(g.length));
      const cut = masked.indexOf("?");
      const path = cut === -1 ? raw : raw.slice(0, cut);
      const segments = path.slice("/api/".length).split("/").filter((s) => s !== "");
      out.push({ raw, segments });
    }
  }
  return out;
}

/** does the route tree serve this shape? An interpolation is one dynamic segment. */
function resolves(segments: string[], dir = API_ROOT): boolean {
  if (segments.length === 0) return existsSync(join(dir, "route.ts"));
  const [head, ...rest] = segments;
  /*
   * A QUERY SUFFIX IS NOT A SEGMENT. `/api/admin/audit${suffix}` is the audit
   * route plus a query string the caller built, so the segment to resolve is
   * `audit` — a static prefix followed by an interpolation is that prefix.
   * Only a segment that is ENTIRELY an interpolation is a dynamic one.
   */
  const whole = head!;
  /*
   * AN INTERPOLATION THAT PICKS BETWEEN NAMES IS BOTH NAMES.
   * `${archived ? "archive" : "unarchive"}` is not a dynamic segment — it is a
   * choice between two static folders, and the useful thing to check is that
   * BOTH of them exist. Treating it as dynamic would have looked for a `[x]`
   * folder and reported a route that is there; skipping it would have stopped
   * checking a path where a typo in one branch is exactly the defect this
   * guard is for.
   */
  const literals = [...whole.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (whole.startsWith("${") && literals.length > 0) {
    return literals.every((name) => resolves([name, ...rest], dir));
  }
  const wanted = whole.startsWith("${") ? whole : whole.replace(/\$\{.*$/, "");
  const interpolated = wanted.startsWith("${");
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
  } catch {
    return false;
  }
  for (const entry of entries) {
    const dynamic = entry.startsWith("[");
    if (interpolated ? !dynamic : !(entry === wanted || dynamic)) continue;
    /* a catch-all serves everything below it */
    if (entry.startsWith("[[...") || entry.startsWith("[...")) return true;
    if (resolves(rest, join(dir, entry))) return true;
  }
  return false;
}

describe("every BFF path the client calls", () => {
  it("had something to check — the client was actually read", () => {
    /* the vacuum guard: a moved file or a renamed helper makes every
       assertion below vacuously true, and this family has been vacuous in
       this repo before */
    const paths = calledPaths();
    expect(paths.length, "no /api/ paths found — the parser is stale").toBeGreaterThan(60);
    /* and it read BOTH spellings: a regex that lost the template-literal half
       would still clear the count above on the plain strings alone */
    expect(paths.some((p) => p.raw.includes("${")), "no interpolated paths — the template pattern is stale").toBe(true);
    /*
     * AND THE PARSER'S OWN CONTROL, which the first version did not have: the
     * `resolves` control below passes segments directly, so it could not see
     * that `calledPaths` was truncating a ternary at its own `?`. A check's
     * controls have to cover every stage that can be wrong, not the one whose
     * name is on the test.
     */
    /* the TERNARY, not the first path with "archive" in it: a plain
       /conversations/:id/archive matched first and the control measured a
       path with no question mark in it at all */
    const ternary = paths.find((p) => p.raw.includes("? \"archive\""));
    expect(ternary, "the ternary path is gone — this control has no subject").toBeDefined();
    expect(ternary?.segments.at(-1), "a ternary segment was cut at its own question mark")
      .toContain("unarchive");
  });

  it("resolves to a route file", () => {
    const missing = calledPaths()
      .filter((p) => !resolves(p.segments))
      .map((p) => p.raw);
    expect(
      [...new Set(missing)],
      "a client method calls a BFF route that does not exist — a 404 nothing else can see",
    ).toEqual([]);
  });

  it("the control: an invented path does NOT resolve", () => {
    /*
     * Without this, "everything resolves" is equally true of a resolver that
     * says yes to anything — which is the shape that makes a guard read as
     * coverage and assert nothing.
     */
    expect(resolves(["meetings", "${id}", "not-a-route"])).toBe(false);
    expect(resolves(["nonsense"])).toBe(false);
    /* and the positive control, so a resolver that says NO to everything is
       equally visible */
    expect(resolves(["me"])).toBe(true);
    expect(resolves(["meetings", "${id}", "recall"])).toBe(true);
    /* the alternation, both ways: both branches present resolves, and one
       invented branch must NOT — otherwise "every branch exists" is satisfied
       by a check that looks at the first one and stops */
    expect(resolves(["assistant", "sessions", "${id}",
      '${a ? "archive" : "unarchive"}'])).toBe(true);
    expect(resolves(["assistant", "sessions", "${id}",
      '${a ? "archive" : "not-a-route"}'])).toBe(false);
  });
});
