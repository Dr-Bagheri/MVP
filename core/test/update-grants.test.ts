/**
 * Every column core/ updates is a column the wall lets it update.
 *
 * The fifth rule-13½ instrument, and the user found the defect it exists for.
 * Ticking a workflow onto the Meeting prep agent answered "Not saved". The
 * cause was one missing line: `echo.agent_workflow` carried `echo_app=ar` —
 * SELECT and INSERT, no UPDATE of any kind — while 0122's policy governed who
 * may write it. RLS *and* grants are the wall; the policy half was written,
 * reviewed and widened by a later migration, and the grant half was never
 * issued. The feature could not work for anybody, and the table's zero rows
 * are the whole history of it agreeing.
 *
 * The db suite did not catch it, twice over:
 *
 *  · its tests write `insert … values`, which needs only INSERT, while the
 *    product writes `insert … on conflict … do update`, which needs UPDATE
 *    whether or not a row conflicts. A test that writes its own statement
 *    instead of the producer's is two correct sides and an unowned boundary.
 *  · `t.writes_nothing` accepted ANY exception as proof that a policy had
 *    filtered a caller out, so 42501 "permission denied for table" — true for
 *    every caller — read as "the policy correctly refused this one". Two
 *    different nothings wearing one answer, inside the helper.
 *
 * Both are fixed at their own level. This is the check that makes the class
 * unrepeatable.
 *
 * ── why this reads migrations rather than a database ──────────────────────
 * The grants live in `db/migrations/*.sql`, which is the same source of truth
 * the catalogue is built from, so the check needs no credentials and runs in
 * the default suite — where a live-lane test could not (this repo's standard:
 * live tests are opt-in, and an opt-in check would not have run either).
 * Verified against the live catalogue by hand while it was written: the
 * grants it parses match `pg_class.relacl` and `pg_attribute.attacl` exactly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
const migrationsDir = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(`${full}/`));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const sources = walk(srcRoot).map((f) => readFileSync(f, "utf8"));
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`${migrationsDir}${f}`, "utf8"));

/** `echo.foo` → the columns echo_app may UPDATE. `*` means the whole table. */
function grantedColumns(): Map<string, Set<string>> {
  const granted = new Map<string, Set<string>>();
  const add = (table: string, cols: string[]) => {
    const set = granted.get(table) ?? new Set<string>();
    for (const c of cols) set.add(c);
    granted.set(table, set);
  };

  for (const sql of migrations) {
    // `grant update (a, b) on echo.t to echo_app` — column-scoped, the shape
    // this schema prefers so a write cannot reach past what it needs.
    for (const m of sql.matchAll(
      /grant\s+update\s*\(([^)]*)\)\s+on\s+(?:table\s+)?echo\.(\w+)\s+to\s+([\w\s,]+?)[;\n]/gi,
    )) {
      if (!/\becho_app\b/.test(m[3]!)) continue;
      add(m[2]!.toLowerCase(), m[1]!.split(",").map((c) => c.trim().toLowerCase()));
    }
    /*
     * The whole-table form — and it takes a LIST of tables, across newlines:
     *
     *     grant select, insert, update on
     *       echo.org, echo.app_user, echo.call, echo.call_part, …
     *     to echo_app;
     *
     * The first draft matched one table per grant and reported 89 columns as
     * ungranted — every table in that list, none of them a real finding. A
     * checker that manufactures false positives gets muted within a week, and
     * 89 on its first run is the fastest possible route there. Caught because
     * the output named `app_user.role`, which the product plainly writes every
     * time an admin changes someone's role.
     */
    for (const m of sql.matchAll(
      /grant\s+([a-z,\s]+?)\s+on\s+((?:\s*(?:table\s+)?echo\.\w+\s*,?)+)\s*to\s+([\w\s,]+?)\s*;/gi,
    )) {
      if (!/\becho_app\b/.test(m[3]!)) continue;
      const verbs = m[1]!.toLowerCase();
      if (!/\bupdate\b/.test(verbs) && !/\ball\b/.test(verbs)) continue;
      for (const table of m[2]!.matchAll(/echo\.(\w+)/g)) add(table[1]!.toLowerCase(), ["*"]);
    }
  }
  return granted;
}

/** Every `update echo.t set col = …` and `on conflict … do update set col = …`. */
function updatedColumns(): Map<string, Set<string>> {
  const wanted = new Map<string, Set<string>>();
  const add = (table: string, col: string) => {
    const set = wanted.get(table) ?? new Set<string>();
    set.add(col.toLowerCase());
    wanted.set(table, set);
  };

  for (const src of sources) {
    /*
     * The assignment list runs to `where`, `returning`, or the end of the
     * statement. Matching the FORM a real update takes rather than the table
     * name alone — a name-grep would be satisfied by the name's own presence
     * in a comment, which is the trap the column tripwire fell into.
     */
    for (const m of src.matchAll(
      /update\s+echo\.(\w+)(?:\s+\w+)?\s+set\s+([\s\S]*?)(?:\bwhere\b|\breturning\b|`|\$\$)/gi,
    )) {
      for (const c of m[2]!.matchAll(/(?:^|,)\s*(\w+)\s*=/g)) add(m[1]!, c[1]!);
    }
    for (const m of src.matchAll(/on\s+conflict[^)]*\)?\s*do\s+update\s+set\s+([\s\S]*?)(?:\bwhere\b|`)/gi)) {
      // attribute it to the table of the nearest preceding `insert into echo.x`
      const before = src.slice(0, m.index ?? 0);
      const target = [...before.matchAll(/insert\s+into\s+echo\.(\w+)/gi)].pop();
      if (!target) continue;
      for (const c of m[1]!.matchAll(/(?:^|,)\s*(\w+)\s*=/g)) add(target[1]!, c[1]!);
    }
  }
  return wanted;
}

describe("the grant behind every update core/ issues", () => {
  it("grants echo_app every column it updates", () => {
    const granted = grantedColumns();
    const wanted = updatedColumns();

    const gaps: string[] = [];
    for (const [table, columns] of wanted) {
      const allowed = granted.get(table);
      if (allowed?.has("*")) continue;
      for (const column of columns) {
        if (!allowed?.has(column)) gaps.push(`echo.${table}.${column}`);
      }
    }
    expect(
      gaps.sort(),
      `core/ updates these columns and no migration grants them to echo_app: ${gaps.join(", ")}`,
    ).toEqual([]);
  });

  it("had something to check — the parse found real updates and real grants", () => {
    /*
     * Both halves, because the assertion above is an EMPTY-list check and an
     * empty parse satisfies it perfectly. If either regex stopped matching,
     * this file would pass forever while checking nothing — the vacuous shape
     * this repo has now met in five separate instruments.
     */
    const wanted = updatedColumns();
    const granted = grantedColumns();
    expect(wanted.size).toBeGreaterThan(8);
    expect(granted.size).toBeGreaterThan(8);
    // and the specific pair the whole file exists for
    expect(wanted.get("agent_workflow")).toContain("enabled");
    expect(granted.get("agent_workflow")).toContain("enabled");
  });

  it("catches a column that is updated and not granted — the staged defect", () => {
    /*
     * The question it must answer NO to. Without this, `grantedColumns` could
     * return a set containing everything and every assertion above would still
     * pass. Runs the real comparison over a staged pair.
     */
    const granted = new Map([["agent_workflow", new Set(["enabled"])]]);
    const wanted = new Map([["agent_workflow", new Set(["enabled", "org_id"])]]);
    const gaps: string[] = [];
    for (const [table, columns] of wanted) {
      for (const column of columns) {
        if (!granted.get(table)?.has(column)) gaps.push(`echo.${table}.${column}`);
      }
    }
    expect(gaps).toEqual(["echo.agent_workflow.org_id"]);
  });
});
