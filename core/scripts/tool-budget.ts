/**
 * THE TOOL BUDGET, measured — what the model is handed before a person has
 * typed a word (2026-09-19).
 *
 * Every assistant turn carries the JSON of every offered tool. This script
 * serialises each registry the way the runtime hands it to the model (name,
 * description, parameters) and reports where the characters go, so a diet is
 * aimed at the heaviest lines rather than at whichever file was open.
 *
 *   node --experimental-strip-types scripts/tool-budget.ts          # summary
 *   node --experimental-strip-types scripts/tool-budget.ts --top 25 # offenders
 *
 * A token is roughly four characters of English JSON and fewer of Persian,
 * so the char figures here overstate nothing.
 */
import { CLIENT_TOOLS } from "../src/agent/client-tools.ts";
import { createDomainTools } from "../src/agent/domain-tools.ts";
import { toolsFor } from "../src/agent/platform-tools.ts";
import { PLATFORM_MAP, REACH_RULE } from "../src/agent/platform-map.ts";
import { BUDGET, measureTool, overBudget, type ToolLike } from "../src/agent/tool-budget.ts";

interface Row { registry: string; name: string; total: number; description: number; parameters: number }

/* the ONE measurement — `src/agent/tool-budget.ts`, shared with the guard
   test, so this report and the ceiling cannot disagree about a number */
function measure(registry: string, tools: readonly ToolLike[]): Row[] {
  return tools.map((t) => ({ registry, ...measureTool(t) }));
}

const rows = [
  ...measure("client", CLIENT_TOOLS),
  ...measure("domain", createDomainTools()),
  ...measure("platform", toolsFor()),
];

const top = Number(process.argv[process.argv.indexOf("--top") + 1]) || 15;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byRegistry = new Map<string, Row[]>();
for (const r of rows) byRegistry.set(r.registry, [...(byRegistry.get(r.registry) ?? []), r]);

console.log("registry   tools   total chars   description   parameters");
for (const [name, list] of byRegistry) {
  console.log(
    `${name.padEnd(10)} ${String(list.length).padStart(5)}   ${String(sum(list.map((r) => r.total))).padStart(11)}   ${String(sum(list.map((r) => r.description))).padStart(11)}   ${String(sum(list.map((r) => r.parameters))).padStart(10)}`,
  );
}
console.log(`${"ALL".padEnd(10)} ${String(rows.length).padStart(5)}   ${String(sum(rows.map((r) => r.total))).padStart(11)}`);
console.log(`\nprompt pieces: PLATFORM_MAP ${PLATFORM_MAP.length} chars · REACH_RULE ${REACH_RULE.length} chars`);

console.log(`\ntop ${top} by total chars:`);
for (const r of [...rows].sort((a, b) => b.total - a.total).slice(0, top)) {
  console.log(`  ${String(r.total).padStart(6)}  ${r.registry.padEnd(8)} ${r.name.padEnd(28)} desc ${String(r.description).padStart(5)}  params ${String(r.parameters).padStart(5)}`);
}
const longDesc = rows.filter((r) => r.description > 300).length;
console.log(`\ntools with a description over 300 chars: ${longDesc} of ${rows.length}`);

const violations = [...CLIENT_TOOLS, ...createDomainTools(), ...toolsFor()].flatMap((t) => overBudget(t));
console.log(`\nbudget: description ≤ ${BUDGET.description}, argument ≤ ${BUDGET.argument}, client ≤ ${BUDGET.clientTotal}, all ≤ ${BUDGET.allTotal}`);
console.log(violations.length === 0 ? "no tool over its per-tool limits" : `${violations.length} over the per-tool limits:\n  ${violations.join("\n  ")}`);
