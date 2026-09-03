import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAIN_TOOL_NAMES } from "../src/agent/domain-tools.ts";

/**
 * THE SHIPPED AGENTS READ EVERYTHING THE ASSISTANT READS.
 *
 * User report, 2026-09-03: "the agents still not working well ... the
 * assistant is already do what agents are doing." The second half was the
 * diagnosis. An agent run is the ordinary assistant run plus a persona and
 * MINUS whatever its `tools` array leaves out — `allowedTools` can only narrow
 * (runtime.ts), by design, because a user-built agent for one job should be
 * narrow.
 *
 * db/0163 seeded Roya and Ava with the four transcript tools that existed that
 * day. 0167 added `list_members` and taught it to the assistant. Nothing
 * taught it to them, and nothing could say so: a ceiling is silent about what
 * it is keeping out. So "who is in my organization" was answerable by the
 * assistant and not by the analyst whose whole description is reading and
 * reporting — an agent strictly weaker than the thing it is offered as an
 * alternative to.
 *
 * This is the seam instrument for that (rule 13½, fifth family member): the
 * SEED is compared against the code's own registry, so the next domain tool to
 * land fails here rather than being discovered by somebody asking an agent a
 * question it should be able to answer.
 *
 * It reads the migration text rather than the database, deliberately — this
 * runs in the ordinary suite with no connection, and the thing being asserted
 * is what a fresh deployment gets. The db suite asserts the live rows
 * (0168's own checks); these two together are the claim.
 */
const MIGRATIONS = join(process.cwd(), "..", "db", "migrations");

/** the newest migration that sets `tools` on the system agents */
function seededTools(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of [...files].reverse()) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    /* the write must be the one that TARGETS the system pair — an unrelated
       migration mentioning the column would otherwise be read as the seed */
    if (!/tools\s*=\s*'\[/.test(text) || !/level\s*=\s*'system'/.test(text)) continue;
    const match = /tools\s*=\s*'(\[[^']*\])'/.exec(text);
    if (!match) continue;
    return JSON.parse(match[1]!.replace(/\s+/g, " ")) as string[];
  }
  throw new Error("no migration seeds the system agents' tools — the parser is stale");
}

describe("what the shipped agents can reach", () => {
  it("had something to read — the vacuity guard", () => {
    /* a parser that found nothing would make every set-comparison below
       trivially true, which is the failure this family of checks keeps
       finding in itself */
    expect(seededTools().length).toBeGreaterThan(3);
    expect(DOMAIN_TOOL_NAMES.length).toBeGreaterThan(3);
  });

  it("carries every domain tool the platform implements", () => {
    /*
     * The producer is `createDomainTools()`, and its exported name list is
     * what this compares against. `DOMAIN_TOOL_NAMES` is the SEEDED SKILL's
     * four; the implemented set is larger, so the assertion is against the
     * implementation rather than against that constant — the whole point is
     * that a tool can exist and not be in anybody's declared list.
     */
    const implemented = implementedToolNames();
    const seeded = new Set(seededTools());
    const missing = implemented.filter((name) => !seeded.has(name));
    expect(missing, "domain tools the shipped agents cannot use").toEqual([]);
  });

  it("names no tool that does not exist", () => {
    /* the other direction: a seed naming a retired tool is not an error the
       runtime reports — `filterDeclaredTools` simply matches nothing, and the
       agent quietly loses a capability its row claims to have */
    const implemented = new Set(implementedToolNames());
    const invented = seededTools().filter((name) => !implemented.has(name));
    expect(invented, "seeded tool names with no implementation").toEqual([]);
  });

  it("the check can fail — the control", () => {
    /* staged: an agent seeded with yesterday's list. Without this the two
       comparisons above pass identically against a parser returning the same
       thing for both sides. */
    const implemented = implementedToolNames();
    const stale = new Set(implemented.slice(0, implemented.length - 1));
    expect(implemented.filter((n) => !stale.has(n))).toHaveLength(1);
  });
});

/**
 * The names `createDomainTools()` actually registers, read from its source.
 *
 * Calling the factory would need `pi` mocked (a top-level `Type.Object()` call
 * makes importing it eagerly expensive — domain-tools.test.ts mocks it for
 * exactly this reason), and the thing being asserted is a list of names. The
 * `name:` fields in that file are the list.
 */
function implementedToolNames(): string[] {
  const source = readFileSync(
    join(process.cwd(), "src", "agent", "domain-tools.ts"), "utf8",
  );
  const body = source.slice(source.indexOf("export function createDomainTools"));
  const names = [...body.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]!);
  expect(names.length, "the source scan found tool names").toBeGreaterThan(3);
  return names;
}
