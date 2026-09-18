import { describe, expect, it } from "vitest";

import { attachAlias, detachAlias, ensureEntity, resolveAlias } from "../src/api/entities.ts";
import type { SqlTx } from "../src/db/identity.ts";

/**
 * The resolver's BRANCHING, on a fake spine.
 *
 * What this file claims and what it does not. The SQL itself — the recursive
 * walk over `merged_into`, the policies, the unique constraint, the DELETE
 * that no role holds — was proven against the real schema under the real app
 * role in an acceptance run (runbook 7ac), because a fake that implements the
 * chain-follow in JavaScript is my own belief about what that query does.
 * What runs HERE, on every commit and with no database, is the decision each
 * function makes: which of the three states an identifier is in, whether a
 * repeat is a second act, and whether moving an identifier empties the node
 * it leaves.
 *
 * The fake is therefore a small store that answers the shapes the module
 * asks for, and it is deliberately UNCOOPERATIVE about the one thing a
 * believing fake would get wrong: it does not follow merge chains at all, so
 * no assertion here can pass because the fake agreed with the code.
 */

const ACTOR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

interface Node { id: string; kind: string; display_name: string; merged_into: string | null }
interface Alias { id: string; entity_id: string; source: string; kind: string; value: string }

function fakeSpine() {
  const nodes: Node[] = [];
  const aliases: Alias[] = [];
  let n = 0;
  // a REAL uuid shape: assertUuid guards every id the module writes, and an
  // 8-character first group is what makes these ids pass it
  const id = (p: string) => `${p}${(n += 1).toString().padStart(7, "0")}-0000-4000-8000-000000000000`;

  const tx = {
    unsafe: async (sql: string, params: unknown[] = []) => {
      // resolve: the recursive CTE. The fake answers the NON-merged case only
      // (see the header) — a row whose node is merged resolves to nothing here.
      if (sql.includes("with recursive chain")) {
        const [source, kind, value] = params as [string, string, string];
        const a = aliases.find((x) => x.source === source && x.kind === kind && x.value === value);
        if (!a) return [];
        const node = nodes.find((x) => x.id === a.entity_id);
        return node && node.merged_into === null
          ? [{ id: node.id, kind: node.kind, display_name: node.display_name }]
          : [];
      }
      if (sql.includes("insert into echo.entity (")) {
        const [kind, name] = params as [string, string];
        const node: Node = { id: id("e"), kind, display_name: name, merged_into: null };
        nodes.push(node);
        return [{ id: node.id, kind: node.kind, display_name: node.display_name }];
      }
      if (sql.includes("insert into echo.entity_alias")) {
        const [entity_id, source, kind, value] = params as [string, string, string, string];
        const taken = aliases.some((x) => x.source === source && x.kind === kind && x.value === value);
        /* ON CONFLICT DO NOTHING: zero rows, never a throw. A fake that threw
           here would be deciding what the real system decides differently —
           in Postgres a failed statement aborts the whole transaction, which
           is exactly what made the old catch-and-retry dead code. */
        if (taken) return sql.includes("returning id") ? [] : [];
        const row = { id: id("a"), entity_id, source, kind, value };
        aliases.push(row);
        return sql.includes("returning id") ? [{ id: row.id }] : [];
      }
      if (sql.includes("select id, entity_id from echo.entity_alias")) {
        const [source, kind, value] = params as [string, string, string];
        const a = aliases.find((x) => x.source === source && x.kind === kind && x.value === value);
        return a ? [{ id: a.id, entity_id: a.entity_id }] : [];
      }
      if (sql.includes("update echo.entity_alias") && sql.includes("where id = $3")) {
        const [entity_id, , aliasId] = params as [string, string, string];
        const a = aliases.find((x) => x.id === aliasId);
        if (a) a.entity_id = entity_id;
        return [];
      }
      if (sql.includes("update echo.entity_alias\n        set entity_id")) {
        const [entity_id, , source, kind, value] = params as [string, string, string, string, string];
        const a = aliases.find((x) => x.source === source && x.kind === kind && x.value === value);
        if (!a) return [];
        a.entity_id = entity_id;
        return [{ id: a.id }];
      }
      if (sql.includes("count(*)::text as n from echo.entity_alias")) {
        const [entityId] = params as [string];
        return [{ n: String(aliases.filter((x) => x.entity_id === entityId).length) }];
      }
      if (sql.includes("update echo.entity set merged_into")) {
        const [into, , from] = params as [string, string, string];
        const node = nodes.find((x) => x.id === from);
        if (node && node.merged_into === null && node.id !== into) node.merged_into = into;
        return [];
      }
      throw new Error(`the fake spine was asked something it does not know: ${sql.slice(0, 60)}`);
    },
  } as unknown as SqlTx;

  return { tx, nodes, aliases };
}

const A = { source: "neurai", kind: "external_id", value: "A-1" } as const;
const B = { source: "neurai", kind: "external_id", value: "B-1" } as const;

describe("resolving an identifier", () => {
  it("an identifier nobody has seen resolves to null, not an error", async () => {
    const { tx } = fakeSpine();
    expect(await resolveAlias(tx, A)).toBeNull();
  });

  it("finds it however it was cased or padded on the way in or out", async () => {
    const { tx } = fakeSpine();
    const made = await ensureEntity(
      tx, { source: "manual", kind: "email", value: "  Sara@Example.COM " },
      { kind: "person", displayName: "سارا" }, ACTOR,
    );
    const found = await resolveAlias(tx, { source: "manual", kind: "email", value: "SARA@example.com" });
    expect(found?.id).toBe(made.id);
  });
});

describe("ensuring a node exists", () => {
  it("creates one the first time and READS it the second — not a second node", async () => {
    const { tx, nodes } = fakeSpine();
    const first = await ensureEntity(tx, A, { kind: "person", displayName: "یکی" }, ACTOR);
    const second = await ensureEntity(tx, A, { kind: "person", displayName: "ignored" }, ACTOR);
    expect(second.id).toBe(first.id);
    expect(nodes).toHaveLength(1);
    // the seed of the SECOND call is ignored: the node is what it already was
    expect(second.display_name).toBe("یکی");
  });

  it("a concurrent insert wins and we hand back THEIR node, not ours", async () => {
    const spine = fakeSpine();
    const theirs = await ensureEntity(spine.tx, A, { kind: "person", displayName: "theirs" }, ACTOR);

    /*
     * The race, made representable: our resolve must MISS and our insert must
     * then COLLIDE. A fixture that leaves the identifier findable never
     * reaches the catch at all — the first draft of this test did exactly
     * that and passed for the wrong reason.
     *
     * So the next resolve is blinded ONCE, which is the real interleaving:
     * we looked before they committed, and by the time we wrote, they had.
     */
    let blind = true;
    const racing = {
      unsafe: async (sql: string, params: unknown[] = []) => {
        if (blind && sql.includes("with recursive chain")) { blind = false; return []; }
        return (spine.tx as unknown as { unsafe: (s: string, p?: unknown[]) => Promise<unknown[]> })
          .unsafe(sql, params);
      },
    } as unknown as SqlTx;

    const ours = await ensureEntity(racing, A, { kind: "person", displayName: "ours" }, ACTOR);
    expect(ours.id).toBe(theirs.id);
    expect(ours.display_name).toBe("theirs");
  });
});

describe("attaching an identifier to a node", () => {
  it("an identifier the spine has never met is simply written there", async () => {
    const { tx } = fakeSpine();
    const node = await ensureEntity(tx, B, { kind: "person", displayName: "مقصد" }, ACTOR);
    const r = await attachAlias(tx, { alias: A, toEntityId: node.id, actorId: ACTOR });
    expect(r).toMatchObject({ entityId: node.id, moved: false, mergedEmptied: false });
    expect((await resolveAlias(tx, A))?.id).toBe(node.id);
  });

  it("attaching where it already sits is not a second act", async () => {
    const { tx, nodes } = fakeSpine();
    const node = await ensureEntity(tx, A, { kind: "person", displayName: "همان" }, ACTOR);
    const r = await attachAlias(tx, { alias: A, toEntityId: node.id, actorId: ACTOR });
    expect(r).toMatchObject({ moved: false, mergedEmptied: false });
    expect(nodes.filter((x) => x.merged_into !== null)).toHaveLength(0);
  });

  it("moving the LAST identifier off a node points that node at the keeper", async () => {
    const { tx, nodes } = fakeSpine();
    const from = await ensureEntity(tx, A, { kind: "person", displayName: "مبدأ" }, ACTOR);
    const keeper = await ensureEntity(tx, B, { kind: "person", displayName: "مقصد" }, ACTOR);
    const r = await attachAlias(tx, { alias: A, toEntityId: keeper.id, actorId: ACTOR });
    expect(r).toMatchObject({ moved: true, mergedEmptied: true });
    expect(nodes.find((x) => x.id === from.id)?.merged_into).toBe(keeper.id);
  });

  it("a node that still holds other identifiers is LEFT ALONE, never merged", async () => {
    const { tx, nodes } = fakeSpine();
    const from = await ensureEntity(tx, A, { kind: "person", displayName: "مبدأ" }, ACTOR);
    // a second identifier on the same node — evidence of something this call
    // has no claim about
    await attachAlias(tx, {
      alias: { source: "manual", kind: "email", value: "other@x.com" },
      toEntityId: from.id, actorId: ACTOR,
    });
    const keeper = await ensureEntity(tx, B, { kind: "person", displayName: "مقصد" }, ACTOR);
    const r = await attachAlias(tx, { alias: A, toEntityId: keeper.id, actorId: ACTOR });
    expect(r).toMatchObject({ moved: true, mergedEmptied: false });
    expect(nodes.find((x) => x.id === from.id)?.merged_into).toBeNull();
  });
});

describe("taking an identifier back", () => {
  it("gives it a node of its own, and leaves the other identifiers where they are", async () => {
    const { tx } = fakeSpine();
    const shared = await ensureEntity(tx, B, { kind: "person", displayName: "حساب" }, ACTOR);
    await attachAlias(tx, { alias: A, toEntityId: shared.id, actorId: ACTOR });

    const split = await detachAlias(tx, {
      alias: A, seed: { kind: "person", displayName: "شخص" }, actorId: ACTOR,
    });
    expect(split.id).not.toBe(shared.id);
    expect((await resolveAlias(tx, A))?.id).toBe(split.id);
    expect((await resolveAlias(tx, B))?.id).toBe(shared.id);
  });

  it("an identifier the spine never met still ends up naming a node of its own", async () => {
    const { tx } = fakeSpine();
    const made = await detachAlias(tx, {
      alias: A, seed: { kind: "person", displayName: "تازه" }, actorId: ACTOR,
    });
    expect((await resolveAlias(tx, A))?.id).toBe(made.id);
  });
});
