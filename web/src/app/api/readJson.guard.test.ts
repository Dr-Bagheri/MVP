import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A BFF ROUTE READS ITS BODY THROUGH `readJson`, NEVER BARE `request.json()`.
 *
 * `request.json()` on an empty or malformed body THROWS, and the throw is not
 * a CoreError. Inside a route's `try { … } catch (error) { return
 * errorResponse(error) }` it fell through the catch-all as
 * `500 {"error":"unexpected","kind":"upstream"}` — the status that pages
 * somebody, for a caller who sent nothing; outside the try it was Next's
 * non-JSON 500. And because the parse usually ran BEFORE `coreFetch`'s
 * session check, a signed-out caller sending nonsense got 500 instead of 401
 * — the wrong second fact about the first. Found on `/api/tasks/:id/schedule`
 * (2026-09-04) and fixed there with a hand-rolled try/catch, copied twice more
 * (the invites routes); the 2026-09-06 check-up counted ~85 siblings still
 * bare. Nothing had ever asserted the seam: every route was correct about
 * core and wrong about its own caller.
 *
 * `readJson` in `@/server/core` is the ONE spelling — it throws the CoreError
 * (`400 invalid`, code `bad_body`) that every route's catch already turns into
 * the refusal it is. So the seam is asserted: under `app/api/**` no route may
 * call `request.json()` / `req.json()` bare.
 *
 * Deliberately NOT an offender: `request.json().catch(() => ({}))`, the
 * OPTIONAL-body spelling (a DELETE whose `reason` may be absent, a start whose
 * `format` may be omitted). There an empty body is a legitimate `{}` and a 400
 * would be the wrong answer — a different decision, not a missed conversion,
 * so the pattern names that form rather than loosening for it.
 *
 * Comments are stripped before matching. Prose about `request.json()` is not
 * a call, and a guard that fires on the sentence explaining the defect is the
 * name-matching-itself trap pointed the other way.
 */
const API_ROOT = join(__dirname);

/** A bare parse: the call itself, not followed by the optional-body `.catch(`. */
const BARE_PARSE = /\b(?:request|req)\.json\(\)(?!\s*\.catch\()/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/route\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Drop line and block comments, string-aware, so a URL inside a string
 * survives and a comment quoting the call does not count as one.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

describe("BFF routes read the body through readJson", () => {
  const routes = walk(API_ROOT);

  it("had something to check", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("no route parses its body bare", () => {
    const offenders: string[] = [];
    for (const file of routes) {
      const rel = relative(API_ROOT, file).replace(/\\/g, "/");
      if (BARE_PARSE.test(stripComments(readFileSync(file, "utf8")))) offenders.push(rel);
    }
    expect(offenders, "routes that call request.json() bare").toEqual([]);
  });

  it("the one spelling is in use (positive control)", () => {
    const users = routes.filter((file) => /\breadJson\(/.test(readFileSync(file, "utf8")));
    expect(users.length).toBeGreaterThanOrEqual(20);
  });

  it("the pattern tells a bare parse from the optional-body form, from readJson and from prose", () => {
    expect(BARE_PARSE.test("const body = (await request.json()) as X;")).toBe(true);
    expect(BARE_PARSE.test("body: await req.json(),")).toBe(true);
    expect(BARE_PARSE.test("const body = (await request.json().catch(() => ({}))) as X;")).toBe(false);
    expect(BARE_PARSE.test("const body = await readJson(request);")).toBe(false);
    const prose = "/* `await request.json()` throws on an empty body */\nconst b = await readJson(request);";
    expect(BARE_PARSE.test(stripComments(prose))).toBe(false);
    const url = 'const u = "http://x/y"; // request.json() here is a comment\nconst b = await request.json();';
    expect(stripComments(url)).toContain('"http://x/y"');
    expect(BARE_PARSE.test(stripComments(url))).toBe(true);
  });
});
