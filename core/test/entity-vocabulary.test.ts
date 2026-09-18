import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ALIAS_KINDS, ALIAS_SOURCES, ENTITY_KINDS } from "../src/api/vocabulary.ts";

/**
 * db/0230 — the spine's three closed sets are ONE list in two places, and the
 * two cannot drift quietly: each db CHECK is read from the migration that
 * owns it and compared with the code's set.
 *
 * The owner is DERIVED (the highest-numbered migration naming the column),
 * the 0203 device: a test pinned to the file that first wrote a check reports
 * the current wall wrong the moment the wall moves.
 */

function ownerOf(needle: string): string {
  const dir = join(process.cwd(), "..", "db", "migrations");
  const owner = readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && readFileSync(join(dir, f), "utf8").includes(needle))
    .sort()
    .pop();
  expect(owner, `no migration contains ${needle}`).toBeDefined();
  return readFileSync(join(dir, owner!), "utf8");
}

/** the quoted names inside `<column> ... check (<column> in ( ... ))` */
function checkNames(sql: string, column: string): string[] {
  const body = new RegExp(`${column}\\s+text not null check \\(${column} in \\(([\\s\\S]*?)\\)\\)`)
    .exec(sql)?.[1] ?? "";
  /* flatMap, not map: a capture that did not participate is not a name,
     and `m[1]!` would be asserting it away rather than dropping it */
  return [...body.matchAll(/'([a-z_]+)'/g)].flatMap((m) => (m[1] ? [m[1]] : [])).sort();
}

describe("the spine's vocabularies are one list", () => {
  it("entity.kind names exactly ENTITY_KINDS", () => {
    const names = checkNames(ownerOf("create table echo.entity ("), "kind");
    expect(names.length, "the check was found and carries names").toBeGreaterThan(0);
    expect(names).toEqual([...ENTITY_KINDS].sort());
  });

  it("entity_alias.source names exactly ALIAS_SOURCES", () => {
    const names = checkNames(ownerOf("create table echo.entity_alias ("), "source");
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual([...ALIAS_SOURCES].sort());
  });

  it("entity_alias.kind names exactly ALIAS_KINDS", () => {
    const sql = ownerOf("create table echo.entity_alias (");
    /* the alias table declares `kind` AFTER `source`, and `echo.entity` has a
       `kind` of its own — so the slice starts at the alias table, or this
       reads the wrong column's check and passes for the wrong reason */
    const aliasTable = sql.slice(sql.indexOf("create table echo.entity_alias ("));
    const names = checkNames(aliasTable, "kind");
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual([...ALIAS_KINDS].sort());
  });

  it("a NAME is not an identifier kind — the rule the spine is built on", () => {
    /* two colleagues here are both «سینا»; a `name` kind under the alias
       table's UNIQUE would refuse the second, and worse, would let a string
       decide who somebody is (the 2026-09-16 voice-picker finding) */
    expect(ALIAS_KINDS as readonly string[]).not.toContain("name");
    expect(ALIAS_KINDS as readonly string[]).not.toContain("display_name");
  });

  it("the tenant is not an entity kind", () => {
    /* `organization` here means an EXTERNAL organization — a customer, a
       supplier. echo.org is the tenant and every row is already scoped to it */
    expect(ENTITY_KINDS as readonly string[]).toContain("organization");
    expect(ENTITY_KINDS as readonly string[]).not.toContain("org");
    expect(ENTITY_KINDS as readonly string[]).not.toContain("tenant");
  });
});
