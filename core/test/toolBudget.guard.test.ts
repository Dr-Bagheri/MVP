import { describe, expect, it, vi } from "vitest";

/*
 * The real `Type`, spread in from pi-ai: platform-tools builds its schemas at
 * module load, and a stubbed `Type` takes the file down before a test runs.
 */
vi.mock("../src/agent/pi.ts", async () => ({
  ...await import("@earendil-works/pi-ai"),
  runPi: vi.fn(),
}));

const { CLIENT_TOOLS } = await import("../src/agent/client-tools.ts");
const { createDomainTools } = await import("../src/agent/domain-tools.ts");
const { toolsFor } = await import("../src/agent/platform-tools.ts");
const { BUDGET, measureAll, overBudget } = await import("../src/agent/tool-budget.ts");

/**
 * THE TOOL BUDGET IS A CEILING, NOT A REPORT (2026-09-19).
 *
 * Every assistant turn carries the serialised schema of every offered tool,
 * and nothing had ever counted it: measured on production the day this was
 * written, a single model call with the full set cost ~18.6k input tokens
 * and the registries serialised to ~58k characters — the task-title argument
 * alone was a 230-character paragraph repeated on seven tools, the navigate
 * tool restated the platform map in 1.1k characters, seventeen descriptions
 * ran past 300. The diet brought the client registry from 47k to under the
 * ceiling below; this file is what keeps it there, one helpful sentence at a
 * time being exactly how it grew.
 *
 * Three limits rather than one total, because a total is satisfied by a
 * registry where one tool carries a page and ninety carry nothing — and the
 * model reads each tool's text when choosing it, so the per-tool shape is
 * what decides whether it chooses well.
 *
 * The measurement is `tool-budget.ts`, shared with `scripts/tool-budget.ts`
 * (the report): a guard that measured differently from the report would be
 * two opinions about one number.
 */
const domain = createDomainTools();
const platform = toolsFor();

describe("the tool budget", () => {
  it("had something to check — the registries are real and non-trivial", () => {
    expect(CLIENT_TOOLS.length).toBeGreaterThan(60);
    expect(domain.length).toBeGreaterThan(3);
    expect(platform.length).toBeGreaterThan(10);
  });

  it("no tool's description or argument runs past its limit", () => {
    const reasons = [...CLIENT_TOOLS, ...domain, ...platform].flatMap((t) => overBudget(t));
    expect(reasons, "a tool grew a paragraph").toEqual([]);
  });

  it("the client registry, serialised, stays under its ceiling", () => {
    const m = measureAll(CLIENT_TOOLS);
    expect(m.total, `client registry is ${m.total} chars (descriptions ${m.description}, parameters ${m.parameters})`)
      .toBeLessThanOrEqual(BUDGET.clientTotal);
  });

  it("every registry together stays under the turn's ceiling", () => {
    const m = measureAll([...CLIENT_TOOLS, ...domain, ...platform]);
    expect(m.total, `all registries serialise to ${m.total} chars`).toBeLessThanOrEqual(BUDGET.allTotal);
  });

  it("THE CONTROL: a staged paragraph is named, on the description and on the argument", () => {
    /*
     * Proves the predicate can answer NO — a version of `overBudget` that
     * returned [] for everything satisfies every line above and guards
     * nothing. The staged tool is one character over each limit, because a
     * limit that is off by one is the kind that lets the next sentence in.
     */
    const staged = {
      name: "staged_tool",
      description: "x".repeat(BUDGET.description + 1),
      parameters: {
        type: "object",
        properties: {
          fine: { type: "string", description: "short" },
          long: { type: "string", description: "y".repeat(BUDGET.argument + 1) },
          nested: { type: "object", properties: { deep: { type: "string", description: "z".repeat(BUDGET.argument + 1) } } },
        },
      },
    };
    const reasons = overBudget(staged);
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain("description is 401 chars");
    expect(reasons[1]).toContain("staged_tool.long");
    expect(reasons[2]).toContain("staged_tool.nested.deep");
    /* and exactly at the limit is fine — the ceiling is inclusive */
    expect(overBudget({ ...staged, description: "x".repeat(BUDGET.description), parameters: {} })).toEqual([]);
  });
});
