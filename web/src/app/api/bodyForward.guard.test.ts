import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A BFF ROUTE FORWARDS THE PARSED BODY, NEVER A STRING OF IT.
 *
 * `coreFetch` stringifies `init.body` itself. Four routes (members/message,
 * agents create, agents edit, admin set-password) passed
 * `body: JSON.stringify(await request.json())`, so core received a JSON
 * *string*, parsed it into a string, and read every field as `undefined`:
 * "password is required" for a valid password, "agent level is required"
 * for a valid agent, and — the worst shape — an agent EDIT that answered 200
 * with the row unchanged (`coalesce(null, …)` on every column). Born broken
 * on 2026-08-18/29 and 09-03, found by the 2026-09-06 check-up; nothing had
 * ever asserted the seam, because both halves were individually correct.
 *
 * So the seam is asserted: under `app/api/**` no route may hand `coreFetch`
 * a `JSON.stringify(` body. The one raw `fetch` that legitimately builds its
 * own request (the reset flow's signup call, which does not go through
 * `coreFetch`) is an entry WITH its reason — never a loosened pattern.
 */
const API_ROOT = join(__dirname);

const RAW_FETCH_ALLOWED: Record<string, string> = {
  "auth/reset/route.ts":
    "a raw fetch to core's signup door with its own bearer — not coreFetch, so it must stringify itself",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/route\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("BFF routes forward the parsed body", () => {
  const routes = walk(API_ROOT);

  it("had something to check", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("no route stringifies the body it hands to coreFetch", () => {
    const offenders: string[] = [];
    for (const file of routes) {
      const rel = relative(API_ROOT, file).replace(/\\/g, "/");
      if (RAW_FETCH_ALLOWED[rel]) continue;
      const text = readFileSync(file, "utf8");
      if (/body:\s*JSON\.stringify\(/.test(text)) offenders.push(rel);
    }
    expect(offenders, "routes that double-encode their body").toEqual([]);
  });

  it("the allow-list names real files that still make a raw fetch", () => {
    for (const rel of Object.keys(RAW_FETCH_ALLOWED)) {
      const text = readFileSync(join(API_ROOT, rel), "utf8");
      expect(text, rel).toMatch(/await fetch\(/);
      expect(text, rel).toMatch(/body:\s*JSON\.stringify\(/);
    }
  });
});
