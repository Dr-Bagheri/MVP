import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fa from "./fa.json";
import en from "./en.json";
import { CAPABILITY_GROUPS } from "@/components/platform/agentCapabilities";

/**
 * EVERY TOOL HAS A SENTENCE, IN BOTH LOCALES.
 *
 * `toolDescription()` turns a tool name into something a person can read, and
 * falls back to the NAME with its underscores spaced when the catalogue has no
 * entry. That fallback is right — a capability the copy has not met should
 * still appear — and it is also silent, which is how `agents.tool` came to
 * hold ZERO entries while the resolver that reads it had been written, tested
 * and shipped. The agent page rendered `search_transcripts` beside a picture of
 * a gear for as long as that page has existed.
 *
 * A graceful fallback is exactly the shape that needs a check: nothing is
 * broken, nothing throws, and the screen quietly shows identifiers.
 *
 * The corpus is core's own registries — the producer — so a tool added there
 * fails here rather than being discovered by somebody reading their own page.
 */
const AGENT_DIR = join(process.cwd(), "..", "core", "src", "agent");

/** every tool name the platform registers, from the four files that define them */
function registeredTools(): string[] {
  const names: string[] = [];
  for (const file of readdirSync(AGENT_DIR)) {
    if (!/^(domain-tools|write-tools|platform-tools|client-tools)\.ts$/.test(file)) continue;
    const source = readFileSync(join(AGENT_DIR, file), "utf8");
    for (const m of source.matchAll(/name: "([a-z_]+)"/g)) names.push(m[1]!);
  }
  return [...new Set(names)];
}

const faTools = (fa.agents as { tool?: Record<string, unknown> }).tool ?? {};
const enTools = (en.agents as { tool?: Record<string, unknown> }).tool ?? {};

describe("what an agent can do, in words", () => {
  it("had something to check — the registries were actually read", () => {
    /* a moved file or a renamed field makes every assertion below vacuous,
       and this family of check has been vacuous in this repo before */
    expect(registeredTools().length, "no tools found — the parser is stale")
      .toBeGreaterThan(30);
    expect(Object.keys(faTools).length).toBeGreaterThan(30);
  });

  it("names every registered tool, in Persian and English", () => {
    const missing: string[] = [];
    for (const name of registeredTools()) {
      if (typeof faTools[name] !== "string") missing.push(`fa: ${name}`);
      if (typeof enTools[name] !== "string") missing.push(`en: ${name}`);
    }
    expect(
      missing,
      "a tool with no sentence renders as its own identifier on the agent's page",
    ).toEqual([]);
  });

  it("and no Persian sentence is still English", () => {
    /*
     * The half Persian-first hides. A key present in both files passes the
     * check above even when the fa value is the English sentence somebody
     * pasted while adding it — and nobody reading the default locale would
     * see the difference, because they are reading the one that is right.
     */
    const latin = Object.entries(faTools)
      .filter(([, v]) => typeof v === "string" && /[A-Za-z]{3,}/.test(v))
      .map(([k]) => k);
    expect(latin, "a Persian tool sentence that is still English").toEqual([]);
  });

  it("groups no tool the platform does not register", () => {
    /*
     * The other direction: a group naming a retired tool renders a heading
     * with one fewer line under it and says nothing about why. Cheap to check,
     * and it is the half that rots — tools get removed more quietly than they
     * get added.
     */
    const registered = new Set(registeredTools());
    const ghosts = CAPABILITY_GROUPS
      .flatMap((g) => g.tools)
      .filter((t) => !registered.has(t));
    expect(ghosts, "a capability group names a tool nobody implements").toEqual([]);
  });

  it("the control: the checks CAN fail", () => {
    /* proves each sweep can answer no — without this a broken parser reports a
       complete catalogue forever, which is the exact failure that let
       `agents.tool` sit empty */
    expect(faTools["a_tool_nobody_wrote"]).toBeUndefined();
    expect(/[A-Za-z]{3,}/.test("Searches transcripts")).toBe(true);
    expect(/[A-Za-z]{3,}/.test("در رونوشت‌ها جست‌وجو می‌کند")).toBe(false);
  });
});
