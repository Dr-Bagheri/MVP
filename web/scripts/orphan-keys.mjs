/**
 * Which locale keys does nothing ask for?
 *
 *   node scripts/orphan-keys.mjs <namespace> [<namespace> …]
 *
 * `src/messages/keys.test.ts` checks the other direction — every key a
 * component asks for exists in both locales — and it is deliberately
 * one-directional. A dead key breaks nothing, so no test can be made to care
 * about it without inventing failures; removing one needs a person to decide.
 * This gives that person the list.
 *
 * Written while removing the webhook feature, whose deletion orphaned two
 * whole namespaces. The lesson it serves is the one already in the log: a
 * caveat nobody deletes is how a fixed thing keeps apologising for itself.
 *
 * ── the same caveat keys.test carries ─────────────────────────────────────
 * Only LITERAL calls are collected — `t("x")`, `t.rich("x")`, `g("x")`. A
 * computed key (`t(LABEL[kind])`) is invisible here, so a key it reaches
 * would be reported as an orphan. That is why this prints a worklist and
 * refuses to delete anything: over-reporting is safe when a human reads the
 * result and fatal when a script acts on it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
const namespaces = process.argv.slice(2);
if (namespaces.length === 0) {
  console.error("usage: node scripts/orphan-keys.mjs <namespace> [<namespace> …]");
  process.exit(2);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = walk(srcRoot).map((f) => readFileSync(f, "utf8"));

/**
 * Every literal translation call in the tree, as bare key strings. The
 * namespace binding (`const g = useTranslations("gateway")`) means the
 * IDENTIFIER varies by file, so any single-letter-or-word callee followed by
 * a string literal counts. That over-collects — `String("x")` would match —
 * and over-collecting is the safe direction here: it can only make a key look
 * USED, never make a used key look orphaned.
 */
const asked = new Set();
for (const src of sources) {
  for (const m of src.matchAll(/\b\w+(?:\.rich)?\(\s*"([\w.-]+)"/g)) asked.add(m[1]);
}

const en = JSON.parse(readFileSync(join(srcRoot, "messages/en.json"), "utf8"));

let total = 0;
for (const ns of namespaces) {
  const table = ns.split(".").reduce((node, part) => node?.[part], en);
  if (!table || typeof table !== "object") {
    console.log(`\n${ns}: no such namespace in en.json`);
    continue;
  }
  const orphans = Object.keys(table).filter((k) => !asked.has(k) && !asked.has(`${ns}.${k}`));
  total += orphans.length;
  console.log(`\n${ns}: ${orphans.length} of ${Object.keys(table).length} keys unasked`);
  for (const k of orphans) console.log(`  ${ns}.${k}`);
}

console.log(`\n${total} candidate(s). Read them before deleting — a computed key looks orphaned.\n`);
