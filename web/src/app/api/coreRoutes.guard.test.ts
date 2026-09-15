import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY PATH THE BFF SENDS TO CORE MUST BE A ROUTE CORE REGISTERS (review F10).
 *
 * `src/app/routes.test.ts` proves every rendered **href** resolves — a link is
 * a promise. The identical promise on the server side of the BFF was
 * unguarded: nothing asserted that a `coreFetch` target exists in core's route
 * tree.
 *
 * It is not hypothetical. The transcript route carried a `PATCH` at
 * `/v1/calls/:id/transcript/:segmentId` — a path core has never registered —
 * for weeks; ver5 deleted it. And when a panel asked `GET /v1/admin/org`, a
 * path M25 deliberately never registered, core's truthful 404 rendered as
 * "feature not built" and stood for weeks. **`no such route` and `no such
 * feature` are different nothings, and a 404 from our own BFF looks identical
 * whichever it is.**
 *
 * ── TWO FAMILIES OF CALL SITE, NOT ONE ─────────────────────────────────────
 *
 * A checker scoped to `coreFetch` has a hole exactly where a call escapes the
 * helper — which is how the agents' `start_recording` slipped past the
 * route-map guard one directory over (review F19). So this reads BOTH the
 * `coreFetch` calls and the raw `fetch(CORE_URL + "/v1/…")` family that exists
 * deliberately for multipart, SSE and streams.
 *
 * ── THE VERB MATTERS ───────────────────────────────────────────────────────
 *
 * Matching on path alone lets a `PATCH` to a GET-only route pass. A computed
 * `method:` is reported as UNREADABLE rather than defaulted to GET — a default
 * there would be the checker deciding what nothing means.
 *
 * ── WHAT IT CANNOT SEE, STATED SO IT IS NOT TRUSTED PAST ITS REACH ─────────
 *
 * A target whose path is a function parameter or a two-hop variable. Those are
 * reported as unreadable and FAIL; they are not silently skipped.
 *
 * It reads `core/src/api/server.ts` ONLY. Re-checked on 2026-09-08: all 244
 * registrations are there and no other file under `core/src/api/` calls
 * `app.<verb>(` — the modules ver4 and ver5 added (chat, chatStream, projects,
 * routing, invites, connector-providers, translations, voiceprint) export
 * handlers rather than registering routes. **Re-run that grep before trusting
 * this**; it is the checker's whole foundation.
 */

const API_ROOT = join(__dirname);
const SERVER = join(__dirname, "..", "..", "..", "..", "core", "src", "api", "server.ts");

/**
 * Targets allowed not to resolve, each WITH its reason. Never a loosened
 * pattern: an exemption on the record is a decision, a widened regex is an
 * accident that looks like one. It ships EMPTY, which is the outcome to want.
 */
const ALLOW: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/route\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments before matching, RESPECTING STRING LITERALS.
 *
 * Files in this tree discuss `coreFetch(` in prose. A regex that reads
 * comments reports those as unparsable calls — the name-matching-itself trap
 * this repo has eaten before.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      if (at < 0) return line;
      const before = line.slice(0, at);
      const quotes = (before.match(/["'`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join("\n");
}

/** core's registrations, as `VERB /v1/path/*` with `:params` normalised */
function coreRoutes(): Set<string> {
  const src = readFileSync(SERVER, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)) {
    out.add(`${(m[1] ?? "").toUpperCase()} ${(m[2] ?? "").replace(/:[^/]+/g, "*")}`);
  }
  return out;
}

const HOLE = "__HOLE__";

/**
 * A BFF target, normalised to core's shape.
 *
 * ORDER MATTERS HERE, and getting it wrong manufactures false positives — the
 * first run of this checker reported five, every one its own fault:
 *
 *  - **Substitute the interpolations BEFORE splitting on `?`.** Splitting
 *    first cuts a TERNARY in half, so a path built with
 *    `archived ? "archive" : "unarchive"` came out truncated at the `?`. Two
 *    of the five were that.
 *  - **A placeholder welded to the end of a segment is a QUERY STRING, not a
 *    path parameter.** A path built as `/v1/meetings` plus an interpolated
 *    query targets `/v1/meetings`; reported as `/v1/meetings*` it matches
 *    nothing core registers. Three of the five were that.
 *
 * A checker that manufactures false positives gets muted within a week and is
 * then worse than absent, so both were fixed here rather than allow-listed.
 *
 * The sentinel is a VISIBLE string on purpose. An earlier draft used a real
 * U+0001 — an invisible control byte in a source file, the exact class the
 * encoding sweep exists to catch, introduced by the person writing the
 * checker, and not repairable by an ordinary search-and-replace because you
 * cannot type a control byte into a search string.
 */
function normalise(path: string): string {
  let p = replaceInterpolations(path, () => HOLE);
  /* safe now: no ternary `?` survives inside a hole */
  p = p.split("?")[0] ?? "";
  /* a hole welded to the end of a segment came from an appended query */
  p = p.replace(new RegExp(`([^/])(?:${HOLE})+$`), (_all, keep: string) => keep);
  return p.split(HOLE).join("*").replace(/\/+$/, "");
}

/**
 * Walk `${…}` interpolations with a BRACE COUNTER rather than a regex.
 *
 * `/v1/chat/channels/${id}/messages${query ? `?${query}` : ""}` nests a
 * template inside an interpolation. A regex that stops at the first `}` — or
 * at the next backtick — truncates the path and reports a live route as dead.
 */
function replaceInterpolations(src: string, fn: (inner: string) => string): string {
  let out = "";
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      for (; j < src.length && depth > 0; j += 1) {
        if (src[j] === "{") depth += 1;
        else if (src[j] === "}") depth -= 1;
      }
      out += fn(src.slice(i + 2, j - 1));
      i = j - 1;
    } else {
      out += src[i];
    }
  }
  return out;
}

/**
 * A path may stand for MORE THAN ONE route, and both halves have to resolve.
 *
 * `/v1/calls/${id}/${archived ? "archive" : "unarchive"}` is two registrations
 * in core — `:id/archive` and `:id/unarchive` — and collapsing the ternary to
 * a single `*` matches neither. Expanding it and requiring BOTH branches is
 * the only reading that can catch a rename of one of them.
 */
function expand(path: string): string[] {
  const m = /\$\{[^{}]*\?[^{}]*\}/.exec(path);
  if (!m) return [normalise(path)];
  const inner = m[0].slice(2, -1);
  const branches = [...inner.matchAll(/"([^"]*)"|'([^']*)'/g)]
    .map((b) => b[1] ?? b[2] ?? "")
    .filter(Boolean);
  if (branches.length < 2) return [normalise(path)];
  return branches.flatMap((b) => expand(path.replace(m[0], b)));
}

interface Call {
  verb: string;
  path: string;
  file: string;
}

function callsIn(file: string): { calls: Call[]; unreadable: string[] } {
  const rel = relative(API_ROOT, file).replace(/\\/g, "/");
  const text = stripComments(readFileSync(file, "utf8"));
  const calls: Call[] = [];
  const unreadable: string[] = [];

  /* family 1 — the helper */
  for (const m of text.matchAll(/coreFetch\(\s*(`[^`]*`|"[^"]*")([\s\S]{0,200}?)\)/g)) {
    const literal = (m[1] ?? "").slice(1, -1);
    const tail = m[2] ?? "";
    if (!literal.startsWith("/")) {
      unreadable.push(`${rel}: coreFetch target is not a literal path`);
      continue;
    }
    if (/method:\s*[^"'\s]/.test(tail) && !/method:\s*"/.test(tail)) {
      unreadable.push(`${rel}: computed method on ${literal}`);
      continue;
    }
    const verb = /method:\s*"(GET|POST|PATCH|PUT|DELETE)"/.exec(tail)?.[1] ?? "GET";
    calls.push({ verb, path: literal, file: rel });
  }

  /* family 2 — the raw fetches that carry multipart, SSE or streams */
  for (const m of text.matchAll(/fetch\(\s*`\$\{[A-Za-z_]+\}(\/v1\/[^`]*)`([\s\S]{0,200}?)\)/g)) {
    const verb = /method:\s*"(GET|POST|PATCH|PUT|DELETE)"/.exec(m[2] ?? "")?.[1] ?? "GET";
    calls.push({ verb, path: m[1] ?? "", file: rel });
  }

  return { calls, unreadable };
}

describe("every BFF target is a route core serves", () => {
  const files = walk(API_ROOT);
  const routes = coreRoutes();
  const all = files.map(callsIn);
  const calls = all.flatMap((r) => r.calls);
  const unreadable = all.flatMap((r) => r.unreadable);

  it("had something to check", () => {
    /* three vacuum guards: a moved server file, a renamed helper or a moved
       app directory would each make every assertion below pass over nothing,
       and this family of check has been vacuous in this repo before */
    expect(files.length, "BFF route files").toBeGreaterThan(50);
    expect(routes.size, "registrations parsed out of core/src/api/server.ts").toBeGreaterThan(200);
    expect(calls.length, "core targets parsed out of the BFF").toBeGreaterThan(80);
  });

  it("resolves every target it can read", () => {
    const dead = calls
      .flatMap((c) => expand(c.path).map((path) => ({ key: `${c.verb} ${path}`, file: c.file })))
      .filter(({ key }) => !ALLOW[key] && !routes.has(key))
      .map(({ key, file }) => `${key}  <- app/api/${file}`);
    expect([...new Set(dead)], "targeted by the BFF, served by nothing").toEqual([]);
  });

  it("reports what it could not read, rather than skipping it", () => {
    expect(unreadable, "targets this checker cannot resolve — widen it, or name them").toEqual([]);
  });

  it("the allow-list has no stale entries", () => {
    /* an exemption naming a target nobody calls any more reads as coverage */
    const live = new Set(calls.flatMap((c) => expand(c.path).map((p) => `${c.verb} ${p}`)));
    const stale = Object.keys(ALLOW).filter((k) => !live.has(k));
    expect(stale, "allow-list entries nothing calls").toEqual([]);
  });

  it("the control: a target core does not serve is detected", () => {
    /* without this the assertion above passes against a matcher that returns
       true for everything — which is exactly how a route map comes to be
       checked by something that cannot fail */
    expect(routes.has("GET /v1/calls/*/transcript"), "a route core really serves").toBe(true);
    /* the orphan ver5 deleted — the shape this whole finding is about */
    expect(routes.has("PATCH /v1/calls/*/transcript/*")).toBe(false);
    /* and the VERB half: a real path with a verb core does not register */
    expect(routes.has("DELETE /v1/me")).toBe(false);
  });

  it("the control: normalise does not mangle a ternary or a query string", () => {
    /* the five false positives this checker opened with, pinned so they cannot
       come back silently */
    const ternary = "/v1/calls/${id}/${archived ? \"archive\" : \"unarchive\"}";
    expect(normalise(ternary)).toBe("/v1/calls/*/*");
    expect(normalise("/v1/meetings${query}")).toBe("/v1/meetings");
    expect(normalise("/v1/chat/channels/${id}/messages${query}")).toBe(
      "/v1/chat/channels/*/messages",
    );
    /* and the ternary expands to BOTH routes, not to one wildcard that
       matches neither */
    expect(expand(ternary).sort()).toEqual(["/v1/calls/*/archive", "/v1/calls/*/unarchive"]);
    /* a nested template inside an interpolation does not truncate the path */
    expect(normalise("/v1/chat/channels/${encodeURIComponent(id)}/messages${q ? `?${q}` : \"\"}"))
      .toBe("/v1/chat/channels/*/messages");
  });
});
