/**
 * THE TOOL BUDGET — what a registry costs the model per turn, measured the
 * way the runtime hands it over (2026-09-19).
 *
 * Every assistant turn carries the JSON of every offered tool: name,
 * description, parameters. Measured on production before the diet, a turn
 * with the full set was ~18.6k input tokens for one model call, and the
 * serialised registries alone were ~58k characters — the tool schemas were
 * the biggest single thing in the prompt, bigger than the conversation, the
 * standing orders and the working set together. Nothing had ever counted
 * them, so they grew one helpful sentence at a time (the task-title argument
 * was a 230-character paragraph on seven tools).
 *
 * This module is the ONE measurement, used by `scripts/tool-budget.ts` (the
 * report) and `test/toolBudget.guard.test.ts` (the ceiling). A guard that
 * measured differently from the report would be two opinions about one
 * number.
 *
 * The limits are per DESCRIPTION and per ARGUMENT description as well as a
 * total, because a total alone is satisfied by a registry where one tool
 * carries a page and ninety carry nothing — and the model reads each tool's
 * text when choosing it, so the per-tool shape is what decides whether it
 * chooses well.
 */
export interface ToolLike {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ToolMeasure {
  name: string;
  /** JSON.stringify({name, description, parameters}).length — the wire shape */
  total: number;
  description: number;
  parameters: number;
}

/**
 * The ceilings. Chosen from the measured registry AFTER the diet with a
 * margin small enough that the next paragraph-length sentence fails here
 * rather than shipping: a budget with room for another 20% is a budget
 * nobody notices being spent.
 */
export const BUDGET = {
  /** one tool's description, in characters */
  description: 400,
  /** one argument's description, in characters */
  argument: 200,
  /** the client registry, serialised — 101 tools at ~38.8k after the diet
      (47.3k before); the JSON-schema shape itself is ~17 characters per
      argument before a word of description, so the floor is not zero */
  clientTotal: 40_000,
  /** every registry together, serialised — ~48.5k after the diet (57.9k) */
  allTotal: 50_000,
} as const;

export function measureTool(tool: ToolLike): ToolMeasure {
  return {
    name: tool.name,
    total: JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length,
    description: tool.description.length,
    parameters: JSON.stringify(tool.parameters ?? {}).length,
  };
}

export function measureAll(tools: readonly ToolLike[]): { total: number; description: number; parameters: number } {
  return tools.map(measureTool).reduce(
    (acc, m) => ({ total: acc.total + m.total, description: acc.description + m.description, parameters: acc.parameters + m.parameters }),
    { total: 0, description: 0, parameters: 0 },
  );
}

/**
 * Every argument's description, walking the JSON-schema shape both
 * registries produce (TypeBox emits exactly this: `properties` → each with
 * an optional `description`). Nested objects are walked too, so a future
 * structured argument cannot hide a paragraph one level down.
 */
export function argumentDescriptions(parameters: unknown, prefix = ""): Array<{ name: string; description: string }> {
  const out: Array<{ name: string; description: string }> = [];
  if (typeof parameters !== "object" || parameters === null) return out;
  const props = (parameters as { properties?: Record<string, unknown> }).properties;
  if (typeof props !== "object" || props === null) return out;
  for (const [key, schema] of Object.entries(props)) {
    if (typeof schema !== "object" || schema === null) continue;
    const description = (schema as { description?: unknown }).description;
    if (typeof description === "string") out.push({ name: `${prefix}${key}`, description });
    out.push(...argumentDescriptions(schema, `${prefix}${key}.`));
  }
  return out;
}

/**
 * Every way a tool exceeds the budget, named — empty when it is within it.
 * A registry-level total is checked by the caller, because which registries
 * add up to which total is the caller's knowledge.
 */
export function overBudget(tool: ToolLike, budget: { description: number; argument: number } = BUDGET): string[] {
  const reasons: string[] = [];
  if (tool.description.length > budget.description) {
    reasons.push(`${tool.name}: description is ${tool.description.length} chars (limit ${budget.description})`);
  }
  for (const arg of argumentDescriptions(tool.parameters)) {
    if (arg.description.length > budget.argument) {
      reasons.push(`${tool.name}.${arg.name}: argument description is ${arg.description.length} chars (limit ${budget.argument})`);
    }
  }
  return reasons;
}
