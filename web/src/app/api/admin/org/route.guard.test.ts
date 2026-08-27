import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WRITABLE_ORG_KEYS } from "./route";

/**
 * THE SEAM (user report, 2026-08-26: "it does not save in General").
 *
 * The BFF forwards the org patch key by key. That is the right shape — a
 * spread would collapse "leave it alone" (absent) into "clear it" (null) —
 * but it means the list can go stale, and when it did, a Location edit and
 * the whole recognition glossary reached core as an empty patch. Core
 * answered "nothing to update" with a 400 and the form said Not saved. The
 * form was right. The server was right. The hop between them threw the
 * instruction away, which is the shape this codebase keeps finding: two
 * correct sides and an unowned boundary.
 *
 * So the list stops being a thing somebody remembers. This reads the keys
 * core's own route destructures and fails when the two disagree.
 */
describe("the org BFF forwards what core accepts", () => {
  it("knows every key the core route reads", () => {
    const server = readFileSync(
      join(process.cwd(), "..", "core", "src", "api", "server.ts"),
      "utf8",
    );
    /* the route's body destructure, verbatim from the source: the keys
       core names are the keys this hop has to carry */
    const start = server.indexOf('app.patch("/v1/admin/org"');
    expect(start).toBeGreaterThan(0);
    const block = server.slice(start, start + 900);
    const shape = block.slice(block.indexOf("as {"), block.indexOf("};"));
    const coreKeys = [...shape.matchAll(/(\w+)\?:/g)].map((m) => m[1]!);
    expect(coreKeys.length).toBeGreaterThan(3);

    const missing = coreKeys.filter((k) => !WRITABLE_ORG_KEYS.includes(k as never));
    expect(missing).toEqual([]);
  });

  it("forwards nothing core does not accept", () => {
    // the other direction: a key here that core ignores would look saved
    // and change nothing, which is the same lie from the other side
    const server = readFileSync(
      join(process.cwd(), "..", "core", "src", "api", "server.ts"),
      "utf8",
    );
    const start = server.indexOf('app.patch("/v1/admin/org"');
    const block = server.slice(start, start + 900);
    for (const key of WRITABLE_ORG_KEYS) {
      expect(block.includes(`${key}?:`)).toBe(true);
    }
  });
});
