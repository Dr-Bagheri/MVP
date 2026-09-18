/**
 * The entity resolver — the organizational brain's spine (db/0230) as
 * operations.
 *
 * The question this module answers is "which real-world thing does this
 * identifier name", and the three ways the answer changes: a thing we have
 * not met (create it), an identifier that turns out to name a thing we
 * already know (move it), and an identifier that turns out NOT to name it
 * after all (take it back).
 *
 * ── WHY TX-LEVEL FUNCTIONS AND NOT A REPO ─────────────────────────────────
 *
 * Every caller here is writing a PRODUCT fact in its own transaction — the
 * directory link writes `person.app_user_id`, and the spine row saying those
 * two identifiers name one person has to land or not land WITH it. A repo
 * with its own `withIdentity` would open a second transaction, and the state
 * between them is "the product says linked and the brain says two people",
 * which is the staleness this module exists to prevent. So these take a
 * `tx`: the caller composes them into the transaction that owns the fact.
 *
 * Whether the spine EXISTS is a different question and is asked before the
 * transaction opens (`hasEntitySpine`) — a deployment that predates 0230
 * skips this work entirely rather than rolling back a link over a missing
 * table.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * Matching by NAME. The migration's own header says why: two colleagues here
 * are both «سینا», a name is not an identifier, and the fold indexes exist so
 * that a later caller can offer CANDIDATES to a human. No function here
 * decides who somebody is from a string.
 */
import { assertUuid, type SqlTx } from "../db/identity.ts";
import type { AliasKind, AliasSource, EntityKind } from "./vocabulary.ts";

/** An identifier that names something: "the slack handle @sara". */
export interface AliasRef {
  source: AliasSource;
  kind: AliasKind;
  value: string;
}

export interface EntityRow {
  id: string;
  kind: EntityKind;
  display_name: string;
}

/** What a node should look like if this call has to create one. */
export interface EntitySeed {
  kind: EntityKind;
  displayName: string;
  displayNameEn?: string | null;
  attrs?: Record<string, unknown>;
}

/**
 * How far `merged_into` is followed. `entity_merged_not_self` forbids the
 * one-step cycle and nothing forbids a longer one, so the walk is bounded
 * and a chain that does not terminate resolves to NOTHING rather than
 * looping — an unresolvable identifier is a different nothing from an
 * unknown one, and the caller is told which (rule 12).
 *
 * WHICH STATE THE WALK IS FOR, said here because it is not the one this file
 * creates. `attachAlias` only ever merges a node it has just EMPTIED, and an
 * empty node has no alias to walk from — so nothing below reaches the
 * recursion. The state it answers is the one a NODE-MERGE door leaves (two
 * real people who turn out to be one: 0230's "the loser keeps its aliases
 * and points at the winner"), and no such door is built yet. The acceptance
 * run writes that state directly, because otherwise this would be code that
 * cannot be wrong for its own reason; the day the merge door lands it has a
 * resolver that already follows it.
 */
const MERGE_CHAIN_LIMIT = 8;

const normalize = (ref: AliasRef): AliasRef => ({
  source: ref.source,
  kind: ref.kind,
  /*
   * The value is stored as it will be looked up. Lowercased because the two
   * identifier kinds anybody types by hand — an address and a handle — are
   * case-insensitive in every provider that issues them, and 0230's UNIQUE
   * is over the raw text: "Sara@x.com" and "sara@x.com" as two rows would be
   * two people. An opaque provider id is unaffected (they do not vary by
   * case), which is why this is safe to apply to all of them rather than to
   * a list somebody has to keep.
   */
  value: ref.value.trim().toLowerCase(),
});

/**
 * Which thing does this identifier name? Follows a merge chain to the node
 * that survived, so an id a caller has held since before a merge still
 * answers.
 *
 * `null` means NO SUCH IDENTIFIER — never "the table is not there" (asked
 * before the transaction) and never "it resolves to something unreadable"
 * (RLS scopes the read to the caller's own organisation, so a row in another
 * organisation is not a partial answer, it is absent).
 */
export async function resolveAlias(tx: SqlTx, ref: AliasRef): Promise<EntityRow | null> {
  const a = normalize(ref);
  const rows = await tx.unsafe<EntityRow>(
    `with recursive chain as (
         select e.id, e.merged_into, 1 as depth
           from echo.entity_alias al
           join echo.entity e on e.id = al.entity_id
          where al.source = $1 and al.kind = $2 and al.value = $3
       union all
         select e2.id, e2.merged_into, chain.depth + 1
           from chain
           join echo.entity e2 on e2.id = chain.merged_into
          where chain.depth < ${MERGE_CHAIN_LIMIT}
     )
     select e.id, e.kind, e.display_name
       from chain join echo.entity e on e.id = chain.id
      where chain.merged_into is null
      limit 1`,
    [a.source, a.kind, a.value],
  );
  return rows[0] ?? null;
}

/**
 * The node this identifier names, creating one if the spine has never met
 * it.
 *
 * This is what keeps the spine from going stale the day it shipped: 0230's
 * backfill is a one-shot, so every account created after it has no node, and
 * a resolver that only ever READ would answer "unknown person" about
 * everybody who joined since. Creation is lazy and internal — nothing is
 * announced to anybody, because a node is bookkeeping and not a thing a
 * person asked for.
 */
export async function ensureEntity(
  tx: SqlTx,
  ref: AliasRef,
  seed: EntitySeed,
  actorId: string,
): Promise<EntityRow> {
  const found = await resolveAlias(tx, ref);
  if (found) return found;

  const a = normalize(ref);
  const actor = assertUuid(actorId, "actor id");
  const name = seed.displayName.trim() || "unnamed";
  const created = await tx.unsafe<EntityRow>(
    `insert into echo.entity (org_id, kind, display_name, display_name_en, attrs, created_by)
     values (echo.actor_org_id(), $1, $2, $3, $4::jsonb, $5)
     returning id, kind, display_name`,
    [seed.kind, name, seed.displayNameEn?.trim() || null,
     JSON.stringify(seed.attrs ?? {}), actor],
  );
  const entity = created[0];
  if (!entity) throw new Error("entity insert returned no row");

  /*
   * ON CONFLICT DO NOTHING rather than a try/catch on 23505, and the reason
   * is the one thing a fake could never have shown: in Postgres a failed
   * statement ABORTS the whole transaction, so a catch that then re-reads
   * gets 25P02 and the recovery path is dead code that turns a survivable
   * race into a failure. These functions run inside the CALLER's transaction
   * — a directory link's — so poisoning it would fail the link.
   *
   * Zero rows back therefore means somebody else's transaction created this
   * identifier between our read and our write. Their node is as good as ours
   * and the constraint kept theirs, so we re-resolve and hand back the
   * winner. The node we just inserted is left holding no identifier, which
   * makes it unreachable rather than wrong: nothing resolves to it, and no
   * role holds DELETE to tidy it away.
   */
  const claimed = await tx.unsafe<{ id: string }>(
    `insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by, evidence)
     values (echo.actor_org_id(), $1, $2, $3, $4, $5, $6::jsonb)
     on conflict (org_id, source, kind, value) do nothing
     returning id`,
    [entity.id, a.source, a.kind, a.value, actor, JSON.stringify({ via: "ensure" })],
  );
  if (claimed.length === 0) {
    const winner = await resolveAlias(tx, ref);
    if (!winner) throw new Error("the identifier was claimed but resolves to nothing");
    return winner;
  }
  return entity;
}

export interface AttachResult {
  /** The node the identifier names once this call has returned. */
  entityId: string;
  /** True when the identifier was on a DIFFERENT node and was moved. */
  moved: boolean;
  /** True when moving it emptied its old node, which now points here. */
  mergedEmptied: boolean;
}

/**
 * Say that this identifier names that node.
 *
 * Three states, one operation, because a caller that had to tell them apart
 * would be deciding the same thing twice: the identifier may be new (insert
 * it), already here (do nothing, so a repeated press is not a second act),
 * or on another node (move it).
 *
 * WHEN MOVING EMPTIES THE OLD NODE it is pointed at the keeper rather than
 * left standing. An empty node resolves nothing and is indistinguishable
 * from a person nobody has met; pointing it at the keeper means an entity id
 * a caller already holds keeps answering, which is what `merged_into` is for.
 *
 * WHEN THE OLD NODE STILL HOLDS OTHER IDENTIFIERS it is left exactly as it
 * is. Those identifiers are evidence of something and this call has no claim
 * about them: "that mailbox is not this person's account" does not say whose
 * it is. Merging the rest on this evidence would be the resolver deciding
 * what it was asked to record.
 */
export async function attachAlias(
  tx: SqlTx,
  input: {
    alias: AliasRef;
    toEntityId: string;
    actorId: string;
    evidence?: Record<string, unknown>;
  },
): Promise<AttachResult> {
  const a = normalize(input.alias);
  const keeper = assertUuid(input.toEntityId, "entity id");
  const actor = assertUuid(input.actorId, "actor id");
  const evidence = JSON.stringify(input.evidence ?? {});

  const current = await tx.unsafe<{ id: string; entity_id: string }>(
    `select id, entity_id from echo.entity_alias
      where source = $1 and kind = $2 and value = $3
      limit 1`,
    [a.source, a.kind, a.value],
  );
  const held = current[0];

  if (!held) {
    await tx.unsafe(
      `insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by, evidence)
       values (echo.actor_org_id(), $1, $2, $3, $4, $5, $6::jsonb)`,
      [keeper, a.source, a.kind, a.value, actor, evidence],
    );
    return { entityId: keeper, moved: false, mergedEmptied: false };
  }

  if (held.entity_id === keeper) {
    return { entityId: keeper, moved: false, mergedEmptied: false };
  }

  const from = held.entity_id;
  await tx.unsafe(
    `update echo.entity_alias set entity_id = $1, evidence = $2::jsonb where id = $3`,
    [keeper, evidence, held.id],
  );

  const left = await tx.unsafe<{ n: string }>(
    `select count(*)::text as n from echo.entity_alias where entity_id = $1`,
    [from],
  );
  if (Number(left[0]?.n ?? "0") > 0) {
    return { entityId: keeper, moved: true, mergedEmptied: false };
  }

  await tx.unsafe(
    `update echo.entity set merged_into = $1, merged_at = now(), merged_by = $2
      where id = $3 and merged_into is null and id <> $1`,
    [keeper, actor, from],
  );
  return { entityId: keeper, moved: true, mergedEmptied: true };
}

/**
 * Take an identifier back: it names a thing of its OWN, not the node it is
 * on now.
 *
 * This is the other half of a link, and it exists because the alternative is
 * a brain that keeps a belief the product has retracted. An admin who clears
 * a directory person's account is saying "that is not them"; leaving the two
 * merged would mean every later fact about either lands on one person.
 *
 * It creates a fresh node rather than un-merging the one the attach emptied.
 * Un-merging would have to know that THIS link is what merged them, and
 * `merged_into` records who and when, not why — so a node merged for another
 * reason would be split by an unrelated unlink. A fresh node claims only
 * what this call actually knows.
 */
export async function detachAlias(
  tx: SqlTx,
  input: { alias: AliasRef; seed: EntitySeed; actorId: string },
): Promise<EntityRow> {
  const a = normalize(input.alias);
  const actor = assertUuid(input.actorId, "actor id");
  const name = input.seed.displayName.trim() || "unnamed";

  const created = await tx.unsafe<EntityRow>(
    `insert into echo.entity (org_id, kind, display_name, display_name_en, attrs, created_by)
     values (echo.actor_org_id(), $1, $2, $3, $4::jsonb, $5)
     returning id, kind, display_name`,
    [input.seed.kind, name, input.seed.displayNameEn?.trim() || null,
     JSON.stringify(input.seed.attrs ?? {}), actor],
  );
  const entity = created[0];
  if (!entity) throw new Error("entity insert returned no row");

  const moved = await tx.unsafe<{ id: string }>(
    `update echo.entity_alias
        set entity_id = $1, evidence = $2::jsonb
      where source = $3 and kind = $4 and value = $5
      returning id`,
    [entity.id, JSON.stringify({ via: "detach" }), a.source, a.kind, a.value],
  );

  if (moved.length === 0) {
    /* the spine had never met this identifier: the fresh node is where it
       starts, which is the same end state by a shorter road */
    await tx.unsafe(
      `insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by, evidence)
       values (echo.actor_org_id(), $1, $2, $3, $4, $5, $6::jsonb)`,
      [entity.id, a.source, a.kind, a.value, actor, JSON.stringify({ via: "detach" })],
    );
  }
  return entity;
}
