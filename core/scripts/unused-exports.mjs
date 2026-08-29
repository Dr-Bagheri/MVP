/**
 * What does core/ export that nothing imports?
 *
 *   node scripts/unused-exports.mjs [--all]
 *
 * Written for the 2026-08-29 directive "remove the webhook, and the others
 * that are not already being used as well". A grep for a name cannot answer
 * that question — the column tripwire taught this repo that a name-grep is
 * satisfied by the name's own presence in the code that fails to use it. So
 * this reads IMPORT STATEMENTS, which is the form a real use takes across a
 * module boundary.
 *
 * ── the split that makes the output usable ─────────────────────────────────
 * An unused exported **type** is usually not dead code at all: it is the shape
 * of an exported function's parameter or return value, reachable structurally
 * by every consumer without anyone importing its name. Deleting those is churn
 * with a chance of breaking a signature. An unused exported **value** — a
 * function or a const — is what the directive was about. The first run of this
 * script reported 177 findings and buried the twelve that mattered among 165
 * type names, which is the shape of a tool nobody uses twice.
 *
 * ── what it can and cannot see ─────────────────────────────────────────────
 *  · An entrypoint exports nothing anyone imports and is not dead — `main.ts`
 *    and `index.ts` are excluded by name.
 *  · `export *` moves names this parser does not resolve. Any file containing
 *    one is named in the output, so its exports read as unreliable rather than
 *    as clean.
 *  · An export used ONLY by tests is reported separately. That is a different
 *    finding: it may be a deliberate testing seam, or it may be code whose only
 *    remaining purpose is to be tested — which is how dead code survives review.
 *
 * ── READ THIS BEFORE ACTING ON THE OUTPUT ─────────────────────────────────
 * A worklist, not a verdict. Confirm every deletion by deleting the code and
 * running the suite — the only check that cannot be fooled by this parser.
 *
 * The false-positive history, kept because a rate is what tells you how much
 * to trust a line of output: the first version reported 177 findings, of
 * which 165 were types that are not dead at all; of the 21 remaining "dead
 * values", checking each across the whole repo found exactly ONE real. Twenty
 * were used inside their own file. That is the rate at which an instrument
 * gets muted within a week, and a muted check is worse than no check because
 * it still reads as coverage.
 *
 * Both causes are fixed. The numbers stay visible rather than tidied away, so
 * the next reader calibrates before acting rather than after.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = resolve(fileURLToPath(new URL("../src", import.meta.url)));
const testRoot = resolve(fileURLToPath(new URL("../test", import.meta.url)));
const showAll = process.argv.includes("--all");

const ENTRYPOINTS = /(^|[\\/])(main|index)\.ts$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** name -> {line, kind}. `kind` is "type" or "value"; see the header. */
function exportsOf(src) {
  const found = new Map();
  const lineAt = (index) => src.slice(0, index).split("\n").length;
  const add = (name, index, kind) => {
    if (name && !found.has(name)) found.set(name, { line: lineAt(index), kind });
  };

  const declaration = /^export\s+(?:async\s+)?(function|const|let|class|interface|type|enum)\s+(\w+)/gm;
  for (const m of src.matchAll(declaration)) {
    const kind = m[1] === "interface" || m[1] === "type" ? "type" : "value";
    add(m[2], m.index ?? 0, kind);
  }

  // `export { a, b as c }` — the exported spelling is what a consumer writes.
  // Kind is unknowable here without resolving the declaration, so these are
  // treated as values: over-reporting a type is a wasted look, under-reporting
  // a function is a missed deletion.
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) {
    for (const piece of m[1].split(",")) {
      add(piece.trim().split(/\s+as\s+/).pop()?.trim(), m.index ?? 0, "value");
    }
  }
  return found;
}

/** Every name a file imports, plus the names it re-exports (a barrel hop). */
function importedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (name) names.add(name);
    }
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const files = walk(srcRoot);
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

const importedBy = new Map();
for (const [file, src] of sources) {
  for (const name of importedNames(src)) {
    if (!importedBy.has(name)) importedBy.set(name, new Set());
    importedBy.get(name).add(file);
  }
}

const importedByTest = new Set();
for (const file of walk(testRoot)) {
  for (const name of importedNames(readFileSync(file, "utf8"))) importedByTest.add(name);
}

/**
 * web/ imports core's vocabulary through `@echo/core/*`, so a core export can
 * be alive with no consumer anywhere in core. Scanning only this package is
 * precisely the blind spot this repo keeps paying for — a producer whose
 * consumer is in another package. Half the first run's candidates
 * (`WORKFLOW_TRIGGER_KINDS`, `AGENT_CARD_KINDS`, `DELETION_FEED_ARM` …) were
 * that shape, and deleting any of them would have broken web's typecheck.
 *
 * Matched by NAME rather than by import statement, because a name reaching
 * web at all is enough to disqualify it from a deletion list. Over-matching is
 * the safe direction: it can only keep something alive, never kill it.
 */
const otherPackages = ["../../web/src", "../../ml/src"]
  .map((p) => resolve(fileURLToPath(new URL(p, import.meta.url))))
  .filter((p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
const outsideText = otherPackages
  .flatMap((root) => walk(root).filter((f) => /\.tsx?$/.test(f)))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const usedOutside = (name) => new RegExp(`\\b${name}\\b`).test(outsideText);

const starExporters = files.filter((f) => /^export\s+\*/m.test(sources.get(f)));

/**
 * Does the declaring file USE the name itself?
 *
 * The correction that made this tool worth keeping. Its first run reported 21
 * dead values; checking every one across the whole repo found exactly ONE.
 * The other twenty were used inside their own module — exported a little more
 * widely than necessary, which is a style note, not dead code. Reporting them
 * as deletions would have been a false-positive factory, and the repo's own
 * rule is that such a checker gets muted within a week and is then worse than
 * absent.
 *
 * Two occurrences of the name in its own file means declaration plus one use.
 * One occurrence means the declaration stands alone.
 */
function usedInOwnFile(src, name) {
  return (src.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length > 1;
}

const dead = [];
const testOnly = [];
const hiddenTypes = [];
const overExported = [];
const outsideOnly = [];
for (const [file, src] of sources) {
  if (ENTRYPOINTS.test(file)) continue;
  for (const [name, { line, kind }] of exportsOf(src)) {
    const importers = new Set(importedBy.get(name) ?? []);
    importers.delete(file); // a file importing its own name proves nothing
    if (importers.size > 0) continue;

    if (usedInOwnFile(src, name)) {
      if (kind !== "type") {
        overExported.push(`${relative(srcRoot, file).replace(/\\/g, "/")}:${line}  ${name}`);
      }
      continue;
    }

    const where = `${relative(srcRoot, file).replace(/\\/g, "/")}:${line}`;
    const entry = `${where}  ${name}`;
    if (kind === "type" && !showAll) hiddenTypes.push(entry);
    else if (importedByTest.has(name)) testOnly.push(entry);
    else if (usedOutside(name)) outsideOnly.push(entry);
    else dead.push(entry);
  }
}

console.log(
  `\nExported VALUES that no module imports AND the declaring file does not use` +
    ` — the deletion worklist: ${dead.length}`,
);
for (const line of dead.sort()) console.log(`  ${line}`);

console.log(
  `\nUsed by another PACKAGE (web/ or ml/) and not by core: ${outsideOnly.length}` +
    `  — alive, and the reason this reads outside its own tree`,
);
for (const line of outsideOnly.sort()) console.log(`  ${line}`);

console.log(
  `\nUsed only inside their own file — over-exported, not dead: ${overExported.length}` +
    `  (dropping the \`export\` keyword is the whole fix; nothing to delete)`,
);
for (const line of showAll ? overExported.sort() : []) console.log(`  ${line}`);

console.log(`\nImported ONLY by tests — a seam, or code kept alive by its own test: ${testOnly.length}`);
for (const line of testOnly.sort()) console.log(`  ${line}`);

if (hiddenTypes.length > 0) {
  console.log(
    `\n${hiddenTypes.length} unused exported TYPES not listed — see the header for why ` +
      `they are usually not dead code. \`--all\` lists them.`,
  );
}

if (starExporters.length > 0) {
  console.log(`\nFiles using \`export *\` — their exports read as UNRELIABLE here:`);
  for (const f of starExporters) console.log(`  ${relative(srcRoot, f).replace(/\\/g, "/")}`);
}

console.log(`\nA worklist, not a verdict: confirm each by deleting it and running the suite.\n`);
