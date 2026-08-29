import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fa from "@/messages/fa.json";

/**
 * Every shipped agent renders in the reader's language.
 *
 * ── the bug, twice ────────────────────────────────────────────────────────
 * A system agent's name and description are SEEDED in a migration, in one
 * language, and localized at render through `SYSTEM_AGENT_KEYS` +
 * `agents.sys_*` copy. Miss either half and the agent renders in whatever
 * language it was seeded with, in every locale.
 *
 * It happened in both directions on the same screen. `recorder` and
 * `commitments` were seeded in Persian and had no map entry, so they read
 * Persian in the English UI. The four agents seeded in ENGLISH by db/0065
 * (`it-support`, `legal`, `marketing`, `customer-support`, and `hr` and
 * `product-information` with them) never had entries either — they would
 * have read English in the Persian UI, and only escaped notice because a
 * later migration archived all six.
 *
 * A hand-maintained map of handles is a coverage list somebody has to
 * remember, which is the shape this repo has been removing all week. So the
 * list is DERIVED from the migrations that seed the agents.
 *
 * ── the retired list, and why it is not a loophole ───────────────────────
 * An archived agent needs no copy: nothing renders it. But "archived" is a
 * fact in the database, not in the migration text, so it cannot be derived
 * here — an entry below is a person saying so, with the migration that did
 * it. That is the allow-list-with-reasons idiom, and it is deliberately
 * more annoying than adding the copy would be.
 */
/* vitest runs with cwd = web/, and `import.meta.url` is not a file: URL
   under this config — so paths resolve from the working directory */
const migrationsDir = resolve(process.cwd(), "../db/migrations");
const appearance = readFileSync(
  resolve(process.cwd(), "src/components/platform/agentAppearance.ts"),
  "utf8",
);

/** Handles seeded as system agents, and never un-seeded. */
const RETIRED: Record<string, string> = {
  "it-support": "db/0065's first wave; archived before it ever shipped to a customer",
  legal: "db/0065's first wave; archived",
  marketing: "db/0065's first wave; archived",
  "customer-support": "db/0065's first wave; archived",
  hr: "db/0065's first wave; archived",
  "product-information": "db/0065's first wave; archived",
};

function seededSystemHandles(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    // only inside an assistant_agent insert — `('system', …)` also appears in
    // enum declarations and skill seeds, and matching those would make this a
    // false-positive factory on its first run
    for (const block of sql.split(/insert\s+into\s+echo\.assistant_agent/i).slice(1)) {
      const upTo = block.split(/;\s*$/m)[0] ?? block;
      for (const m of upTo.matchAll(/\(\s*'system'\s*,\s*'([a-z0-9-]+)'/gi)) {
        found.add(m[1]!);
      }
    }
  }
  return [...found].sort();
}

/** `recorder: "sys_recorder"` → the map, read from the source. */
function mappedHandles(): Map<string, string> {
  const at = appearance.indexOf("const SYSTEM_AGENT_KEYS");
  const body = appearance.slice(at, appearance.indexOf("\n};", at));
  return new Map(
    [...body.matchAll(/^\s*"?([a-z0-9-]+)"?:\s*"([a-z0-9_]+)"/gim)].map((m) => [m[1]!, m[2]!]),
  );
}

describe("shipped agents localize", () => {
  it("every system agent a migration seeds is mapped, or retired with a reason", () => {
    const mapped = mappedHandles();
    const unmapped = seededSystemHandles().filter((h) => !mapped.has(h) && !(h in RETIRED));
    expect(
      unmapped,
      `seeded as system agents and never given localized copy: ${unmapped.join(", ")}`,
    ).toEqual([]);
  });

  it("every mapped agent has a name AND a description in BOTH locales", () => {
    const missing: string[] = [];
    for (const [handle, key] of mappedHandles()) {
      for (const [locale, table] of [["en", en], ["fa", fa]] as const) {
        const agents = (table as { agents?: Record<string, unknown> }).agents ?? {};
        for (const suffix of ["_name", "_desc"]) {
          if (typeof agents[`${key}${suffix}`] !== "string") {
            missing.push(`${locale}: agents.${key}${suffix} (${handle})`);
          }
        }
      }
    }
    expect(missing, missing.join(", ")).toEqual([]);
  });

  it("read a real corpus, and can tell a missing entry from a clean parse", () => {
    /*
     * Both assertions above are empty-list checks and an empty parse
     * satisfies them perfectly — if either regex stopped matching, this file
     * would pass forever while checking nothing.
     */
    /*
     * NAMED MEMBERS rather than counts. The first version asserted
     * `size > 8` and the map holds exactly 8 — a magic number that was
     * already wrong on its first run, and would have gone wrong again the
     * next time an agent was added or archived. A count is a fact about
     * today wearing the costume of a rule.
     */
    const seeded = seededSystemHandles();
    const mapped = mappedHandles();
    // the parse reaches BOTH waves: 0065's first agents and this week's
    expect(seeded).toContain("meetings");
    expect(seeded).toContain("recorder");
    expect(seeded).toContain("legal");        // 0065, retired — proves the reach
    expect(mapped.get("recorder")).toBe("sys_recorder");
    expect(mapped.get("meetings")).toBe("sys_meetings");

    // the question it must answer NO to: a handle nobody mapped is caught
    const staged = [...seeded, "an-agent-nobody-localized"];
    expect(staged.filter((h) => !mapped.has(h) && !(h in RETIRED)))
      .toEqual(["an-agent-nobody-localized"]);
  });
});
