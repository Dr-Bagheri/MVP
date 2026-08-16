/**
 * Every /v1 route resolves an identity — asserted at the SOURCE, so
 * "forgot the auth check" is a red suite rather than a vulnerability.
 *
 * Adopted from Onyx's startup auth-coverage assertion (M28): their server
 * refuses to boot if any route lacks an auth dependency or an explicit
 * public marker. Ours runs in the suite because our routes resolve identity
 * imperatively (`await auth.require…`) rather than declaratively, so the
 * source is where the fact lives.
 *
 * The check walks route registrations in server.ts and requires each
 * handler's segment to contain an identity resolution. PUBLIC lists the
 * deliberate exceptions — and /health being in it is also this checker's
 * NEGATIVE CONTROL: a segment that genuinely has no auth call proves the
 * probe can tell the difference (the en-sweep lesson — an identification
 * that cannot fail cannot identify).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");

/** Routes that deliberately answer without an identity, each with its reason. */
const PUBLIC: Record<string, string> = {
  "GET /health": "the load balancer's probe — it must answer while the database is down",
};

interface Registration { key: string; at: number }

const REGISTRATION = /app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;

function registrations(): Registration[] {
  const found: Registration[] = [];
  for (const m of SRC.matchAll(REGISTRATION)) {
    found.push({ key: `${m[1]!.toUpperCase()} ${m[2]!}`, at: m.index! });
  }
  return found;
}

describe("auth coverage: no /v1 route answers without an identity", () => {
  const regs = registrations();

  it("found the route table at all (the checker has a subject)", () => {
    // INVALID-not-result: a refactor that moves registrations elsewhere
    // must break THIS line loudly, not let every per-route check vacuously
    // pass over an empty list.
    expect(regs.length).toBeGreaterThan(40);
  });

  it.each(regs.map((r, i) => [r.key, i] as const))("%s resolves an identity", (key, i) => {
    const reg = regs[i]!;
    const end = i + 1 < regs.length ? regs[i + 1]!.at : SRC.length;
    const handler = SRC.slice(reg.at, end);
    /*
     * Two doors count: `auth.require*` (verified + membership) and
     * `auth.verifiedClaims` (verified token, membership not yet required —
     * the shape of /v1/signup and /v1/invitations/redeem, the two routes
     * that exist FOR authenticated non-members). The checker's first run
     * flagged both; per the first-red rule they were verified before being
     * believed, and the checker was the wrong one — both routes verify the
     * token's signature, which is the wall this test is about.
     */
    const resolves = /await auth\.(require\w+|verifiedClaims)\(/.test(handler);
    if (PUBLIC[key]) {
      // the negative control: a listed-public route must genuinely lack it,
      // or the allow-list is hiding a route that grew auth it doesn't need
      expect(resolves, `${key} is listed public but resolves an identity`).toBe(false);
    } else {
      expect(resolves, `${key} has no auth.require* — either add one or list it in PUBLIC with a reason`).toBe(true);
    }
  });
});
