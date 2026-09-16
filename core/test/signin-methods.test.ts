import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SIGNIN_METHODS } from "../src/api/vocabulary.ts";

/**
 * db/0225 — the sign-in methods are ONE list in two places, and the two
 * cannot drift quietly: the db CHECK on `echo.signin_method.provider` is read
 * from the migration that owns it and compared with the code's closed set.
 * The owner is DERIVED (the highest-numbered migration naming the
 * constraint), the 0203 device: a test pinned to the file that first wrote
 * the check would report the current wall wrong the moment the wall moved.
 */
describe("the sign-in methods are one list", () => {
  it("the db provider check names exactly the code's methods", () => {
    const dir = join(process.cwd(), "..", "db", "migrations");
    const owner = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && readFileSync(join(dir, f), "utf8").includes("signin_method_provider_check"))
      .sort().pop();
    expect(owner, "no migration names the sign-in method check").toBeDefined();
    const sql = readFileSync(join(dir, owner!), "utf8");
    const check = /constraint signin_method_provider_check\s+check \(provider in \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? "";
    const names = [...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(names.length, "the check was found and carries names").toBeGreaterThan(0);
    expect(names).toEqual([...SIGNIN_METHODS].sort());
  });

  it("the four the gate draws, and github, are all switchable", () => {
    for (const method of ["google", "apple", "azure", "sso", "github"]) {
      expect(SIGNIN_METHODS as readonly string[]).toContain(method);
    }
  });
});
